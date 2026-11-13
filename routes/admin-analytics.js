import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { calculerTableau, debutFenetrePrecedente, PERIODES } from "../lib/analyticsTableau.js";

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

// GET /api/admin-analytics/tableau?periode=24h|7j|30j
// Tableau de bord : courbe des visiteurs, temps passé, appareils, provenance, pages les plus vues...
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAILLE_PAGE = 1000; // limite de lignes par requête côté Supabase
const MAX_EVENEMENTS = 100000;

router.get("/tableau", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const periode = PERIODES[req.query.periode] ? req.query.periode : "24h";
  const depuis = new Date(debutFenetrePrecedente(periode)).toISOString(); // inclut la période précédente (tendances)

  try {
    const evenements = [];
    for (let debut = 0; debut < MAX_EVENEMENTS; debut += TAILLE_PAGE) {
      const { data, error } = await supabaseAdmin
        .from("evenements_analytics")
        .select("type, cible_type, session_id, visite_id, chemin, duree_secondes, appareil, source, created_at")
        .gte("created_at", depuis)
        .order("created_at", { ascending: false })
        .range(debut, debut + TAILLE_PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      evenements.push(...data);
      if (data.length < TAILLE_PAGE) break;
    }

    const tableau = calculerTableau(evenements, periode);
    tableau.tronque = evenements.length >= MAX_EVENEMENTS;

    // Noms des boutiques et produits les plus vus
    const idsBoutiques = tableau.boutiques.map((b) => b.id);
    const idsProduits = tableau.produits.map((p) => p.id).filter((id) => UUID.test(id));
    const [rb, rp] = await Promise.all([
      idsBoutiques.length ? supabaseAdmin.from("boutiques").select("id, nom").in("id", idsBoutiques) : { data: [] },
      idsProduits.length ? supabaseAdmin.from("produits").select("id, nom").in("id", idsProduits) : { data: [] },
    ]);
    const nomsB = new Map((rb.data || []).map((x) => [x.id, x.nom]));
    const nomsP = new Map((rp.data || []).map((x) => [x.id, x.nom]));
    tableau.boutiques = tableau.boutiques.map((b) => ({ ...b, nom: nomsB.get(b.id) || "Boutique supprimée" }));
    tableau.produits = tableau.produits.map((p) => ({ ...p, nom: nomsP.get(p.id) || "Produit supprimé" }));

    res.json(tableau);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
