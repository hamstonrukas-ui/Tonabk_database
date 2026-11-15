import express from "express";
import multer from "multer";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { analyserPhoto, ErreurIA, MODELE_PAR_DEFAUT } from "../lib/analysePhoto.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Garde-fou de coût : nombre maximum d'analyses par jour (modifiable via ANALYSE_MAX_PAR_JOUR)
const MAX_PAR_JOUR = Number(process.env.ANALYSE_MAX_PAR_JOUR) || 1500;
const compteurs = new Map(); // "userId|jour" -> nombre
function consommer(userId) {
  const cle = `${userId}|${new Date().toISOString().slice(0, 10)}`;
  const n = (compteurs.get(cle) || 0) + 1;
  if (n > MAX_PAR_JOUR) return false;
  compteurs.set(cle, n);
  if (compteurs.size > 50) for (const k of compteurs.keys()) if (!k.endsWith(cle.split("|")[1])) compteurs.delete(k);
  return true;
}

// Sous-catégories d'une boutique (mises en cache 10 min)
const cacheSousCategories = new Map(); // categorie_id -> { t, liste }
async function sousCategoriesDe(categorieId) {
  if (!categorieId) return [];
  const c = cacheSousCategories.get(categorieId);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.liste;
  const { data } = await supabaseAdmin
    .from("sous_categories").select("id, nom").eq("categorie_id", categorieId).eq("actif", true).order("ordre").limit(200);
  const liste = data || [];
  cacheSousCategories.set(categorieId, { t: Date.now(), liste });
  return liste;
}

// POST /api/analyse-photo   (multipart : photo, boutique_id?, contexte?)
// Réservé à l'admin principal (l'analyse a un coût).
router.post("/", verifyAuth, upload.single("photo"), async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin principal" });
  if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });
  if (!consommer(req.user.id)) return res.status(429).json({ error: `Limite de ${MAX_PAR_JOUR} analyses par jour atteinte` });

  try {
    let sousCategories = [];
    if (req.body.boutique_id) {
      const { data: b } = await supabaseAdmin.from("boutiques").select("categorie_id").eq("id", req.body.boutique_id).maybeSingle();
      sousCategories = await sousCategoriesDe(b?.categorie_id);
    }
    const resultat = await analyserPhoto({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      contexte: req.body.contexte,
      sousCategories,
      cle: process.env.ANTHROPIC_API_KEY,
      modele: process.env.ANALYSE_MODELE || MODELE_PAR_DEFAUT,
    });
    res.json(resultat);
  } catch (err) {
    if (err instanceof ErreurIA) return res.status(err.statut).json({ error: err.message, reessayer: err.reessayer });
    res.status(500).json({ error: "Erreur d'analyse" });
  }
});

export default router;
