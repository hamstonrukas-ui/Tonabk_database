import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();
const SEUIL_FAIBLE = 5;

async function maBoutique(userId) {
  const { data } = await supabaseAdmin.from("boutiques").select("id, taux_change_fc").eq("owner_id", userId).maybeSingle();
  return data;
}

async function verifierProprietaireArticle(articleId, userId) {
  const { data: article } = await supabaseAdmin
    .from("articles_inventaire")
    .select("id, boutique_id, boutiques(owner_id)")
    .eq("id", articleId)
    .single();

  if (!article || article.boutiques?.owner_id !== userId) return null;
  return article;
}

async function calculerQuantites(articleIds) {
  if (articleIds.length === 0) return {};
  const { data: mouvements } = await supabaseAdmin
    .from("mouvements_stock")
    .select("article_id, type, quantite")
    .in("article_id", articleIds);

  const quantites = {};
  for (const m of mouvements || []) {
    const delta = m.type === "achat" ? m.quantite : -m.quantite;
    quantites[m.article_id] = (quantites[m.article_id] || 0) + delta;
  }
  return quantites;
}

// --- ARTICLES ---

router.get("/articles", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.json([]);

  const { data: articles, error } = await supabaseAdmin
    .from("articles_inventaire")
    .select("*")
    .eq("boutique_id", boutique.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const quantites = await calculerQuantites(articles.map((a) => a.id));
  res.json(articles.map((a) => ({ ...a, quantite: quantites[a.id] || 0 })));
});

router.post("/articles", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.status(403).json({ error: "Vous n'avez pas encore de boutique" });

  const { nom, prix, devise } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Le nom de l'article est requis" });
  if (prix === undefined || prix === null || prix < 0) return res.status(400).json({ error: "Prix invalide" });

  const { data, error } = await supabaseAdmin
    .from("articles_inventaire")
    .insert({ boutique_id: boutique.id, nom: nom.trim(), prix, devise: devise || "USD" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ...data, quantite: 0 });
});

router.put("/articles/:id", verifyAuth, async (req, res) => {
  const article = await verifierProprietaireArticle(req.params.id, req.user.id);
  if (!article) return res.status(403).json({ error: "Non autorisé" });

  const { nom, prix, devise } = req.body;
  const { data, error } = await supabaseAdmin
    .from("articles_inventaire")
    .update({ nom, prix, devise })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/articles/:id", verifyAuth, async (req, res) => {
  const article = await verifierProprietaireArticle(req.params.id, req.user.id);
  if (!article) return res.status(403).json({ error: "Non autorisé" });

  await supabaseAdmin.from("articles_inventaire").delete().eq("id", req.params.id);
  res.status(204).end();
});

// --- ACHATS ---

router.get("/achats", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.json([]);

  const { data: articles } = await supabaseAdmin.from("articles_inventaire").select("id, nom, devise").eq("boutique_id", boutique.id);
  const idsArticles = (articles || []).map((a) => a.id);
  if (idsArticles.length === 0) return res.json([]);

  const { data: achats, error } = await supabaseAdmin
    .from("mouvements_stock")
    .select("*")
    .eq("type", "achat")
    .in("article_id", idsArticles)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const nomParId = Object.fromEntries((articles || []).map((a) => [a.id, a.nom]));
  res.json(achats.map((a) => ({ ...a, nom_article: nomParId[a.article_id] })));
});

router.post("/articles/:id/achat", verifyAuth, async (req, res) => {
  const article = await verifierProprietaireArticle(req.params.id, req.user.id);
  if (!article) return res.status(403).json({ error: "Non autorisé" });

  const { quantite, prix_unitaire } = req.body;
  if (!quantite || quantite <= 0) return res.status(400).json({ error: "Quantité invalide" });

  const { data, error } = await supabaseAdmin
    .from("mouvements_stock")
    .insert({ article_id: req.params.id, type: "achat", quantite, prix_unitaire: prix_unitaire || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- VENTES ---

router.get("/ventes", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.json([]);

  const { data: articles } = await supabaseAdmin.from("articles_inventaire").select("id, nom, devise").eq("boutique_id", boutique.id);
  const idsArticles = (articles || []).map((a) => a.id);
  if (idsArticles.length === 0) return res.json([]);

  const { data: ventes, error } = await supabaseAdmin
    .from("mouvements_stock")
    .select("*")
    .eq("type", "vente")
    .in("article_id", idsArticles)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const infoParId = Object.fromEntries((articles || []).map((a) => [a.id, a]));
  res.json(ventes.map((v) => ({ ...v, nom_article: infoParId[v.article_id]?.nom, devise: infoParId[v.article_id]?.devise })));
});

router.post("/articles/:id/vente", verifyAuth, async (req, res) => {
  const article = await verifierProprietaireArticle(req.params.id, req.user.id);
  if (!article) return res.status(403).json({ error: "Non autorisé" });

  const { quantite, prix_unitaire } = req.body;
  if (!quantite || quantite <= 0) return res.status(400).json({ error: "Quantité invalide" });

  const quantites = await calculerQuantites([req.params.id]);
  const stockActuel = quantites[req.params.id] || 0;
  if (quantite > stockActuel) {
    return res.status(400).json({ error: `Stock insuffisant (${stockActuel} disponible(s))` });
  }

  const { data, error } = await supabaseAdmin
    .from("mouvements_stock")
    .insert({ article_id: req.params.id, type: "vente", quantite, prix_unitaire: prix_unitaire || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- STOCK (vue d'ensemble) ---

router.get("/stock", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.json({ articles: [], taux_change_fc: 2500 });

  const { data: articles, error } = await supabaseAdmin
    .from("articles_inventaire")
    .select("*")
    .eq("boutique_id", boutique.id);

  if (error) return res.status(500).json({ error: error.message });

  const quantites = await calculerQuantites(articles.map((a) => a.id));

  const articlesAvecEtat = articles.map((a) => {
    const quantite = quantites[a.id] || 0;
    const etat = quantite === 0 ? "rupture" : quantite <= SEUIL_FAIBLE ? "faible" : "normal";
    return { ...a, quantite, etat };
  });

  res.json({ articles: articlesAvecEtat, taux_change_fc: boutique.taux_change_fc });
});

router.put("/taux-change", verifyAuth, async (req, res) => {
  const boutique = await maBoutique(req.user.id);
  if (!boutique) return res.status(403).json({ error: "Vous n'avez pas encore de boutique" });

  const { taux_change_fc } = req.body;
  if (!taux_change_fc || taux_change_fc <= 0) return res.status(400).json({ error: "Taux invalide" });

  const { error } = await supabaseAdmin
    .from("boutiques")
    .update({ taux_change_fc })
    .eq("id", boutique.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ taux_change_fc });
});

export default router;
           
