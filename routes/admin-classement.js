import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Réservé à l'admin : même vérification que les autres routes admin (boutiques, personnel, maisons...)
function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// GET /api/admin-classement/produits?categorie_id=...&statut=a_ranger|ranges|rupture&page=1&limit=60
// a_ranger = articles de cette catégorie PAS ENCORE rangés ; ranges = déjà rangés (pour corriger une erreur)
// rupture = articles en rupture de stock (stock à 0), rangés ou non, pour leur remettre une quantité
router.get("/produits", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { categorie_id, statut } = req.query;
  if (!categorie_id) return res.status(400).json({ error: "categorie_id requis" });
  const q = String(req.query.q || "").replace(/[%_,()]/g, " ").trim().slice(0, 60);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 60));

  let requete = supabaseAdmin
    .from("produits")
    .select(
      "id, nom, prix, devise, stock, photo_url, photo_thumb_url, sous_categorie_id, sous_categories(nom), boutiques!inner(nom, categorie_id)",
      { count: "exact" }
    )
    .eq("boutiques.categorie_id", categorie_id)
    .order("nom")
    .range((page - 1) * limit, page * limit - 1);

  if (q) requete = requete.ilike("nom", `%${q}%`);

  if (statut === "rupture") {
    requete = requete.or("stock.lte.0,stock.is.null");
  } else {
    requete = statut === "ranges"
      ? requete.not("sous_categorie_id", "is", null)
      : requete.is("sous_categorie_id", null);
  }

  const { data, error, count } = await requete;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count ?? data.length, page });
});

// PUT /api/admin-classement/produits/:id/prix   { prix, devise? }
// L'admin corrige le prix d'un article (les commerçants mettent parfois des prix trop élevés).
router.put("/produits/:id/prix", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { id } = req.params;
  if (!/^[\w-]{1,64}$/.test(id)) return res.status(400).json({ error: "Identifiant d'article invalide" });

  const prix = Number(req.body?.prix);
  if (!Number.isFinite(prix) || prix <= 0 || prix > 1e9) {
    return res.status(400).json({ error: "Prix invalide" });
  }
  const devise = req.body?.devise;
  if (devise !== undefined && !["USD", "CDF"].includes(devise)) {
    return res.status(400).json({ error: "Devise invalide" });
  }

  const miseAJour = { prix };
  if (devise) miseAJour.devise = devise;

  const { data, error } = await supabaseAdmin
    .from("produits")
    .update(miseAJour)
    .eq("id", id)
    .select("id, prix, devise")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Article introuvable" });
  res.json({ ok: true, ...data });
});

// PUT /api/admin-classement/produits/:id/stock   { stock }
// L'admin remet une quantité sur un article en rupture (ou corrige un stock).
router.put("/produits/:id/stock", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { id } = req.params;
  if (!/^[\w-]{1,64}$/.test(id)) return res.status(400).json({ error: "Identifiant d'article invalide" });

  const stock = Number(req.body?.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1e6) {
    return res.status(400).json({ error: "Stock invalide (nombre entier de 0 à 1 000 000)" });
  }

  const { data, error } = await supabaseAdmin
    .from("produits")
    .update({ stock })
    .eq("id", id)
    .select("id, stock")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Article introuvable" });
  res.json({ ok: true, ...data });
});

// POST /api/admin-classement/stock-aleatoire   { produit_ids: [...] }
// Donne à chaque article un stock au hasard de 1 à 100 (jamais 0).
router.post("/stock-aleatoire", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { produit_ids } = req.body || {};
  if (!Array.isArray(produit_ids) || produit_ids.length === 0 || produit_ids.length > 200) {
    return res.status(400).json({ error: "Liste d'articles invalide" });
  }
  if (!produit_ids.every((id) => UUID.test(String(id)))) {
    return res.status(400).json({ error: "Identifiant d'article invalide" });
  }

  const resultats = await Promise.all(
    produit_ids.map((id) =>
      supabaseAdmin.from("produits").update({ stock: Math.floor(Math.random() * 100) + 1 }).eq("id", id)
    )
  );
  const echecs = resultats.filter((r) => r.error).length;
  if (echecs === produit_ids.length) return res.status(500).json({ error: "Échec de la mise à jour" });
  res.json({ ok: true, modifies: produit_ids.length - echecs, echecs });
});

// POST /api/admin-classement/classer
// { produit_ids: [...], sous_categorie_id: "<id>" }   -> range les articles
// { produit_ids: [...], sous_categorie_id: null }     -> les remet "à ranger"
router.post("/classer", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { produit_ids, sous_categorie_id } = req.body || {};
  if (!Array.isArray(produit_ids) || produit_ids.length === 0 || produit_ids.length > 500) {
    return res.status(400).json({ error: "Liste d'articles invalide" });
  }
  if (!produit_ids.every((id) => UUID.test(String(id)))) {
    return res.status(400).json({ error: "Identifiant d'article invalide" });
  }

  let cible = null;
  if (sous_categorie_id) {
    if (!UUID.test(String(sous_categorie_id))) return res.status(400).json({ error: "Sous-catégorie invalide" });
    const { data } = await supabaseAdmin
      .from("sous_categories")
      .select("id")
      .eq("id", sous_categorie_id)
      .eq("actif", true)
      .maybeSingle();
    if (!data) return res.status(400).json({ error: "Sous-catégorie introuvable" });
    cible = data.id;
  }

  const { error, count } = await supabaseAdmin
    .from("produits")
    .update({ sous_categorie_id: cible }, { count: "exact" })
    .in("id", produit_ids);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, modifies: count ?? produit_ids.length });
});

export default router;
