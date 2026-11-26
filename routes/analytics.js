import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// Routes PUBLIQUES (pas de verifyAuth) — appelées par n'importe quel visiteur,
// connecté ou non, donc pas d'authentification requise ici.

// ── Anti-robots : les robots (Google, Facebook, outils de test, scanners…) ouvrent le site sans
// localStorage, donc chaque passage ressemblait à un nouveau visiteur. On les ignore ici
// (réponse "ok" pour ne pas les inciter à réessayer) et on limite aussi le rythme par adresse IP.
const ROBOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|facebookexternalhit|whatsapp|telegram|preview|fetch|curl|wget|python|java\/|go-http|axios|node-fetch|okhttp|postman|scrapy|phantom|puppeteer|playwright|selenium|vercel|render|checker|scanner|validator/i;
const parIp = new Map(); // ip -> horodatages
function ignorer(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (ua.length < 20 || ROBOT.test(ua)) return true;
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip;
  const maintenant = Date.now();
  if (parIp.size > 5000) parIp.clear();
  const recents = (parIp.get(ip) || []).filter((t) => maintenant - t < 10 * 60000);
  recents.push(maintenant);
  parIp.set(ip, recents);
  return recents.length > 40; // plus de 40 requêtes en 10 min depuis la même adresse : abusif
}
router.use((req, res, next) => (ignorer(req) ? res.json({ ok: true, ignore: true }) : next()));

const APPAREILS = ["mobile", "tablette", "ordinateur"];
// Texte court nettoyé (ou null) : on ne fait jamais confiance à ce que le navigateur envoie
const court = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

router.post("/clic-whatsapp", async (req, res) => {
  const { cible_type, cible_id, session_id, visite_id } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "clic_whatsapp",
    cible_type: cible_type || null,
    cible_id: cible_id || null,
    session_id: session_id || null,
    visite_id: court(visite_id, 64),
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post("/visite", async (req, res) => {
  const { cible_type, cible_id, session_id, visite_id, appareil, source } = req.body;

  const { error } = await supabaseAdmin.from("evenements_analytics").insert({
    type: "visite",
    cible_type: cible_type || "site",
    cible_id: cible_id || null,
    session_id: session_id || null,
    visite_id: court(visite_id, 64),
    appareil: APPAREILS.includes(appareil) ? appareil : null,
    source: court(source, 30),
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Page consultée (page_vue) ou temps passé à l'écran (duree)
router.post("/evenement", async (req, res) => {
  const { type, chemin, duree_secondes, appareil, source, session_id, visite_id } = req.body || {};
  if (type !== "page_vue" && type !== "duree") return res.status(400).json({ error: "Type invalide" });

  const ligne = {
    type,
    cible_type: "site",
    session_id: court(session_id, 64),
    visite_id: court(visite_id, 64),
    appareil: APPAREILS.includes(appareil) ? appareil : null,
    source: court(source, 30),
  };

  if (type === "page_vue") {
    const c = court(chemin, 200);
    if (!c || !c.startsWith("/")) return res.status(400).json({ error: "Page invalide" });
    ligne.chemin = c.split("?")[0];
  } else {
    const d = Math.round(Number(duree_secondes));
    if (!(d >= 1 && d <= 1800)) return res.status(400).json({ error: "Durée invalide" });
    ligne.duree_secondes = d;
  }

  const { error } = await supabaseAdmin.from("evenements_analytics").insert(ligne);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
