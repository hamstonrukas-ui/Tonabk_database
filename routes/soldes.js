import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { ajouterStock } from "../middleware/stockSolde.js";

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
  try {
    res.json(await ajouterStock(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Une annonce de solde précise (pour la page détail / galerie photos)
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("soldes")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Solde introuvable" });
  try {
    res.json(await ajouterStock(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Créer un solde (admin uniquement)
router.post("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { titre, description, prix_normal, prix_solde, devise, quantite, photo_url, photos, expire_le, audio_url } = req.body;

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
      audio_url: audio_url || null,
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

  const { titre, description, prix_normal, prix_solde, devise, quantite, photo_url, photos, expire_le, audio_url } = req.body;

  const { data, error } = await supabaseAdmin
    .from("soldes")
    .update({
      titre, description,
      prix_normal: prix_normal != null ? Number(prix_normal) : undefined,
      prix_solde: prix_solde != null ? Number(prix_solde) : undefined,
      devise,
      quantite: quantite != null ? Number(quantite) : undefined,
      photo_url, photos, expire_le,
      audio_url, // absent = inchangé ; null = audio retiré
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Enregistrer une vente faite hors application (WhatsApp...) : delta = +1 ou -1 (admin uniquement)
router.post("/:id/vendus", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) {
    return res.status(400).json({ error: "Variation invalide" });
  }

  const { data: ligne, error: erreurLecture } = await supabaseAdmin
    .from("soldes")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (erreurLecture) return res.status(500).json({ error: erreurLecture.message });
  if (!ligne) return res.status(404).json({ error: "Solde introuvable" });

  try {
    const actuel = await ajouterStock(ligne);
    // Les ventes manuelles ne peuvent pas dépasser ce qui reste en stock
    const plafond = ligne.quantite > 0 ? Math.max(0, ligne.quantite - actuel.vendus_auto) : Infinity;
    const vendus = Math.min(plafond, Math.max(0, (ligne.vendus || 0) + delta));

    const { data, error } = await supabaseAdmin
      .from("soldes")
      .update({ vendus })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    res.json(await ajouterStock(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Définir directement la quantité restante (admin uniquement) : { restant: 12 }
router.post("/:id/reste", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const restant = Number(req.body?.restant);
  const { data: ligne, error: erreurLecture } = await supabaseAdmin
    .from("soldes")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (erreurLecture) return res.status(500).json({ error: erreurLecture.message });
  if (!ligne) return res.status(404).json({ error: "Solde introuvable" });
  if (!(ligne.quantite > 0)) return res.status(400).json({ error: "La quantité de ce solde n'est pas suivie" });
  if (!Number.isInteger(restant) || restant < 0 || restant > ligne.quantite) {
    return res.status(400).json({ error: `Le reste doit être un entier entre 0 et ${ligne.quantite}` });
  }

  const { data, error } = await supabaseAdmin
    .from("soldes")
    .update({ vendus: ligne.quantite - restant })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  try {
    res.json(await ajouterStock(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Supprimer un solde (admin uniquement)
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("soldes").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
