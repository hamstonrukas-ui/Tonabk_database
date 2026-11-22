// Tableau du personnel (lecture : toute l'équipe ; saisie des clients : admin principal) :
//  1. Gestion de l'application : compteurs automatiques (journal activite_personnel)
//  2. Gestion des clients : saisie manuelle par mois (table suivi_clients)
import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();
const estAdmin = (req) => req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listerPersonnel() {
  let tous = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    tous = tous.concat(data.users);
    if (data.users.length < 200) break;
  }
  return tous.filter((u) => u.app_metadata?.role === "admin_secondaire");
}

// Bornes du mois à l'heure de Bukavu/Lubumbashi (UTC+2)
function bornes(mois) {
  const [a, m] = mois.split("-").map(Number);
  const suivant = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return { debut: `${mois}-01T00:00:00+02:00`, fin: `${suivant}-01T00:00:00+02:00` };
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Lundi de la semaine d'une date AAAA-MM-JJ
function lundi(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const jour = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - jour);
  return d.toISOString().slice(0, 10);
}
const moisLocal = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 7);

// GET /api/tableau-personnel?mois=2026-11
// Lecture : admin principal et admins secondaires. Modification : admin principal uniquement.
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req) && !estAdminSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  const mois = MOIS.test(String(req.query.mois || "")) ? req.query.mois : moisLocal();
  try {
    const personnel = await listerPersonnel();
    const { debut, fin } = bornes(mois);

    const [{ data: activites, error: e1 }, { data: clients, error: e2 }, { data: adresses }, { data: stats }, { data: semaines }] = await Promise.all([
      supabaseAdmin.from("activite_personnel").select("personnel_id, type, nombre").gte("cree_le", debut).lt("cree_le", fin).limit(50000),
      supabaseAdmin.from("suivi_clients").select("*").eq("mois", mois),
      supabaseAdmin.from("agents_sensibilisation").select("personnel_id, code"),
      supabaseAdmin.rpc("stats_agents", { debut, fin }),
      supabaseAdmin.from("suivi_clients_semaines").select("*").gte("semaine", `${mois}-01`).lt("semaine", fin.slice(0, 10)).order("semaine"),
    ]);
    if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });

    const lignes = personnel.map((u) => ({
      id: u.id,
      nom: u.user_metadata?.nom || u.email || "Employé",
      sensibilisation: { code: null, visiteurs: 0, installations: 0, whatsapp: 0, livraisons: 0, colis: 0 },
      semaines: [],
      app: { solde: 0, mali_mupya: 0, kisakoshi: 0, article: 0 },
      clients: { clients_acquis: 0, conquete_secteur: 0, relance: 0, commandes_confirmees: 0, ventes_realisees: 0, chiffre_affaires: 0 },
    }));
    const parId = Object.fromEntries(lignes.map((l) => [l.id, l]));
    for (const a of activites || []) if (parId[a.personnel_id] && a.type in parId[a.personnel_id].app) parId[a.personnel_id].app[a.type] += a.nombre || 1;
    const parCode = {};
    for (const a of adresses || []) if (parId[a.personnel_id]) { parId[a.personnel_id].sensibilisation.code = a.code; parCode[a.code] = parId[a.personnel_id].sensibilisation; }
    const CLE = { visite: "visiteurs", installation: "installations", whatsapp: "whatsapp", livraison: "livraisons", colis: "colis" };
    for (const st of stats || []) if (parCode[st.code] && CLE[st.type]) parCode[st.code][CLE[st.type]] = Number(st.personnes);
    // Total du mois = ancienne saisie mensuelle (si elle existe) + somme des semaines.
    // Les niveaux (%) ne s'additionnent pas : on garde la dernière semaine saisie.
    for (const c of clients || []) {
      const l = parId[c.personnel_id];
      if (l) l.clients = {
        clients_acquis: c.clients_acquis, conquete_secteur: c.conquete_secteur, relance: c.relance,
        commandes_confirmees: c.commandes_confirmees, ventes_realisees: c.ventes_realisees, chiffre_affaires: Number(c.chiffre_affaires),
      };
    }
    for (const w of semaines || []) {
      const l = parId[w.personnel_id];
      if (!l) continue;
      l.clients.clients_acquis += w.clients_acquis;
      l.clients.commandes_confirmees += w.commandes_confirmees;
      l.clients.ventes_realisees += w.ventes_realisees;
      l.clients.chiffre_affaires += Number(w.chiffre_affaires);
      l.clients.conquete_secteur = w.conquete_secteur;
      l.clients.relance = w.relance;
      l.semaines.push({
        semaine: w.semaine, clients_acquis: w.clients_acquis, conquete_secteur: w.conquete_secteur, relance: w.relance,
        commandes_confirmees: w.commandes_confirmees, ventes_realisees: w.ventes_realisees, chiffre_affaires: Number(w.chiffre_affaires),
      });
    }
    res.json({ mois, personnel: lignes });
  } catch (e) {
    console.error("Tableau du personnel :", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/tableau-personnel/clients/:personnelId  { semaine: "AAAA-MM-JJ" (n'importe quel jour de la semaine), clients_acquis, ... }
// Une ligne par semaine ; ressaisir la même semaine la corrige. Les semaines s'additionnent dans le mois.
router.put("/clients/:personnelId", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const { personnelId } = req.params;
  const b = req.body || {};
  if (!UUID.test(personnelId)) return res.status(400).json({ error: "Personnel invalide" });
  if (!DATE.test(String(b.semaine || "")) || isNaN(new Date(`${b.semaine}T12:00:00Z`))) return res.status(400).json({ error: "Semaine invalide" });

  const entier = (v, max) => { const n = Math.round(Number(v) || 0); return Math.min(Math.max(n, 0), max); };
  const ligne = {
    personnel_id: personnelId,
    semaine: lundi(b.semaine),
    clients_acquis: entier(b.clients_acquis, 1e6),
    conquete_secteur: entier(b.conquete_secteur, 100),
    relance: entier(b.relance, 100),
    commandes_confirmees: entier(b.commandes_confirmees, 1e6),
    ventes_realisees: entier(b.ventes_realisees, 1e6),
    chiffre_affaires: Math.min(Math.max(Number(b.chiffre_affaires) || 0, 0), 1e9),
    modifie_le: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("suivi_clients_semaines").upsert(ligne, { onConflict: "personnel_id,semaine" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, semaine: ligne.semaine });
});

// DELETE /api/tableau-personnel/clients/:personnelId/:semaine
router.delete("/clients/:personnelId/:semaine", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  if (!UUID.test(req.params.personnelId) || !DATE.test(req.params.semaine)) return res.status(400).json({ error: "Paramètres invalides" });
  const { error } = await supabaseAdmin.from("suivi_clients_semaines").delete().eq("personnel_id", req.params.personnelId).eq("semaine", req.params.semaine);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
