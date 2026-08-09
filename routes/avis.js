import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { boutique_id } = req.query;
  let query = supabaseAdmin.from("avis").select("*").order("created_at", { ascending: false });
  if (boutique_id) query = query.eq("boutique_id", boutique_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/", verifyAuth, async (req, res) => {
  const { boutique_id, auteur_nom, note, texte } = req.body;

  const { data, error } = await supabaseAdmin
    .from("avis")
    .insert({ boutique_id, auteur_id: req.user.id, auteur_nom, note, texte })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
