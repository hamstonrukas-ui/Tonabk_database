import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const depuis24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [boutiquesEnAttente, maisonsDispo, requetesOuvertes, reponsesNonLues, visites24h, clicsWhatsapp24h] = await Promise.all([
    supabaseAdmin.from("boutiques").select("id", { count: "exact", head: true }).eq("statut", "en_attente"),
    supabaseAdmin.from("maisons").select("id", { count: "exact", head: true }).eq("statut", "disponible"),
    supabaseAdmin.from("requetes").select("id", { count: "exact", head: true }).eq("statut", "ouverte"),
    supabaseAdmin.from("reponses_requetes").select("id", { count: "exact", head: true }).eq("vue", false),
    supabaseAdmin.from("evenements_analytics").select("id", { count: "exact", head: true }).eq("type", "visite").gte("created_at", depuis24h),
    supabaseAdmin.from("evenements_analytics").select("id", { count: "exact", head: true }).eq("type", "clic_whatsapp").gte("created_at", depuis24h),
  ]);

  res.json({
    boutiquesEnAttente: boutiquesEnAttente.count,
    maisonsDispo: maisonsDispo.count,
    requetesOuvertes: requetesOuvertes.count,
    reponsesNonLues: reponsesNonLues.count,
    visites24h: visites24h.count,
    clicsWhatsapp24h: clicsWhatsapp24h.count,
  });
});

export default router;

    
