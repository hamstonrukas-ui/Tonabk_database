// Audios du guide de bienvenue (3 écrans). Lecture publique ; modification par l'équipe d'administration.
import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();
const CLE = "guide";
// "1", "2", "3" = écrans du guide ; les autres = aide de chaque page du site
const ECRANS = ["1", "2", "3", "accueil", "rayon", "produit", "boutiques", "boutique", "soldes", "mali_mupya", "kisakoshi", "requete", "location", "commandes", "panier"];

const estAdmin = (req) => req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
const equipe = (req) => estAdmin(req) || estAdminSecondaire(req);

async function lireAudios() {
  const { data, error } = await supabaseAdmin.from("reglages").select("valeur").eq("cle", CLE).maybeSingle();
  if (error) console.error("Guide (lecture) :", error.message);
  const audios = data?.valeur?.audios || {};
  return Object.fromEntries(ECRANS.map((n) => [n, typeof audios[n] === "string" ? audios[n] : null]));
}

async function ecrireAudios(audios) {
  return supabaseAdmin.from("reglages").upsert(
    { cle: CLE, valeur: { audios }, modifie_le: new Date().toISOString() }, { onConflict: "cle" }
  );
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json({ audios: await lireAudios() });
});

// PUT /api/guide/audio/:n   { url }   (url obtenue via /api/upload/audio-guide)
router.put("/audio/:n", verifyAuth, async (req, res) => {
  if (!equipe(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  const n = req.params.n;
  if (!ECRANS.includes(n)) return res.status(400).json({ error: "Écran invalide" });
  const url = req.body?.url;
  if (typeof url !== "string" || !url.startsWith(`${process.env.R2_PUBLIC_URL}/guide/audio/`)) {
    return res.status(400).json({ error: "Audio invalide" });
  }
  const audios = { ...(await lireAudios()), [n]: url };
  const { error } = await ecrireAudios(audios);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ audios });
});

router.delete("/audio/:n", verifyAuth, async (req, res) => {
  if (!equipe(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  const n = req.params.n;
  if (!ECRANS.includes(n)) return res.status(400).json({ error: "Écran invalide" });
  const audios = { ...(await lireAudios()), [n]: null };
  const { error } = await ecrireAudios(audios);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ audios });
});

export default router;
