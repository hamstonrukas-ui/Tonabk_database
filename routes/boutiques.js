
import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Créer une boutique — active immédiatement, en attente de revue admin (pas de blocage public)
router.post("/", verifyAuth, async (req, res) => {
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
      statut: "actif",
      revue_admin: false,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
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

// Lister les boutiques actives
router.get("/", async (req, res) => {
  const { categorie_id } = req.query;
  let query = supabaseAdmin.from("boutiques").select("*, categories(nom, icone)").eq("statut", "actif");
  if (categorie_id) query = query.eq("categorie_id", categorie_id);

  const { data, error } = await query;
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
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
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

// --- Abonnements ---
router.get("/:id/est-abonne", verifyAuth, async (req, res) => {
  const { data } = await supabaseAdmin
    .from("abonnes")
    .select("id")
    .eq("boutique_id", req.params.id)
    .eq("utilisateur_id", req.user.id)
    .maybeSingle();

  res.json({ abonne: !!data });
});

router.get("/:id/abonnes", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { data: abonnes } = await supabaseAdmin
    .from("abonnes")
    .select("utilisateur_id")
    .eq("boutique_id", req.params.id);

  const resultats = [];
  for (const a of abonnes || []) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(a.utilisateur_id);
    const telephone = data?.user?.user_metadata?.telephone;
    if (telephone) resultats.push({ id: a.utilisateur_id, telephone, source: "compte" });
  }

  const { data: contacts } = await supabaseAdmin
    .from("contacts_boutique")
    .select("*")
    .eq("boutique_id", req.params.id);

  for (const c of contacts || []) {
    resultats.push({ id: c.id, nom: c.nom, telephone: c.telephone, source: "manuel" });
  }

  res.json(resultats);
});

router.post("/:id/contacts", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { nom, telephone } = req.body;
  if (!telephone) return res.status(400).json({ error: "Numéro de téléphone requis" });

  const { data, error } = await supabaseAdmin
    .from("contacts_boutique")
    .insert({ boutique_id: req.params.id, nom: nom || null, telephone })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete("/:id/contacts/:contactId", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  await supabaseAdmin.from("contacts_boutique").delete().eq("id", req.params.contactId);
  res.json({ ok: true });
});

router.post("/:id/abonner", verifyAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from("abonnes")
    .insert({ boutique_id: req.params.id, utilisateur_id: req.user.id });

  if (error && error.code !== "23505") return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/:id/abonner", verifyAuth, async (req, res) => {
  await supabaseAdmin
    .from("abonnes")
    .delete()
    .eq("boutique_id", req.params.id)
    .eq("utilisateur_id", req.user.id);

  res.json({ ok: true });
});

// --- Journal privé du vendeur (notes personnelles) ---
router.get("/:id/notes", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { data, error } = await supabaseAdmin
    .from("notes_boutique")
    .select("*")
    .eq("boutique_id", req.params.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/:id/notes", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", req.params.id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const { texte } = req.body;
  if (!texte || !texte.trim()) return res.status(400).json({ error: "Le texte ne peut pas être vide" });

  const { data, error } = await supabaseAdmin
    .from("notes_boutique")
    .insert({ boutique_id: req.params.id, texte: texte.trim() })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete("/notes/:noteId", verifyAuth, async (req, res) => {
  const { data: note } = await supabaseAdmin
    .from("notes_boutique")
    .select("boutique_id")
    .eq("id", req.params.noteId)
    .single();
  if (!note) return res.status(404).json({ error: "Note introuvable" });

  const { data: boutique } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", note.boutique_id).single();
  if (!boutique || boutique.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  await supabaseAdmin.from("notes_boutique").delete().eq("id", req.params.noteId);
  res.status(204).send();
});

// --- Routes ADMIN ---

// Boutiques pas encore examinées par l'admin (toujours actives publiquement entre-temps)
router.get("/admin/nouvelles", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .select("*, categories(nom)")
    .eq("revue_admin", false)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Marquer une boutique comme examinée (n'affecte pas sa visibilité publique)
router.put("/admin/:id/marquer-vue", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .update({ revue_admin: true })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

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

router.put("/admin/:id/reactiver", verifyAuth, async (req, res) => {
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

router.delete("/admin/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  await supabaseAdmin.from("produits").delete().eq("boutique_id", req.params.id);
  const { error } = await supabaseAdmin.from("boutiques").delete().eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

router.delete("/admin/produits/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("produits").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

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
