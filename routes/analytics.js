import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Routes PUBLIQUES (pas de verifyAuth) — appelées par n'importe quel visiteur,
// connecté ou non, donc pas d'authentification requise ici.

router.post("/clic-whatsapp", async (req, res) => {
  const { cible_type, cible_id, session_id } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "clic_whatsapp",
    cible_type: cible_type || null,
    cible_id: cible_id || null,
    session_id: session_id || null,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post("/visite", async (req, res) => {
  const { cible_type, cible_id, session_id } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "visite",
    cible_type: cible_type || "site",
    cible_id: cible_id || null,
    session_id: session_id || null,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
    
