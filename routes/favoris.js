import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

router.post("/", verifyAuth, async (req, res) => {
  const { maison_id } = req.body;

  const { data, error } = await supabaseAdmin
    .from("favoris")
    .insert({ utilisateur_id: req.user.id, maison_id })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Déjà en favoris" });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

router.get("/", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("favoris")
    .select("*, maisons(*)")
    .eq("utilisateur_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/:maisonId", verifyAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from("favoris")
    .delete()
    .eq("utilisateur_id", req.user.id)
    .eq("maison_id", req.params.maisonId);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
