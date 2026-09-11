import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Enregistrer une visite (appelé une fois par session, pas à chaque navigation)
router.post("/visite", async (req, res) => {
  await supabaseAdmin.from("evenements_analytics").insert({ type: "visite" });
  res.status(204).end();
});

// Enregistrer un clic sur "Acheter / Contacter sur WhatsApp"
router.post("/clic-whatsapp", async (req, res) => {
  const { cible_type, cible_id } = req.body;
  await supabaseAdmin.from("evenements_analytics").insert({
    type: "clic_whatsapp",
    cible_type: cible_type || null,
    cible_id: cible_id || null,
  });
  res.status(204).end();
});

export default router;
