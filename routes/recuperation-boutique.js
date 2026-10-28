import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

function normaliserTelephone(tel) {
  return (tel || "").replace(/[^\d]/g, "");
}

function genererCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function genererMotDePasseAleatoire() {
  return Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
}

async function trouverUtilisateurParTelephone(telephoneNormalise) {
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const trouve = data.users.find(
      (u) => normaliserTelephone(u.user_metadata?.telephone) === telephoneNormalise
    );
    if (trouve) return trouve;
    if (data.users.length < 200) return null;
    page++;
  }
}

// Étape 1 (public) : vérifier qu'une boutique correspond bien à ce nom + numéro
router.get("/verifier", async (req, res) => {
  const nom = (req.query.nom || "").trim();
  const telephone = normaliserTelephone(req.query.telephone);
  if (!nom || !telephone) return res.status(400).json({ error: "Nom et numéro requis" });

  const { data, error } = await supabaseAdmin
    .from("boutiques")
    .select("id, nom, telephone")
    .ilike("nom", nom);

  if (error) return res.status(500).json({ error: error.message });

  const trouvee = (data || []).some((b) => normaliserTelephone(b.telephone) === telephone);
  res.json({ trouvee });
});

// Étape 2 (admin uniquement) : générer un code à transmettre manuellement sur WhatsApp
router.post("/generer-code", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const telephone = normaliserTelephone(req.body.telephone);
  if (!telephone) return res.status(400).json({ error: "Numéro requis" });

  const code = genererCode();
  const expireLe = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

  const { error } = await supabaseAdmin
    .from("codes_recuperation_boutique")
    .insert({ telephone, code, expire_le: expireLe });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ code });
});

// Étape 3 (public) : valider le code reçu et ouvrir directement la boutique
router.post("/valider-code", async (req, res) => {
  const telephone = normaliserTelephone(req.body.telephone);
  const { code } = req.body;
  if (!telephone || !code) return res.status(400).json({ error: "Numéro et code requis" });

  const { data: entree, error: erreurCode } = await supabaseAdmin
    .from("codes_recuperation_boutique")
    .select("*")
    .eq("telephone", telephone)
    .eq("code", code)
    .eq("utilise", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurCode || !entree || new Date(entree.expire_le) < new Date()) {
    return res.status(400).json({ error: "Code invalide ou expiré" });
  }

  const utilisateur = await trouverUtilisateurParTelephone(telephone);
  if (!utilisateur) return res.status(404).json({ error: "Aucun compte lié à ce numéro" });

  const nouveauMotDePasse = genererMotDePasseAleatoire();
  const { error: erreurMaj } = await supabaseAdmin.auth.admin.updateUserById(utilisateur.id, {
    password: nouveauMotDePasse,
  });
  if (erreurMaj) return res.status(500).json({ error: erreurMaj.message });

  await supabaseAdmin.from("codes_recuperation_boutique").update({ utilise: true }).eq("id", entree.id);

  res.json({ email: utilisateur.email, motDePasse: nouveauMotDePasse });
});

export default router;
