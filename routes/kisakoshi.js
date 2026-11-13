import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

const DUREE_JOURS = 7; // un Kisakoshi reste visible 7 jours, sauf s'il est retiré avant (vendu)
const MAX_ACTIFS_PAR_BOUTIQUE = 10;
const MAX_PHOTOS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}
const texte = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const CHAMPS = "id, boutique_id, contenu, prix, devise, photos, message, created_at, expire_le";

// --- Public : Kisakoshi encore actifs, avec la boutique qui les propose ---
router.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("kisakoshi")
    .select(CHAMPS)
    .gt("expire_le", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set(data.map((k) => k.boutique_id))];
  const boutiques = new Map();
  if (ids.length) {
    const { data: lignes } = await supabaseAdmin
      .from("boutiques").select("id, nom, logo_url, certifiee, statut, telephone").in("id", ids);
    for (const b of lignes || []) boutiques.set(b.id, b);
  }

  const resultat = [];
  for (const k of data) {
    const b = boutiques.get(k.boutique_id);
    if (!b || b.statut !== "actif") continue; // boutique supprimée ou suspendue : ses valises disparaissent
    resultat.push({ ...k, auteur_nom: b.nom, logo_url: b.logo_url, certifiee: !!b.certifiee, telephone: b.telephone || null });
  }
  res.json(resultat);
});

// --- Mes Kisakoshi actifs (commerçant) ou tous les actifs (admin) ---
router.get("/mes", verifyAuth, async (req, res) => {
  let requete = supabaseAdmin
    .from("kisakoshi").select(CHAMPS).gt("expire_le", new Date().toISOString()).order("created_at", { ascending: false });
  if (!estAdmin(req)) requete = requete.eq("auteur_id", req.user.id);
  const { data, error } = await requete;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Créer : { boutique_id, contenu, prix, devise, photos: [url, ... 10 max], message? } ---
// Commerçant : sa propre boutique. Admin : n'importe quelle boutique.
router.post("/", verifyAuth, async (req, res) => {
  const { boutique_id, prix, devise } = req.body || {};
  const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
  const contenu = texte(req.body?.contenu, 200);
  const message = texte(req.body?.message, 300);

  if (!contenu) return res.status(400).json({ error: "Décrivez le contenu de la valise (ex : 2 pantalons + 3 jupes)" });
  const prixNombre = Number(prix);
  if (!Number.isFinite(prixNombre) || prixNombre <= 0 || prixNombre > 1e9) return res.status(400).json({ error: "Prix invalide" });
  if (!["USD", "CDF"].includes(devise)) return res.status(400).json({ error: "Devise invalide" });

  const prefixe = `${process.env.R2_PUBLIC_URL}/nouveautes/`;
  if (photos.length === 0) return res.status(400).json({ error: "Une photo au moins est requise" });
  if (photos.length > MAX_PHOTOS) return res.status(400).json({ error: `${MAX_PHOTOS} photos maximum par Kisakoshi` });
  if (!photos.every((u) => typeof u === "string" && u.startsWith(prefixe))) {
    return res.status(400).json({ error: "Photo invalide" });
  }

  if (!UUID.test(String(boutique_id || ""))) return res.status(400).json({ error: "Choisissez une boutique" });
  const { data: boutique } = await supabaseAdmin
    .from("boutiques").select("id, owner_id, statut").eq("id", boutique_id).maybeSingle();
  if (!boutique) return res.status(404).json({ error: "Boutique introuvable" });
  if (boutique.owner_id !== req.user.id && !estAdmin(req)) {
    return res.status(403).json({ error: "Cette boutique n'est pas la vôtre" });
  }
  if (boutique.statut !== "actif") return res.status(403).json({ error: "Cette boutique n'est pas active" });

  const { count } = await supabaseAdmin
    .from("kisakoshi").select("id", { count: "exact", head: true })
    .eq("boutique_id", boutique.id).gt("expire_le", new Date().toISOString());
  if ((count || 0) >= MAX_ACTIFS_PAR_BOUTIQUE) {
    return res.status(429).json({ error: `Cette boutique a déjà ${MAX_ACTIFS_PAR_BOUTIQUE} Kisakoshi actifs. Retirez-en un (vendu ?) avant d'en ajouter.` });
  }

  const expire = new Date(Date.now() + DUREE_JOURS * 86400 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("kisakoshi")
    .insert({ boutique_id: boutique.id, auteur_id: req.user.id, contenu, prix: prixNombre, devise, photos, message: message || null, expire_le: expire })
    .select(CHAMPS)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- Retirer (vendu, erreur…) : l'auteur, le propriétaire de la boutique ou l'admin ---
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });
  const { data: k } = await supabaseAdmin
    .from("kisakoshi").select("id, auteur_id, boutique_id").eq("id", req.params.id).maybeSingle();
  if (!k) return res.status(404).json({ error: "Kisakoshi introuvable" });

  let autorise = estAdmin(req) || k.auteur_id === req.user.id;
  if (!autorise) {
    const { data: b } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", k.boutique_id).maybeSingle();
    autorise = b?.owner_id === req.user.id;
  }
  if (!autorise) return res.status(403).json({ error: "Non autorisé" });

  const { error } = await supabaseAdmin.from("kisakoshi").delete().eq("id", k.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
