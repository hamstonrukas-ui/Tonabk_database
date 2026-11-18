// Nettoyage automatique : supprime de la base ET de Cloudflare R2 les éléments expirés
// (Mali mupya, Kisakoshi, Soldes). Fonctionne au démarrage du serveur puis toutes les heures.
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

// Seuls ces dossiers R2 peuvent être effacés ici : jamais les photos de produits ni de maisons.
const DOSSIERS_AUTORISES = ["nouveautes/", "soldes/"];
const LOT = 100;          // lignes traitées à la fois
const TOURS_MAX = 20;     // 2000 lignes max par table et par passage

// Délai de grâce après l'expiration (un solde expiré par erreur peut encore être prolongé dans ce délai)
const TABLES = [
  { table: "nouveautes", colonnes: "id, photo_url, photos", grace_h: 1 },
  { table: "kisakoshi", colonnes: "id, photos", grace_h: 1 },
  { table: "soldes", colonnes: "id, photo_url, photos, audio_url", grace_h: 24 },
];

let r2 = null;
function client() {
  if (!r2) {
    r2 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
  }
  return r2;
}

// URLs d'une ligne -> clés R2 autorisées (sans doublons)
export function clesDeLigne(ligne, publicUrl = process.env.R2_PUBLIC_URL) {
  if (!publicUrl) return [];
  const prefixe = `${publicUrl}/`;
  const urls = [ligne.photo_url, ligne.audio_url, ...(Array.isArray(ligne.photos) ? ligne.photos : [])];
  const cles = urls
    .filter((u) => typeof u === "string" && u.startsWith(prefixe))
    .map((u) => decodeURIComponent(u.slice(prefixe.length).split("?")[0]))
    .filter((k) => !k.includes("..") && DOSSIERS_AUTORISES.some((d) => k.startsWith(d)));
  return [...new Set(cles)];
}

// Efface des fichiers R2 (lève une erreur si R2 refuse, pour ne pas perdre la trace en base)
export async function supprimerFichiers(cles, envoyer = (cmd) => client().send(cmd)) {
  for (let i = 0; i < cles.length; i += 1000) {
    const morceau = cles.slice(i, i + 1000);
    const rep = await envoyer(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: { Objects: morceau.map((Key) => ({ Key })), Quiet: true },
    }));
    if (rep?.Errors?.length) throw new Error(`R2 : ${rep.Errors[0].Message || "suppression refusée"}`);
  }
}

// Pour les suppressions manuelles : n'échoue jamais côté utilisateur
export async function supprimerFichiersDe(ligne) {
  try {
    const cles = clesDeLigne(ligne);
    if (cles.length) await supprimerFichiers(cles);
  } catch (e) {
    console.error("Nettoyage R2 (suppression manuelle) :", e.message);
  }
}

let enCours = false;
export async function nettoyerExpires() {
  if (enCours) return;
  enCours = true;
  const bilan = {};
  try {
    for (const { table, colonnes, grace_h } of TABLES) {
      let total = 0;
      for (let tour = 0; tour < TOURS_MAX; tour++) {
        const limite = new Date(Date.now() - grace_h * 3600 * 1000).toISOString();
        const { data: lignes, error } = await supabaseAdmin
          .from(table).select(colonnes).lt("expire_le", limite).limit(LOT);
        if (error) { console.error(`Nettoyage ${table} :`, error.message); break; }
        if (!lignes?.length) break;
        // 1) fichiers R2 d'abord : si R2 échoue, les lignes restent et on réessaiera au prochain passage
        await supprimerFichiers([...new Set(lignes.flatMap((l) => clesDeLigne(l)))]);
        // 2) puis les lignes
        const { error: errSuppr } = await supabaseAdmin.from(table).delete().in("id", lignes.map((l) => l.id));
        if (errSuppr) { console.error(`Nettoyage ${table} :`, errSuppr.message); break; }
        total += lignes.length;
        if (lignes.length < LOT) break;
      }
      bilan[table] = total;
    }
    if (Object.values(bilan).some(Boolean)) console.log("Nettoyage des expirés :", JSON.stringify(bilan));
  } catch (e) {
    console.error("Nettoyage des expirés :", e.message);
  } finally {
    enCours = false;
  }
}

export function demarrerNettoyage() {
  setTimeout(nettoyerExpires, 30 * 1000);               // peu après le démarrage
  setInterval(nettoyerExpires, 60 * 60 * 1000).unref(); // puis toutes les heures
}
