import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();
const MAX_PRODUITS_SUIVIS = 10;

// Vérifie que l'utilisateur possède bien la boutique à laquelle appartient ce produit
async function verifierProprietaireProduit(produitId, userId) {
  const { data: produit } = await supabaseAdmin
    .from("produits")
    .select("id, boutique_id, boutiques(owner_id)")
    .eq("id", produitId)
    .single();

  if (!produit || produit.boutiques?.owner_id !== userId) return null;
  return produit;
}

// Liste les produits de MA boutique avec leur statut de suivi et leur quantité interne calculée
router.get("/produits", verifyAuth, async (req, res) => {
  const { data: boutique } = await supabaseAdmin
    .from("boutiques")
    .select("id")
    .eq("owner_id", req.user.id)
    .maybeSingle();

  if (!boutique) return res.json([]);

  const { data: produits, error } = await supabaseAdmin
    .from("produits")
    .select("id, nom, photo_thumb_url, photo_url, inventaire_actif")
    .eq("boutique_id", boutique.id);

  if (error) return res.status(500).json({ error: error.message });

  const idsSuivis = produits.filter((p) => p.inventaire_actif).map((p) => p.id);
  let quantites = {};

  if (idsSuivis.length > 0) {
    const { data: mouvements } = await supabaseAdmin
      .from("mouvements_stock")
      .select("produit_id, type, quantite")
      .in("produit_id", idsSuivis);

    for (const m of mouvements || []) {
      const delta = m.type === "achat" ? m.quantite : -m.quantite;
      quantites[m.produit_id] = (quantites[m.produit_id] || 0) + delta;
    }
  }

  res.json(produits.map((p) => ({ ...p, quantite_inventaire: quantites[p.id] || 0 })));
});

// Activer/désactiver le suivi détaillé d'un produit (max 10 actifs à la fois)
router.put("/produits/:id/suivi", verifyAuth, async (req, res) => {
  const produit = await verifierProprietaireProduit(req.params.id, req.user.id);
  if (!produit) return res.status(403).json({ error: "Non autorisé" });

  const { actif } = req.body;

  if (actif) {
    const { count } = await supabaseAdmin
      .from("produits")
      .select("id", { count: "exact", head: true })
      .eq("boutique_id", produit.boutique_id)
      .eq("inventaire_actif", true);

    if (count >= MAX_PRODUITS_SUIVIS) {
      return res.status(400).json({ error: `Vous suivez déjà ${MAX_PRODUITS_SUIVIS} produits, le maximum autorisé.` });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("produits")
    .update({ inventaire_actif: !!actif })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Historique des mouvements d'un produit suivi
router.get("/produits/:id/mouvements", verifyAuth, async (req, res) => {
  const produit = await verifierProprietaireProduit(req.params.id, req.user.id);
  if (!produit) return res.status(403).json({ error: "Non autorisé" });

  const { data, error } = await supabaseAdmin
    .from("mouvements_stock")
    .select("*")
    .eq("produit_id", req.params.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Ajouter un achat ou une vente au carnet interne
router.post("/produits/:id/mouvements", verifyAuth, async (req, res) => {
  const produit = await verifierProprietaireProduit(req.params.id, req.user.id);
  if (!produit) return res.status(403).json({ error: "Non autorisé" });
  if (!produit.inventaire_actif) {
    return res.status(400).json({ error: "Le suivi n'est pas activé pour ce produit" });
  }

  const { type, quantite, prix_unitaire, devise, note } = req.body;
  if (!["achat", "vente"].includes(type)) return res.status(400).json({ error: "Type invalide" });
  if (!quantite || quantite <= 0) return res.status(400).json({ error: "Quantité invalide" });

  const { data, error } = await supabaseAdmin
    .from("mouvements_stock")
    .insert({
      produit_id: req.params.id,
      type,
      quantite,
      prix_unitaire: prix_unitaire || null,
      devise: devise || "USD",
      note: note || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Supprimer un mouvement (erreur de saisie)
router.delete("/mouvements/:id", verifyAuth, async (req, res) => {
  const { data: mouvement } = await supabaseAdmin
    .from("mouvements_stock")
    .select("id, produit_id")
    .eq("id", req.params.id)
    .single();

  if (!mouvement) return res.status(404).json({ error: "Introuvable" });

  const produit = await verifierProprietaireProduit(mouvement.produit_id, req.user.id);
  if (!produit) return res.status(403).json({ error: "Non autorisé" });

  await supabaseAdmin.from("mouvements_stock").delete().eq("id", req.params.id);
  res.status(204).end();
});

export default router;
