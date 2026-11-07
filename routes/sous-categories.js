import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// GET /api/sous-categories?categorie_id=...
// Renvoie la liste à plat (le frontend reconstruit l'arbre grâce à parent_id).
router.get("/", async (req, res) => {
  let requete = supabaseAdmin
    .from("sous_categories")
    .select("id, categorie_id, parent_id, nom, icone, ordre")
    .eq("actif", true)
    .order("ordre");

  if (req.query.categorie_id) requete = requete.eq("categorie_id", req.query.categorie_id);

  const { data, error } = await requete;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
