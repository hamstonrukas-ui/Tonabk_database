// Sensibilisation terrain : chaque agent a une adresse personnelle (tonabk.com/<code>).
// - Public : enregistrer un événement (visite, installation, WhatsApp, Livre-moi, colis)
// - Admin principal : créer / supprimer l'adresse d'un agent
import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();
const estAdmin = (req) => req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9]{3,20}$/;
const TYPES = ["visite", "installation", "whatsapp", "livraison", "colis"];
const RESERVES = new Set([
  "boutique", "boutiques", "connexion", "inscription", "expeditions", "soldes", "nouveautes", "kisakoshi", "location",
  "requete", "requetes", "mes-commandes", "commandes", "a-propos", "apropos", "comment-ca-marche", "confidentialite",
  "admin", "api", "partage", "livraison", "panier", "recherche", "populaires", "assets", "static", "login", "app", "www",
  "tonabk", "tona2go", "mali", "mupya", "malimupya",
]);

// Cache court des codes valides (évite une requête par visite)
let cache = { le: 0, codes: new Set() };
async function codesValides(force = false) {
  if (!force && Date.now() - cache.le < 60 * 1000) return cache.codes;
  const { data } = await supabaseAdmin.from("agents_sensibilisation").select("code").limit(1000);
  cache = { le: Date.now(), codes: new Set((data || []).map((d) => d.code)) };
  return cache.codes;
}

// Limite simple par IP : 60 événements / 10 min
const compteurs = new Map();
function limite(ip) {
  const maintenant = Date.now();
  const e = compteurs.get(ip) || { debut: maintenant, n: 0 };
  if (maintenant - e.debut > 10 * 60 * 1000) { e.debut = maintenant; e.n = 0; }
  e.n++; compteurs.set(ip, e);
  if (compteurs.size > 5000) compteurs.clear();
  return e.n <= 60;
}

// POST /api/sensibilisation/evenement  { code, type, visiteur }
router.post("/evenement", async (req, res) => {
  const { code, type, visiteur } = req.body || {};
  const txt = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, n) : null) || null;
  const empreinte = /^[a-f0-9]{16,64}$/.test(String(req.body?.empreinte || "")) ? req.body.empreinte : null;
  if (!limite(req.ip)) return res.status(429).json({ error: "Trop de requêtes" });
  if (!CODE.test(String(code || "")) || !TYPES.includes(type) || !/^[A-Za-z0-9-]{8,64}$/.test(String(visiteur || ""))) {
    return res.status(400).json({ error: "Données invalides" });
  }
  try {
    if (!(await codesValides()).has(code) && !(await codesValides(true)).has(code)) return res.status(404).json({ error: "Adresse inconnue" });
    const { error } = await supabaseAdmin.from("visites_agents").insert({ code, type, visiteur, empreinte, marque: txt(req.body?.marque, 30), modele: txt(req.body?.modele, 60), ecran: txt(req.body?.ecran, 20) });
    if (error) return res.status(500).json({ error: "Erreur serveur" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/sensibilisation/agents/:personnelId/appareils?mois=2026-11  (admin principal et secondaires)
router.get("/agents/:personnelId/appareils", verifyAuth, async (req, res) => {
  if (!estAdmin(req) && !estAdminSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  if (!UUID.test(req.params.personnelId)) return res.status(400).json({ error: "Personnel invalide" });
  const mois = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mois || "")) ? req.query.mois : new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 7);
  const [a, m] = mois.split("-").map(Number);
  const suivant = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  const { data: ag } = await supabaseAdmin.from("agents_sensibilisation").select("code").eq("personnel_id", req.params.personnelId).maybeSingle();
  if (!ag) return res.json({ code: null, appareils: [] });
  const { data, error } = await supabaseAdmin.rpc("appareils_agent", { p_code: ag.code, debut: `${mois}-01T00:00:00+02:00`, fin: `${suivant}-01T00:00:00+02:00` });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ code: ag.code, appareils: data || [] });
});

// PUT /api/sensibilisation/agents/:personnelId  { code }
router.put("/agents/:personnelId", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const { personnelId } = req.params;
  const code = String(req.body?.code || "").trim().toLowerCase();
  if (!UUID.test(personnelId)) return res.status(400).json({ error: "Personnel invalide" });
  if (!CODE.test(code)) return res.status(400).json({ error: "Adresse : 3 à 20 lettres ou chiffres, sans espace ni accent" });
  if (RESERVES.has(code)) return res.status(400).json({ error: "Ce mot est réservé, choisissez-en un autre" });
  const { error } = await supabaseAdmin.from("agents_sensibilisation").upsert({ personnel_id: personnelId, code }, { onConflict: "personnel_id" });
  if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Cette adresse est déjà utilisée" : error.message });
  cache.le = 0;
  res.json({ ok: true, code });
});

// DELETE /api/sensibilisation/agents/:personnelId
router.delete("/agents/:personnelId", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  if (!UUID.test(req.params.personnelId)) return res.status(400).json({ error: "Personnel invalide" });
  const { error } = await supabaseAdmin.from("agents_sensibilisation").delete().eq("personnel_id", req.params.personnelId);
  if (error) return res.status(500).json({ error: error.message });
  cache.le = 0;
  res.json({ ok: true });
});

export default router;
