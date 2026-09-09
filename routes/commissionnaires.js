import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Récupérer mon profil d'agence (ou null si pas encore créé)
router.get("/mon-profil", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("profils_commissionnaires")
    .select("*")
    .eq("user_id", req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Créer ou mettre à jour mon profil d'agence
router.put("/mon-profil", verifyAuth, async (req, res) => {
  const { nom_agence, telephone } = req.body;
  if (!nom_agence || !nom_agence.trim()) {
    return res.status(400).json({ error: "Le nom de l'agence est requis" });
  }

  const { data, error } = await supabaseAdmin
    .from("profils_commissionnaires")
    .upsert({ user_id: req.user.id, nom_agence: nom_agence.trim(), telephone }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
                                
