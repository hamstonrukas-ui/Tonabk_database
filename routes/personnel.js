import express from "express";
import crypto from "crypto";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Les liens des comptes personnel ne périment jamais
const SANS_EXPIRATION = "2999-12-31T00:00:00.000Z";

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

function normaliserTelephone(tel) {
  return (tel || "").replace(/[^\d]/g, "");
}

// Compare deux numéros sur leurs 9 derniers chiffres (0978050574 = +243978050574)
function memeNumero(a, b) {
  const x = normaliserTelephone(a);
  const y = normaliserTelephone(b);
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
}

function genererMotDePasseAleatoire() {
  return crypto.randomUUID() + crypto.randomUUID();
}

function lienPour(token) {
  return `${process.env.ADMIN_URL}/definir-mot-de-passe/${token}`;
}

// Un lien est « permanent » s'il n'est pas marqué utilisé et expire en 2999
// (on compare des dates : la base renvoie le format "…+00:00", pas "….000Z")
const estPermanent = (l) =>
  !l.utilise && new Date(l.expire_le).getTime() === new Date(SANS_EXPIRATION).getTime();

// Garantit que chaque compte a UN lien permanent (créé au besoin, rendu permanent si ancien)
async function assurerLiens(personnelIds) {
  const parPersonne = new Map();
  if (personnelIds.length === 0) return parPersonne;

  const { data: lignes, error: erreurLecture } = await supabaseAdmin
    .from("invitations_personnel")
    .select("id, personnel_id, token, expire_le, utilise")
    .in("personnel_id", personnelIds);

  // Si la lecture échoue, on ne crée rien : sinon on fabriquerait de nouveaux liens à chaque appel
  if (erreurLecture) {
    console.error("assurerLiens (lecture):", erreurLecture.message);
    return parPersonne;
  }

  // Un seul lien par personne : on garde de préférence celui qui est déjà permanent
  const choisi = new Map();
  for (const l of lignes || []) {
    const actuel = choisi.get(l.personnel_id);
    if (!actuel || (estPermanent(l) && !estPermanent(actuel))) choisi.set(l.personnel_id, l);
  }

  const aRendrePermanents = [];
  for (const [personnelId, l] of choisi) {
    parPersonne.set(personnelId, l.token);
    if (!estPermanent(l)) aRendrePermanents.push(l.id);
  }

  if (aRendrePermanents.length > 0) {
    await supabaseAdmin
      .from("invitations_personnel")
      .update({ utilise: false, expire_le: SANS_EXPIRATION })
      .in("id", aRendrePermanents);
  }

  const manquants = personnelIds.filter((id) => !parPersonne.has(id));
  if (manquants.length > 0) {
    const nouvelles = manquants.map((id) => ({
      personnel_id: id,
      token: crypto.randomUUID().replace(/-/g, ""),
      expire_le: SANS_EXPIRATION,
    }));
    const { error } = await supabaseAdmin.from("invitations_personnel").insert(nouvelles);
    if (!error) nouvelles.forEach((n) => parPersonne.set(n.personnel_id, n.token));
  }

  return parPersonne;
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

  const liens = await assurerLiens([data.user.id]);
  const token = liens.get(data.user.id);

  res.status(201).json({
    id: data.user.id,
    nom: nom.trim(),
    telephone,
    email: emailGenere,
    lien: token ? lienPour(token) : null,
    avertissement: token ? undefined : "Compte créé, mais le lien n'a pas pu être généré (rechargez la liste).",
  });
});

// Lister les comptes personnel, chacun avec son lien permanent (admin complet uniquement)
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

  const comptes = tous.filter((u) => u.app_metadata?.role === "admin_secondaire");
  const liens = await assurerLiens(comptes.map((u) => u.id));

  res.json(
    comptes.map((u) => ({
      id: u.id,
      nom: u.user_metadata?.nom || "(sans nom)",
      telephone: u.user_metadata?.telephone || "",
      email: u.email,
      created_at: u.created_at,
      lien: liens.get(u.id) ? lienPour(liens.get(u.id)) : null,
    }))
  );
});

// Retirer un compte personnel (admin complet uniquement)
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// ---- Lien personnel (public) ----

async function trouverInvitation(token) {
  const { data } = await supabaseAdmin
    .from("invitations_personnel")
    .select("id, personnel_id")
    .eq("token", token)
    .eq("utilise", false)
    .eq("expire_le", SANS_EXPIRATION)
    .maybeSingle();
  return data;
}

// Page du lien : on vérifie seulement que le lien existe et on dit bonjour
router.get("/invitation/:token", async (req, res) => {
  const invitation = await trouverInvitation(req.params.token);
  if (!invitation) return res.status(400).json({ error: "Lien invalide" });

  const { data: u } = await supabaseAdmin.auth.admin.getUserById(invitation.personnel_id);
  if (!u?.user) return res.status(400).json({ error: "Ce compte n'existe plus" });
  if (u.user.app_metadata?.role !== "admin_secondaire") return res.status(400).json({ error: "Lien invalide" });
  res.json({ nom: u.user.user_metadata?.nom || "" });
});

// Anti-devinette : 8 essais ratés max par lien, puis pause de 15 minutes
const tentatives = new Map();

// Le lien + le numéro du compte permettent de définir (ou redéfinir) le mot de passe
router.post("/invitation/:token", async (req, res) => {
  const { telephone, motDePasse } = req.body;
  if (!motDePasse || motDePasse.length < 6) {
    return res.status(400).json({ error: "Mot de passe trop court (6 caractères minimum)" });
  }

  const cle = req.params.token;
  const t = tentatives.get(cle);
  if (t && t.n >= 8 && Date.now() - t.debut < 15 * 60 * 1000) {
    return res.status(429).json({ error: "Trop d'essais. Réessayez dans 15 minutes." });
  }

  const invitation = await trouverInvitation(cle);
  if (!invitation) return res.status(400).json({ error: "Lien invalide" });

  const { data: u } = await supabaseAdmin.auth.admin.getUserById(invitation.personnel_id);
  if (!u?.user) return res.status(400).json({ error: "Ce compte n'existe plus" });
  if (u.user.app_metadata?.role !== "admin_secondaire") return res.status(400).json({ error: "Lien invalide" });

  if (!memeNumero(telephone, u.user.user_metadata?.telephone)) {
    const courant = t && Date.now() - t.debut < 15 * 60 * 1000 ? t : { n: 0, debut: Date.now() };
    courant.n += 1;
    tentatives.set(cle, courant);
    return res.status(400).json({ error: "Ce numéro ne correspond pas à ce compte" });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(invitation.personnel_id, {
    password: motDePasse,
  });
  if (error) return res.status(400).json({ error: error.message });

  tentatives.delete(cle);
  res.json({ ok: true, email: u.user.email });
});

export default router;
