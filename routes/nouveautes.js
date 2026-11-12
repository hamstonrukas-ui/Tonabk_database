import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

const DUREE_HEURES = 48;
const MAX_ACTIVES_PAR_BOUTIQUE = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// --- Public : nouveautés encore actives (moins de 48 h) ---
router.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("nouveautes")
    .select("id, boutique_id, photo_url, texte, created_at, expire_le")
    .gt("expire_le", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set(data.filter((n) => n.boutique_id).map((n) => n.boutique_id))];
  const boutiques = new Map();
  if (ids.length) {
    const { data: lignes } = await supabaseAdmin
      .from("boutiques")
      .select("id, nom, logo_url, certifiee, statut")
      .in("id", ids);
    for (const b of lignes || []) boutiques.set(b.id, b);
  }

  const resultat = [];
  for (const n of data) {
    if (!n.boutique_id) {
      resultat.push({ ...n, auteur_nom: "TonaBk", logo_url: null, certifiee: true });
      continue;
    }
    const b = boutiques.get(n.boutique_id);
    if (!b || b.statut !== "actif") continue; // boutique supprimée ou suspendue : ses nouveautés disparaissent
    resultat.push({ ...n, auteur_nom: b.nom, logo_url: b.logo_url, certifiee: !!b.certifiee });
  }
  res.json(resultat);
});

// --- Mes nouveautés encore actives (commerçant ou admin) ---
router.get("/mes", verifyAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("nouveautes")
    .select("id, boutique_id, photo_url, texte, created_at, expire_le")
    .eq("auteur_id", req.user.id)
    .gt("expire_le", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Publier une nouveauté : { photo_url, texte?, boutique_id? } ---
// Commerçant : boutique_id obligatoire et boutique à lui. Admin : sans boutique_id = publié au nom de TonaBk.
router.post("/", verifyAuth, async (req, res) => {
  const { photo_url, texte, boutique_id } = req.body || {};

  const prefixe = `${process.env.R2_PUBLIC_URL}/nouveautes/`;
  if (typeof photo_url !== "string" || !photo_url.startsWith(prefixe)) {
    return res.status(400).json({ error: "Une photo est requise" });
  }
  const legende = typeof texte === "string" ? texte.trim().slice(0, 200) : "";

  let idBoutique = null;
  if (boutique_id) {
    if (!UUID.test(String(boutique_id))) return res.status(400).json({ error: "Boutique invalide" });
    const { data: boutique } = await supabaseAdmin
      .from("boutiques").select("id, owner_id, statut").eq("id", boutique_id).maybeSingle();
    if (!boutique) return res.status(404).json({ error: "Boutique introuvable" });
    if (boutique.owner_id !== req.user.id && !estAdmin(req)) {
      return res.status(403).json({ error: "Cette boutique n'est pas la vôtre" });
    }
    if (boutique.statut !== "actif") return res.status(403).json({ error: "Votre boutique n'est pas active" });

    const { count } = await supabaseAdmin
      .from("nouveautes")
      .select("id", { count: "exact", head: true })
      .eq("boutique_id", boutique.id)
      .gt("expire_le", new Date().toISOString());
    if ((count || 0) >= MAX_ACTIVES_PAR_BOUTIQUE) {
      return res.status(429).json({
        error: `Vous avez déjà ${MAX_ACTIVES_PAR_BOUTIQUE} nouveautés actives. Supprimez-en une ou attendez qu'elles expirent.`,
      });
    }
    idBoutique = boutique.id;
  } else if (!estAdmin(req)) {
    return res.status(403).json({ error: "Choisissez votre boutique pour publier une nouveauté" });
  }

  const expire = new Date(Date.now() + DUREE_HEURES * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("nouveautes")
    .insert({ boutique_id: idBoutique, auteur_id: req.user.id, photo_url, texte: legende || null, expire_le: expire })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- Supprimer : l'auteur, le propriétaire de la boutique ou l'admin ---
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });

  const { data: n } = await supabaseAdmin
    .from("nouveautes").select("id, auteur_id, boutique_id").eq("id", req.params.id).maybeSingle();
  if (!n) return res.status(404).json({ error: "Nouveauté introuvable" });

  let autorise = estAdmin(req) || n.auteur_id === req.user.id;
  if (!autorise && n.boutique_id) {
    const { data: b } = await supabaseAdmin.from("boutiques").select("owner_id").eq("id", n.boutique_id).maybeSingle();
    autorise = b?.owner_id === req.user.id;
  }
  if (!autorise) return res.status(403).json({ error: "Non autorisé" });

  const { error } = await supabaseAdmin.from("nouveautes").delete().eq("id", n.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
