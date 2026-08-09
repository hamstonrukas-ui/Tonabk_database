import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

router.get("/mes-filleuls", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .select("*")
    .eq("parrain_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map((p) => ({
    id: p.id, filleul_nom: p.filleul_nom, date: p.created_at.slice(0, 10), recompense: p.recompense,
  })));
});

router.post("/enregistrer", verifyAuth, async (req, res) => {
  const { code_utilise, parrain_id, filleul_nom } = req.body;

  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .insert({ parrain_id, filleul_id: req.user.id, filleul_nom, code_utilise })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Parrainage déjà enregistré" });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

export default router;
