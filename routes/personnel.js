import express from "express";
import crypto from "crypto";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

function normaliserTelephone(tel) {
  return (tel || "").replace(/[^\d]/g, "");
}

function genererMotDePasseAleatoire() {
  // Jamais communiqué : le personnel définit son propre mot de passe via WhatsApp.
  return crypto.randomUUID() + crypto.randomUUID();
}

// Créer un compte personnel (admin complet uniquement)
router.post("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { nom } = req.body;
  const telephone = normaliserTelephone(req.body.telephone);
  if (!nom?.trim() || !telephone) {
    return res.status(400).json({ error: "Nom et numéro WhatsApp requis" });
  }

  const emailGenere = `${telephone}@personnel.tonabk.app`;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: emailGenere,
    password: genererMotDePasseAleatoire(),
    email_confirm: true,
    user_metadata: { nom: nom.trim(), telephone, role: "personnel" },
    app_metadata: { role: "admin_secondaire" },
  });

  if (error) return res.status(400).json({ error: error.message });

  // Lien interne (même esprit que les liens de partage produit) : un code
  // unique stocké dans notre propre table, rien côté Supabase Auth.
  const token = crypto.randomUUID().replace(/-/g, "");
  const expireLe = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 jours

  const { error: erreurToken } = await supabaseAdmin
    .from("invitations_personnel")
    .insert({ personnel_id: data.user.id, token, expire_le: expireLe });

  if (erreurToken) {
    return res.status(201).json({
      id: data.user.id, nom: nom.trim(), telephone, email: emailGenere,
      lien: null, avertissement: "Compte créé, mais échec de la génération du lien : " + erreurToken.message,
    });
  }

  res.status(201).json({
    id: data.user.id,
    nom: nom.trim(),
    telephone,
    email: emailGenere,
    lien: `${process.env.ADMIN_URL}/definir-mot-de-passe/${token}`,
  });
});

// Vérifier un lien d'invitation (page de définition du mot de passe)
router.get("/invitation/:token", async (req, res) => {
  const { data: invitation, error } = await supabaseAdmin
    .from("invitations_personnel")
    .select("*")
    .eq("token", req.params.token)
    .eq("utilise", false)
    .maybeSingle();

  if (error || !invitation || new Date(invitation.expire_le) < new Date()) {
    return res.status(400).json({ error: "Lien invalide ou expiré" });
  }

  const { data: utilisateur } = await supabaseAdmin.auth.admin.getUserById(invitation.personnel_id);
  res.json({ nom: utilisateur?.user?.user_metadata?.nom || "" });
});

// Définir le mot de passe via le lien d'invitation
router.post("/invitation/:token", async (req, res) => {
  const { motDePasse } = req.body;
  if (!motDePasse || motDePasse.length < 6) {
    return res.status(400).json({ error: "Mot de passe trop court" });
  }

  const { data: invitation, error } = await supabaseAdmin
    .from("invitations_personnel")
    .select("*")
    .eq("token", req.params.token)
    .eq("utilise", false)
    .maybeSingle();

  if (error || !invitation || new Date(invitation.expire_le) < new Date()) {
    return res.status(400).json({ error: "Lien invalide ou expiré" });
  }

  const { error: erreurMaj } = await supabaseAdmin.auth.admin.updateUserById(invitation.personnel_id, {
    password: motDePasse,
  });
  if (erreurMaj) return res.status(400).json({ error: erreurMaj.message });

  await supabaseAdmin.from("invitations_personnel").update({ utilise: true }).eq("id", invitation.id);

  res.json({ ok: true });
});

// Lister les comptes personnel (admin complet uniquement)
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  let tous = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return res.status(500).json({ error: error.message });
    tous = tous.concat(data.users);
    if (data.users.length < 200) break;
    page++;
  }

  const personnel = tous
    .filter((u) => u.app_metadata?.role === "admin_secondaire")
    .map((u) => ({
      id: u.id,
      nom: u.user_metadata?.nom || "(sans nom)",
      telephone: u.user_metadata?.telephone || "",
      email: u.email,
      created_at: u.created_at,
    }));

  res.json(personnel);
});

// Retirer un compte personnel (admin complet uniquement)
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

export default router;
