import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Routes PUBLIQUES (pas de verifyAuth) — appelées par n'importe quel visiteur,
// connecté ou non, donc pas d'authentification requise ici.

const APPAREILS = ["mobile", "tablette", "ordinateur"];
// Texte court nettoyé (ou null) : on ne fait jamais confiance à ce que le navigateur envoie
const court = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

router.post("/clic-whatsapp", async (req, res) => {
  const { cible_type, cible_id, session_id, visite_id } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "clic_whatsapp",
    cible_type: cible_type || null,
    cible_id: cible_id || null,
    session_id: session_id || null,
    visite_id: court(visite_id, 64),
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post("/visite", async (req, res) => {
  const { cible_type, cible_id, session_id, visite_id, appareil, source } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "visite",
    cible_type: cible_type || "site",
    cible_id: cible_id || null,
    session_id: session_id || null,
    visite_id: court(visite_id, 64),
    appareil: APPAREILS.includes(appareil) ? appareil : null,
    source: court(source, 30),
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Page consultée (page_vue) ou temps passé à l'écran (duree)
router.post("/evenement", async (req, res) => {
  const { type, chemin, duree_secondes, appareil, source, session_id, visite_id } = req.body || {};
  if (type !== "page_vue" && type !== "duree") return res.status(400).json({ error: "Type invalide" });

  const ligne = {
    type,
    cible_type: "site",
    session_id: court(session_id, 64),
    visite_id: court(visite_id, 64),
    appareil: APPAREILS.includes(appareil) ? appareil : null,
    source: court(source, 30),
  };

  if (type === "page_vue") {
    const c = court(chemin, 200);
    if (!c || !c.startsWith("/")) return res.status(400).json({ error: "Page invalide" });
    ligne.chemin = c.split("?")[0];
  } else {
    const d = Math.round(Number(duree_secondes));
    if (!(d >= 1 && d <= 1800)) return res.status(400).json({ error: "Durée invalide" });
    ligne.duree_secondes = d;
  }

  const { error } = await supabaseAdmin.from("evenements_analytics").insert(ligne);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
