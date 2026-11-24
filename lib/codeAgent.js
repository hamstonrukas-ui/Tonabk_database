// Code public de chaque agent de sensibilisation (lien : tonabk.com/<code>)
// Le code est créé automatiquement : 3 premières lettres du nom, sans accent (Floriane → flo).
// Si le code est déjà pris, on ajoute un chiffre : jea, jea2, jea3...
import { supabaseAdmin } from "../middleware/verifyAuth.js";

// Mots qui ne peuvent pas servir d'adresse (pages du site)
export const RESERVES = new Set([
  "boutique", "boutiques", "connexion", "inscription", "expeditions", "soldes", "nouveautes", "kisakoshi", "location",
  "requete", "requetes", "mes-commandes", "commandes", "a-propos", "apropos", "comment-ca-marche", "confidentialite",
  "admin", "api", "partage", "livraison", "panier", "recherche", "populaires", "assets", "static", "login", "app", "www",
  "tonabk", "tona2go", "mali", "mupya", "malimupya",
]);

export function troisLettres(nom) {
  const l = String(nom || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  return (l || "agt").padEnd(3, "x");
}

// `pris` = ensemble des codes déjà utilisés (il est mis à jour ici)
export function choisirCode(nom, pris) {
  const base = troisLettres(nom);
  for (let i = 1; i < 100; i++) {
    const code = i === 1 ? base : `${base}${i}`;
    if (!pris.has(code) && !RESERVES.has(code)) { pris.add(code); return code; }
  }
  return null;
}

// agents = [{ id, nom }] ; adresses = lignes existantes [{ personnel_id, code }]
// Crée le code des agents qui n'en ont pas encore. Ne touche jamais aux codes existants.
export async function creerCodesManquants(agents, adresses) {
  const aDejaUnCode = new Set(adresses.map((a) => a.personnel_id));
  const pris = new Set(adresses.map((a) => a.code));
  const crees = [];
  for (const agent of agents) {
    if (aDejaUnCode.has(agent.id)) continue;
    for (let essai = 0; essai < 5; essai++) {
      const code = choisirCode(agent.nom, pris);
      if (!code) break;
      const { error } = await supabaseAdmin.from("agents_sensibilisation").insert({ personnel_id: agent.id, code });
      if (!error) { crees.push({ personnel_id: agent.id, code }); break; }
      if (error.code !== "23505") { console.error("creerCodesManquants :", error.message); break; }
      // 23505 = code déjà pris entre-temps : il est déjà dans `pris`, on essaie le suivant
    }
  }
  return crees;
}

export const lienAgent = (code) =>
  `${(process.env.FRONTEND_URL || "https://tonabk.com").replace(/\/+$/, "")}/${code}`;
