// Tableau du personnel (lecture : toute l'équipe ; saisie des clients : admin principal) :
//  1. Gestion de l'application : compteurs automatiques (journal activite_personnel)
//  2. Gestion des clients : saisie manuelle par mois (table suivi_clients)
import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";
import { calculer, BASE_POINTS } from "../lib/remuneration.js";

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

    const [{ data: activites, error: e1 }, { data: clients, error: e2 }, { data: adresses }, { data: stats }, { data: semaines }, { data: declarations }, { data: renseign }] = await Promise.all([
      supabaseAdmin.from("activite_personnel").select("personnel_id, type, nombre").gte("cree_le", debut).lt("cree_le", fin).limit(50000),
      supabaseAdmin.from("suivi_clients").select("*").eq("mois", mois),
      supabaseAdmin.from("agents_sensibilisation").select("personnel_id, code"),
      supabaseAdmin.rpc("stats_agents", { debut, fin }),
      supabaseAdmin.from("suivi_clients_semaines").select("*").gte("semaine", `${mois}-01`).lt("semaine", fin.slice(0, 10)).order("semaine"),
      supabaseAdmin.from("sensibilisation_declarations").select("personnel_id, personnes").gte("jour", `${mois}-01`).lt("jour", fin.slice(0, 10)).limit(5000),
      supabaseAdmin.from("remuneration_renseignement").select("personnel_id, niveau").eq("mois", mois),
    ]);
    if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });

    const lignes = personnel.map((u) => ({
      id: u.id,
      nom: u.user_metadata?.nom || u.email || "Employé",
      sensibilisation: { code: null, declarees: 0, visiteurs: 0, installations: 0, whatsapp: 0, livraisons: 0, colis: 0 },
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
    for (const d of declarations || []) if (parId[d.personnel_id]) parId[d.personnel_id].sensibilisation.declarees += d.personnes;
    for (const r of renseign || []) if (parId[r.personnel_id]) parId[r.personnel_id].renseignement_niveau = r.niveau;
    for (const l of lignes) l.remuneration = calculer(l);
    res.json({ mois, moi: req.user.id, base: BASE_POINTS, personnel: lignes });
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

function ajouterJours(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// GET /api/tableau-personnel/resume-semaine?semaine=AAAA-MM-JJ (n'importe quel jour de la semaine ; défaut = cette semaine)
// Même calcul que le mois, avec les objectifs d'UNE semaine (lundi → dimanche, heure de Bukavu).
router.get("/resume-semaine", verifyAuth, async (req, res) => {
  if (!estAdmin(req) && !estAdminSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  try {
    const aujourdhui = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
    const lun = lundi(DATE.test(String(req.query.semaine || "")) ? req.query.semaine : aujourdhui);
    const suiv = ajouterJours(lun, 7);
    const debut = `${lun}T00:00:00+02:00`, fin = `${suiv}T00:00:00+02:00`;
    const personnel = await listerPersonnel();
    const [{ data: activites }, { data: adresses }, { data: stats }, { data: declarations }, { data: sem }] = await Promise.all([
      supabaseAdmin.from("activite_personnel").select("personnel_id, type, nombre").gte("cree_le", debut).lt("cree_le", fin).limit(50000),
      supabaseAdmin.from("agents_sensibilisation").select("personnel_id, code"),
      supabaseAdmin.rpc("stats_agents", { debut, fin }),
      supabaseAdmin.from("sensibilisation_declarations").select("personnel_id, personnes").gte("jour", lun).lt("jour", suiv).limit(5000),
      supabaseAdmin.from("suivi_clients_semaines").select("*").eq("semaine", lun),
    ]);
    const lignes = personnel.map((u) => ({
      id: u.id, nom: u.user_metadata?.nom || u.email || "Employé",
      app: { solde: 0, mali_mupya: 0, kisakoshi: 0, article: 0 },
      sensibilisation: { declarees: 0, visiteurs: 0, installations: 0, whatsapp: 0, livraisons: 0, colis: 0 },
      clients: { clients_acquis: 0, conquete_secteur: 0, relance: 0, commandes_confirmees: 0, ventes_realisees: 0, chiffre_affaires: 0 },
    }));
    const parId = Object.fromEntries(lignes.map((l) => [l.id, l]));
    for (const a of activites || []) if (parId[a.personnel_id] && a.type in parId[a.personnel_id].app) parId[a.personnel_id].app[a.type] += a.nombre || 1;
    const parCode = {};
    for (const a of adresses || []) if (parId[a.personnel_id]) parCode[a.code] = parId[a.personnel_id].sensibilisation;
    const CLE = { visite: "visiteurs", installation: "installations", whatsapp: "whatsapp", livraison: "livraisons", colis: "colis" };
    for (const st of stats || []) if (parCode[st.code] && CLE[st.type]) parCode[st.code][CLE[st.type]] = Number(st.personnes);
    for (const d of declarations || []) if (parId[d.personnel_id]) parId[d.personnel_id].sensibilisation.declarees += d.personnes;
    for (const c of sem || []) if (parId[c.personnel_id]) parId[c.personnel_id].clients = {
      clients_acquis: c.clients_acquis, conquete_secteur: c.conquete_secteur, relance: c.relance,
      commandes_confirmees: c.commandes_confirmees, ventes_realisees: c.ventes_realisees, chiffre_affaires: Number(c.chiffre_affaires),
    };
    for (const l of lignes) l.remuneration = calculer(l, 1);
    res.json({ semaine: lun, fin: ajouterJours(lun, 6), moi: req.user.id, personnel: lignes });
  } catch (e) {
    console.error("Résumé semaine :", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/tableau-personnel/declaration  { personnes, jour?, personnelId? }
// L'admin secondaire déclare ses propres personnes sensibilisées (une valeur par jour ; redéclarer le même jour corrige).
router.post("/declaration", verifyAuth, async (req, res) => {
  const b = req.body || {};
  const principal = estAdmin(req);
  if (!principal && !estAdminSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe d'administration" });
  const personnelId = principal && b.personnelId ? b.personnelId : req.user.id;
  if (!UUID.test(personnelId)) return res.status(400).json({ error: "Personnel invalide" });
  const aujourdhui = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
  const jour = DATE.test(String(b.jour || "")) ? b.jour : aujourdhui;
  if (jour > aujourdhui) return res.status(400).json({ error: "Date dans le futur" });
  const personnes = Math.round(Number(b.personnes));
  if (!Number.isFinite(personnes) || personnes < 0 || personnes > 5000) return res.status(400).json({ error: "Nombre invalide (0 à 5000)" });
  const { error } = await supabaseAdmin.from("sensibilisation_declarations").upsert({ personnel_id: personnelId, jour, personnes, modifie_le: new Date().toISOString() }, { onConflict: "personnel_id,jour" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, jour });
});

// PUT /api/tableau-personnel/renseignement/:personnelId  { mois, niveau 0-100 }  (admin principal)
router.put("/renseignement/:personnelId", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const niveau = Math.round(Number(req.body?.niveau));
  if (!UUID.test(req.params.personnelId) || !MOIS.test(String(req.body?.mois || "")) || !Number.isFinite(niveau) || niveau < 0 || niveau > 100) return res.status(400).json({ error: "Données invalides" });
  const { error } = await supabaseAdmin.from("remuneration_renseignement").upsert({ personnel_id: req.params.personnelId, mois: req.body.mois, niveau, modifie_le: new Date().toISOString() }, { onConflict: "personnel_id,mois" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
