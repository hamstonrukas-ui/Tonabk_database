import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function genererCode(prenom) {
  const base = (prenom || "AMI").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase() || "AMI";
  const suffixe = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffixe}`;
}

// Récupère (ou crée) le code de parrainage du user connecté pour une boutique donnée
router.get("/mon-code/:boutiqueId", verifyAuth, async (req, res) => {
  const { boutiqueId } = req.params;

  const { data: existant } = await supabaseAdmin
    .from("codes_parrainage")
    .select("code")
    .eq("utilisateur_id", req.user.id)
    .eq("boutique_id", boutiqueId)
    .maybeSingle();

  if (existant) return res.json({ code: existant.code });

  const prenom = req.query.prenom || req.user.user_metadata?.telephone || "AMI";
  let code = genererCode(prenom);

  // Retente si collision improbable sur le code unique
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabaseAdmin
      .from("codes_parrainage")
      .insert({ utilisateur_id: req.user.id, boutique_id: boutiqueId, code })
      .select("code")
      .single();

    if (!error) return res.json({ code: data.code });
    code = genererCode(prenom);
  }

  res.status(500).json({ error: "Impossible de générer un code de parrainage" });
});

// Liste des filleuls du user connecté pour une boutique
router.get("/mes-filleuls/:boutiqueId", verifyAuth, async (req, res) => {
  const { boutiqueId } = req.params;

  const { data: monCode } = await supabaseAdmin
    .from("codes_parrainage")
    .select("id")
    .eq("utilisateur_id", req.user.id)
    .eq("boutique_id", boutiqueId)
    .maybeSingle();

  if (!monCode) return res.json([]);

  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .select("*")
    .eq("code_id", monCode.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Enregistre un parrainage au moment de la commande (pas besoin d'être connecté)
router.post("/enregistrer", async (req, res) => {
  const { code, boutique_id, filleul_nom, filleul_telephone } = req.body;
  if (!code) return res.status(400).json({ error: "Code manquant" });

  const { data: codeParrainage } = await supabaseAdmin
    .from("codes_parrainage")
    .select("id, boutique_id")
    .eq("code", code.toUpperCase())
    .maybeSingle();

  if (!codeParrainage || codeParrainage.boutique_id !== boutique_id) {
    return res.status(404).json({ error: "Code de parrainage invalide pour cette boutique" });
  }

  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .insert({
      code_id: codeParrainage.id,
      boutique_id,
      filleul_nom: filleul_nom || "Client",
      filleul_telephone,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Admin : lister tous les parrainages (toutes boutiques confondues)
router.get("/admin/tous", verifyAuth, async (req, res) => {
  const estAdmin = req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
  if (!estAdmin) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .select("*, boutiques(nom), codes_parrainage(code, utilisateur_id)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin : valider ou refuser un parrainage
router.put("/admin/:id/statut", verifyAuth, async (req, res) => {
  const estAdmin = req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
  if (!estAdmin) return res.status(403).json({ error: "Réservé à l'admin" });

  const { statut } = req.body; // "validee" ou "refusee"
  const { data, error } = await supabaseAdmin
    .from("parrainages")
    .update({ statut })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
    
