import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

async function listerPersonnel() {
  let tous = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    tous = tous.concat(data.users);
    if (data.users.length < 200) break;
    page++;
  }
  return tous.filter((u) => u.app_metadata?.role === "admin_secondaire");
}

// Résumé par employé : jours travaillés (ce mois / au total), dernier jour (admin uniquement)
router.get("/resume", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  try {
    const personnel = await listerPersonnel();
    const { data: presences, error } = await supabaseAdmin
      .from("presences")
      .select("personnel_id, date, heure_fin");
    if (error) return res.status(500).json({ error: error.message });

    const moisCourant = new Date().toISOString().slice(0, 7); // AAAA-MM
    const resume = {};
    for (const u of personnel) {
      resume[u.id] = { jours_total: 0, jours_mois: 0, non_cloturees: 0, dernier_jour: null };
    }
    for (const p of presences || []) {
      const r = resume[p.personnel_id];
      if (!r) continue;
      r.jours_total++;
      if (p.date.startsWith(moisCourant)) r.jours_mois++;
      if (!p.heure_fin) r.non_cloturees++;
      if (!r.dernier_jour || p.date > r.dernier_jour) r.dernier_jour = p.date;
    }
    res.json(resume);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Tous les jours de travail d'un employé, rapport inclus (admin uniquement)
router.get("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("presences")
    .select("*")
    .eq("personnel_id", req.params.id)
    .order("date", { ascending: false })
    .limit(366);
  if (error) return res.status(500).json({ error: error.message });

  const { data: u } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
  res.json({
    nom: u?.user?.user_metadata?.nom || "Employé",
    telephone: u?.user?.user_metadata?.telephone || "",
    jours: data,
  });
});

export default router;
