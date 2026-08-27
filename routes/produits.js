  import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

async function verifierProprietaireBoutique(boutiqueId, userId) {
  const { data } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", boutiqueId).single();
  return data && data.owner_id === userId;
}

// Ajouter un produit
router.post("/", verifyAuth, async (req, res) => {
  const { boutique_id, nom, prix, devise, stock, description, photo_url, photo_thumb_url } = req.body;

  const autorise = await verifierProprietaireBoutique(boutique_id, req.user.id);
  if (!autorise) return res.status(403).json({ error: "Non autorisé sur cette boutique" });

  const { data, error } = await supabaseAdmin
    .from("produits")
    .insert({ boutique_id, nom, prix, devise: devise || "USD", stock, description, photo_url, photo_thumb_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Lister les produits (filtre boutique optionnel)
router.get("/", async (req, res) => {
  const { boutique_id } = req.query;
  let query = supabaseAdmin.from("produits").select("*, boutiques(nom, certifiee)");
  if (boutique_id) query = query.eq("boutique_id", boutique_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Ordre "aléatoire" mais stable pour la journée (nécessaire pour une pagination cohérente) ---
function seedDuJour() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// Accueil : produits sponsorisés en premier, reste mélangé (stable sur la journée), paginé
router.get("/accueil", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, parseInt(req.query.limit) || 10);
  const maintenant = new Date().toISOString();

  const { data: sponsorises } = await supabaseAdmin
    .from("produits")
    .select("*, boutiques(nom, certifiee)")
    .eq("sponsorise", true)
    .gt("sponsorise_jusqua", maintenant);

  const { data: normauxBruts } = await supabaseAdmin
    .from("produits")
    .select("*, boutiques(nom, certifiee)")
    .or(`sponsorise.eq.false,sponsorise.is.null,sponsorise_jusqua.lt.${maintenant}`);

  const seed = seedDuJour();
  const normaux = [...(normauxBruts || [])].sort(
    (a, b) => hash(a.id + seed) - hash(b.id + seed)
  );

  const combinee = [...(sponsorises || []), ...normaux];
  const total = combinee.length;
  const offset = (page - 1) * limit;
  const pageItems = combinee.slice(offset, offset + limit);

  res.json({
    data: pageItems,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// Modifier un produit
router.put("/:id", verifyAuth, async (req, res) => {
  const { data: produit } = await supabaseAdmin.from("produits").select("boutique_id").eq("id", req.params.id).single();
  if (!produit) return res.status(404).json({ error: "Produit introuvable" });

  const autorise = await verifierProprietaireBoutique(produit.boutique_id, req.user.id);
  if (!autorise) return res.status(403).json({ error: "Non autorisé" });

  const { nom, prix, devise, stock, description } = req.body;
  const { data, error } = await supabaseAdmin
    .from("produits")
    .update({ nom, prix, devise, stock, description })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Supprimer un produit
router.delete("/:id", verifyAuth, async (req, res) => {
  const { data: produit } = await supabaseAdmin.from("produits").select("boutique_id").eq("id", req.params.id).single();
  if (!produit) return res.status(404).json({ error: "Produit introuvable" });

  const autorise = await verifierProprietaireBoutique(produit.boutique_id, req.user.id);
  if (!autorise) return res.status(403).json({ error: "Non autorisé" });

  const { error } = await supabaseAdmin.from("produits").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// --- Admin : sponsoring ---
function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

router.put("/admin/:id/sponsoriser", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { jours } = req.body;
  const jusqua = new Date(Date.now() + jours * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("produits")
    .update({ sponsorise: true, sponsorise_jusqua: jusqua })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
  
