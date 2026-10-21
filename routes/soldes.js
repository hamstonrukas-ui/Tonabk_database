import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Liste publique des soldes en cours (pas encore expirés)
router.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("soldes")
    .select("*")
    .gt("expire_le", new Date().toISOString())
    .order("expire_le", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Une annonce de solde précise (pour la page détail / galerie photos)
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("soldes")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Solde introuvable" });
  res.json(data);
});

// Créer un solde (admin uniquement)
router.post("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { titre, description, prix_normal, prix_solde, devise, quantite, photo_url, photos, expire_le } = req.body;

  if (!titre?.trim() || !prix_normal || !prix_solde || !expire_le) {
    return res.status(400).json({ error: "Titre, prix normal, prix solde et date de fin requis" });
  }

  const { data, error } = await supabaseAdmin
    .from("soldes")
    .insert({
      titre: titre.trim(),
      description: description || null,
      prix_normal: Number(prix_normal),
      prix_solde: Number(prix_solde),
      devise: devise || "USD",
      quantite: Number(quantite) || 0,
      photo_url: photo_url || (photos?.[0] ?? null),
      photos: photos || [],
      expire_le,
      cree_par: req.user.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Modifier un solde (admin uniquement)
router.put("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { titre, description, prix_normal, prix_solde, devise, quantite, photo_url, photos, expire_le } = req.body;

  const { data, error } = await supabaseAdmin
    .from("soldes")
    .update({
      titre, description,
      prix_normal: prix_normal != null ? Number(prix_normal) : undefined,
      prix_solde: prix_solde != null ? Number(prix_solde) : undefined,
      devise,
      quantite: quantite != null ? Number(quantite) : undefined,
      photo_url, photos, expire_le,
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Supprimer un solde (admin uniquement)
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("soldes").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
