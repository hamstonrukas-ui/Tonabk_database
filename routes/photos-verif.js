import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

const PARALLELE = 8;
const DELAI_MS = 8000;

const RAISONS = {
  404: "Fichier introuvable sur R2 (supprimé ou jamais envoyé)",
  403: "Accès refusé par R2",
  429: "Trop de requêtes : le domaine r2.dev limite le débit",
  0: "Pas de réponse du serveur de photos",
};

async function verifier(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    let res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: ctrl.signal });
    }
    const type = res.headers.get("content-type") || "";
    if (res.ok && type && !type.startsWith("image/")) {
      return { ok: false, statut: res.status, raison: `Le fichier n'est pas une image (${type})` };
    }
    return { ok: res.ok, statut: res.status, raison: res.ok ? "" : RAISONS[res.status] || `Erreur HTTP ${res.status}` };
  } catch {
    return { ok: false, statut: 0, raison: RAISONS[0] };
  } finally {
    clearTimeout(t);
  }
}

// GET /api/photos-verif?debut=0&nb=100 — vérifie les photos des produits par tranches.
// Seules les adresses du stockage R2 de TonaBk sont contactées ; toute autre adresse est signalée sans être appelée.
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin principal" });
  const debut = Math.max(0, parseInt(req.query.debut, 10) || 0);
  const nb = Math.min(200, Math.max(1, parseInt(req.query.nb, 10) || 100));
  const base = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

  const { data, error, count } = await supabaseAdmin
    .from("produits")
    .select("id, nom, photo_url, photo_thumb_url, boutique_id, boutiques(nom)", { count: "exact" })
    .order("id")
    .range(debut, debut + nb - 1);
  if (error) return res.status(500).json({ error: error.message });

  const cassees = [];
  const sans_photo = [];
  const file = [];
  for (const p of data) {
    if (!p.photo_url) { sans_photo.push(p.id); continue; }
    const urls = new Set([p.photo_url]);
    if (p.photo_thumb_url) urls.add(p.photo_thumb_url);
    for (const url of urls) file.push({ p, url });
  }

  let suivant = 0;
  await Promise.all(Array.from({ length: PARALLELE }, async () => {
    while (suivant < file.length) {
      const { p, url } = file[suivant++];
      let r;
      if (!base || !url.startsWith(base + "/")) {
        r = { ok: false, statut: -1, raison: "Adresse hors du stockage R2 actuel (ancien domaine ou valeur invalide)" };
      } else {
        r = await verifier(url);
      }
      if (!r.ok) {
        cassees.push({
          produit_id: p.id, nom: p.nom, boutique_id: p.boutique_id, boutique: p.boutiques?.nom || "",
          url, statut: r.statut, raison: r.raison,
        });
      }
    }
  }));

  res.json({
    total: count ?? null,
    traites: data.length,
    suivant: data.length === nb ? debut + nb : null,
    base_r2: base || null,
    sans_photo: sans_photo.length,
    cassees,
  });
});

export default router;
