import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

// Date du jour à Bukavu / Lubumbashi (UTC+2, sans heure d'été) : la journée finit à 23h59 heure locale
function aujourdhui() {
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
}

// Lit une position envoyée par l'application (GPS du téléphone, ou collée depuis un message WhatsApp)
function lireCoord(body) {
  const lat = Number(body?.lat), lng = Number(body?.lng);
  if (body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
const lireSource = (v) => (v === "whatsapp" ? "whatsapp" : "gps");
const lireAdresse = (v) => (typeof v === "string" ? v.trim().slice(0, 500) || null : null);

function estEquipe(req) {
  return estAdmin(req) || estAdminSecondaire(req);
}

// Présence du jour pour l'utilisateur connecté (pour savoir où il en est)
router.get("/aujourdhui", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .select("*")
    .eq("personnel_id", req.user.id)
    .eq("date", aujourdhui())
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

// Historique des jours de travail de l'utilisateur connecté (employé ou admin)
router.get("/mon-historique", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .select("*")
    .eq("personnel_id", req.user.id)
    .order("date", { ascending: false })
    .limit(366);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Signer la présence du jour (une seule fois par jour)
router.post("/signer", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const pos = lireCoord(req.body);
  if (!pos) return res.status(400).json({ error: "Position requise" });

  const { data: existante } = await supabaseAdmin
    .from("presences")
    .select("id")
    .eq("personnel_id", req.user.id)
    .eq("date", aujourdhui())
    .maybeSingle();

  if (existante) return res.status(409).json({ error: "Présence déjà signée aujourd'hui" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .insert({
      personnel_id: req.user.id,
      date: aujourdhui(),
      heure_debut: new Date().toISOString(),
      lat_debut: pos.lat,
      lng_debut: pos.lng,
      adresse_debut: lireAdresse(req.body.adresse),
      source_debut: lireSource(req.body.source),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Clôturer la journée : uniquement la position de fin (le rapport s'envoie à part, jusqu'à 23h59)
router.put("/cloturer", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  const pos = lireCoord(req.body);
  if (!pos) return res.status(400).json({ error: "Position requise" });

  const { data: presence } = await supabaseAdmin
    .from("presences")
    .select("id, heure_fin")
    .eq("personnel_id", req.user.id)
    .eq("date", aujourdhui())
    .maybeSingle();

  if (!presence) return res.status(400).json({ error: "Présence non signée aujourd'hui" });
  if (presence.heure_fin) return res.status(409).json({ error: "Journée déjà clôturée" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .update({
      heure_fin: new Date().toISOString(),
      lat_fin: pos.lat,
      lng_fin: pos.lng,
      adresse_fin: lireAdresse(req.body.adresse),
      source_fin: lireSource(req.body.source),
    })
    .eq("id", presence.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Rapport du jour : à envoyer au plus tard à 23h59 (il est classé dans la journée en cours)
router.put("/rapport", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  const activites = typeof req.body.activites === "string" ? req.body.activites.trim().slice(0, 4000) : "";
  const difficultes = typeof req.body.difficultes === "string" ? req.body.difficultes.trim().slice(0, 4000) : "";
  if (!activites) return res.status(400).json({ error: "Décrivez les activités réalisées" });

  const { data: presence } = await supabaseAdmin
    .from("presences")
    .select("id")
    .eq("personnel_id", req.user.id)
    .eq("date", aujourdhui())
    .maybeSingle();
  if (!presence) return res.status(400).json({ error: "Aucune journée commencée aujourd'hui : le délai de 23h59 est dépassé" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .update({ activites, difficultes: difficultes || null, rapport_le: new Date().toISOString() })
    .eq("id", presence.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Liste des présences (admin complet uniquement) — suivi de l'équipe
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .select("*")
    .order("date", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  // On rattache le nom de chaque membre du personnel (lu depuis auth, pas stocké en double)
  const { data: utilisateurs } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  const noms = Object.fromEntries(
    (utilisateurs?.users || []).map((u) => [u.id, u.user_metadata?.nom || u.email])
  );

  res.json(data.map((p) => ({ ...p, nom: noms[p.personnel_id] || "Inconnu" })));
});

export default router;
