import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Créer une boutique
router.post("/", verifyAuth, async (req, res) => {
  // Un compte ne peut créer qu'une seule boutique
  const { data: existantes } = await supabaseAdmin
    .from("boutiques")
    .select("id")
    .eq("owner_id", req.user.id);

  if (existantes && existantes.length > 0) {
    return res.status(409).json({ error: "Vous avez déjà une boutique. Un seul compte ne peut créer qu'une boutique." });
  }

  const { nom, categorie_id, description, telephone, quartier } = req.body;

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .insert({
      owner_id: req.user.id,
      nom, categorie_id, description, telephone, quartier,
      statut: "en_attente",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Lister les boutiques actives
router.get("/", async (req, res) => {
  const { categorie_id } = req.query;
  let query = supabaseAdmin.from("boutiques").select("*, categories(nom, icone)").eq("statut", "actif");
  if (categorie_id) query = query.eq("categorie_id", categorie_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Boutiques de l'utilisateur connecté
router.get("/mine", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .select("*, categories(nom, icone)")
    .eq("owner_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Voir une boutique précise
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .select("*, categories(nom, icone), produits(*)")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Boutique introuvable" });
  res.json(data);
});

// Modifier sa boutique
router.put("/:id", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin
    .from("boutiques").select("owner_id").eq("id", req.params.id).single();

  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { nom, description, telephone, quartier } = req.body;
  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ nom, description, telephone, quartier })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Annonces / Nouveautés ---
router.get("/:id/annonces", async (req, res) => {
  const [annoncesRes, abonnesRes] = await Promise.all([
    supabaseAdmin.from("annonces").select("*").eq("boutique_id", req.params.id).order("created_at", { ascending: false }),
    supabaseAdmin.from("abonnes").select("id", { count: "exact", head: true }).eq("boutique_id", req.params.id),
  ]);

  res.json({ annonces: annoncesRes.data || [], nb_abonnes: abonnesRes.count || 0 });
});

router.post("/:id/annonces", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { texte } = req.body;
  const { data, error } = await supabaseAdmin
    .from("annonces")
    .insert({ boutique_id: req.params.id, texte })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.post("/:id/abonner", verifyAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from("abonnes")
    .insert({ boutique_id: req.params.id, utilisateur_id: req.user.id });

  if (error && error.code !== "23505") return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Routes ADMIN ---

// Boutiques en attente de validation
router.get("/admin/en-attente", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .select("*, categories(nom)")
    .eq("statut", "en_attente");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Approuver une boutique
router.put("/admin/:id/approuver", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ statut: "actif" })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Suspendre une boutique
router.put("/admin/:id/suspendre", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ statut: "suspendu" })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Supprimer une boutique définitivement
router.delete("/admin/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  await supabaseAdmin.from("produits").delete().eq("boutique_id", req.params.id);
  const { error } = await supabaseAdmin.from("boutiques").delete().eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Supprimer un produit précis (modération)
router.delete("/admin/produits/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("produits").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Certifier une boutique (badge "Boutique certifiée", payant)
router.put("/admin/:id/certifier", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { jours } = req.body;
  const jusqua = jours ? new Date(Date.now() + jours * 24 * 60 * 60 * 1000).toISOString() : null;

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ certifiee: true, certifiee_jusqua: jusqua })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Retirer la certification
router.put("/admin/:id/retirer-certification", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ certifiee: false, certifiee_jusqua: null })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
