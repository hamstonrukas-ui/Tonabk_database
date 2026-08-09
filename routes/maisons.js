import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Publier une maison
router.post("/", verifyAuth, async (req, res) => {
  const { titre, type_bien, quartier, commune, prix, devise, nb_chambres, nb_salles_bain, description, telephone } = req.body;

  const { data, error } = await supabaseAdmin
    .from("maisons")
    .insert({
      publie_par: req.user.id,
      titre, type_bien, quartier, commune, prix, devise,
      nb_chambres, nb_salles_bain, description, telephone,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Lister les maisons disponibles
router.get("/", async (req, res) => {
  const { quartier, type_bien } = req.query;

  let query = supabaseAdmin.from("maisons").select("*, photos_maisons(url, ordre)").eq("statut", "disponible");
  if (quartier) query = query.eq("quartier", quartier);
  if (type_bien) query = query.eq("type_bien", type_bien);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Voir une maison précise
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("maisons")
    .select("*, photos_maisons(url, ordre)")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Maison introuvable" });
  res.json(data);
});

// Modifier sa maison
router.put("/:id", verifyAuth, async (req, res) => {
  const { data: maison } = await supabaseAdmin.from("maisons").select("publie_par").eq("id", req.params.id).single();
  if (!maison) return res.status(404).json({ error: "Maison introuvable" });
  if (maison.publie_par !== req.user.id) return res.status(403).json({ error: "Non autorisé" });

  const { titre, prix, description, statut, nb_chambres, nb_salles_bain } = req.body;
  const { data, error } = await supabaseAdmin
    .from("maisons")
    .update({ titre, prix, description, statut, nb_chambres, nb_salles_bain })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Supprimer une maison
router.delete("/:id", verifyAuth, async (req, res) => {
  const { data: maison } = await supabaseAdmin.from("maisons").select("publie_par").eq("id", req.params.id).single();
  if (!maison) return res.status(404).json({ error: "Maison introuvable" });
  if (maison.publie_par !== req.user.id) return res.status(403).json({ error: "Non autorisé" });

  await supabaseAdmin.from("photos_maisons").delete().eq("maison_id", req.params.id);
  const { error } = await supabaseAdmin.from("maisons").delete().eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// Ajouter une photo à une maison
router.post("/:id/photos", verifyAuth, async (req, res) => {
  const { url, ordre } = req.body;

  const { data: maison } = await supabaseAdmin.from("maisons").select("publie_par").eq("id", req.params.id).single();
  if (!maison || maison.publie_par !== req.user.id) return res.status(403).json({ error: "Non autorisé" });

  const { data, error } = await supabaseAdmin
    .from("photos_maisons")
    .insert({ maison_id: req.params.id, url, ordre: ordre || 0 })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- Routes ADMIN ---

router.put("/admin/:id/suspendre", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("maisons").update({ statut: "suspendu" }).eq("id", req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/admin/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  await supabaseAdmin.from("photos_maisons").delete().eq("maison_id", req.params.id);
  await supabaseAdmin.from("favoris").delete().eq("maison_id", req.params.id);
  const { error } = await supabaseAdmin.from("maisons").delete().eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

router.delete("/admin/photos/:photoId", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("photos_maisons").delete().eq("id", req.params.photoId);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
