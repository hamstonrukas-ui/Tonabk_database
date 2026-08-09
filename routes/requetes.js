import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Publier une requête
router.post("/", verifyAuth, async (req, res) => {
  const { description, categorie_id, telephone, budget_estime } = req.body;

  const { data, error } = await supabaseAdmin
    .from("requetes")
    .insert({ demandeur_id: req.user.id, description, categorie_id, telephone, budget_estime })
    .select("id, description, categorie_id, statut, created_at")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Lister les requêtes publiques (sans téléphone)
router.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("requetes_publiques")
    .select("*, categories(nom, icone)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Voir mes propres requêtes
router.get("/mes-requetes", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("requetes")
    .select("*")
    .eq("demandeur_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Voir une requête publique précise
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("requetes_publiques")
    .select("*, categories(nom, icone)")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Requête introuvable" });
  res.json(data);
});

// --- Admin ---
router.get("/admin/toutes", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("requetes")
    .select("*, categories(nom), reponses_requetes(*)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/:id/statut", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { statut } = req.body;
  const { data, error } = await supabaseAdmin
    .from("requetes").update({ statut }).eq("id", req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/admin/:id/fermer", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("requetes").update({ statut: "fermee" }).eq("id", req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/admin/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  await supabaseAdmin.from("reponses_requetes").delete().eq("requete_id", req.params.id);
  const { error } = await supabaseAdmin.from("requetes").delete().eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
