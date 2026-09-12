import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// GET /api/admin-analytics/boutiques
// Clics WhatsApp, visites, visiteurs uniques et connexions par boutique
router.get("/boutiques", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const { data, error } = await supabaseAdmin.rpc("stats_par_boutique");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/admin-analytics/utilisateurs-actifs
// DAU / WAU / MAU (visiteurs uniques sur 24h, 7j, 30j)
router.get("/utilisateurs-actifs", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const { data, error } = await supabaseAdmin.rpc("utilisateurs_actifs");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/admin-analytics/types-visiteurs?jours=7
// Répartition nouveaux vs récurrents sur la période donnée
router.get("/types-visiteurs", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const jours = parseInt(req.query.jours || "7", 10);
  const depuis = new Date(Date.now() - jours * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin.rpc("types_visiteurs", { depuis });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/admin-analytics/retention
// Taux de retour à J+7 par cohorte de première visite
router.get("/retention", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const { data, error } = await supabaseAdmin.rpc("retention_j7");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/admin-analytics/frequence-connexion
// Propriétaires de boutique classés par nombre de connexions
router.get("/frequence-connexion", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const { data, error } = await supabaseAdmin.rpc("frequence_connexion_boutiques");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
