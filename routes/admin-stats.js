import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const [boutiquesEnAttente, maisonsDispo, requetesOuvertes, reponsesNonLues] = await Promise.all([
    supabaseAdmin.from("boutiques").select("id", { count: "exact", head: true }).eq("statut", "en_attente"),
    supabaseAdmin.from("maisons").select("id", { count: "exact", head: true }).eq("statut", "disponible"),
    supabaseAdmin.from("requetes").select("id", { count: "exact", head: true }).eq("statut", "ouverte"),
    supabaseAdmin.from("reponses_requetes").select("id", { count: "exact", head: true }).eq("vue", false),
  ]);

  res.json({
    boutiquesEnAttente: boutiquesEnAttente.count,
    maisonsDispo: maisonsDispo.count,
    requetesOuvertes: requetesOuvertes.count,
    reponsesNonLues: reponsesNonLues.count,
  });
});

export default router;
                                   
