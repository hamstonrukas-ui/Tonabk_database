import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

function aujourdhui() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

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

// Signer la présence du jour (une seule fois par jour)
router.post("/signer", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const { lat, lng, adresse } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: "Position GPS requise" });

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
      lat_debut: lat,
      lng_debut: lng,
      adresse_debut: adresse || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Clôturer la journée : nouvelle position GPS + rapport
router.put("/cloturer", verifyAuth, async (req, res) => {
  const { lat, lng, adresse, activites, difficultes } = req.body;
  if (!activites?.trim()) return res.status(400).json({ error: "Activités réalisées requises" });

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
      lat_fin: lat ?? null,
      lng_fin: lng ?? null,
      adresse_fin: adresse || null,
      activites: activites.trim(),
      difficultes: difficultes?.trim() || null,
    })
    .eq("id", presence.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Historique des présences de l'utilisateur connecté (pas celles des autres)
router.get("/mon-historique", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .select("*")
    .eq("personnel_id", req.user.id)
    .order("date", { ascending: false })
    .limit(60);

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
