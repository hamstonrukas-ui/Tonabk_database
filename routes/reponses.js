import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Répondre à une requête (n'importe quel utilisateur connecté)
router.post("/", verifyAuth, async (req, res) => {
  const { requete_id, message, prix_propose } = req.body;

  const { data, error } = await supabaseAdmin
    .from("reponses_requetes")
    .insert({ requete_id, repondant_id: req.user.id, message, prix_propose, vue: false })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: "Réponse envoyée, l'équipe va vous recontacter." });
});

// Admin : réponses non lues
router.get("/admin/non-lues", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("reponses_requetes")
    .select("*, requetes(description), repondant:repondant_id(email)")
    .eq("vue", false)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/:id/vue", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  await supabaseAdmin.from("reponses_requetes").update({ vue: true }).eq("id", req.params.id);
  res.json({ ok: true });
});

router.delete("/admin/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.from("reponses_requetes").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

export default router;
