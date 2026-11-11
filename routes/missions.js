import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUTS = ["a_faire", "en_cours", "terminee"];

// Même vérification que les autres routes admin du projet.
function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}
function estSecondaire(req) {
  return req.user.app_metadata?.role === "admin_secondaire";
}

// Lundi (AAAA-MM-JJ) de la semaine d'une date donnée ; sans date valide : semaine en cours (heure de Bukavu, UTC+2)
function lundiDe(dateStr) {
  const d = DATE.test(dateStr || "") ? new Date(dateStr + "T12:00:00Z") : new Date(Date.now() + 2 * 3600 * 1000);
  const jour = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - jour);
  return d.toISOString().slice(0, 10);
}

async function listerUtilisateurs() {
  let tous = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    tous = tous.concat(data.users);
    if (data.users.length < 200) break;
    page++;
  }
  return tous;
}

// --- Employé : ses missions de la semaine ---
router.get("/mes", verifyAuth, async (req, res) => {
  if (!estAdmin(req) && !estSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  const semaine = lundiDe(req.query.semaine);

  const { data, error } = await supabaseAdmin
    .from("missions")
    .select("*")
    .eq("personnel_id", req.user.id)
    .eq("semaine_debut", semaine)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ semaine, missions: data });
});

// --- Employé : change le statut de sa mission (et ajoute une note) ---
router.put("/:id/statut", verifyAuth, async (req, res) => {
  if (!estAdmin(req) && !estSecondaire(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });

  const { statut, compte_rendu } = req.body || {};
  if (!STATUTS.includes(statut)) return res.status(400).json({ error: "Statut invalide" });

  const { data: mission } = await supabaseAdmin
    .from("missions")
    .select("id, personnel_id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!mission) return res.status(404).json({ error: "Mission introuvable" });
  if (mission.personnel_id !== req.user.id && !estAdmin(req)) {
    return res.status(403).json({ error: "Cette mission ne vous est pas attribuée" });
  }

  const maj = { statut, termine_le: statut === "terminee" ? new Date().toISOString() : null };
  if (typeof compte_rendu === "string") maj.compte_rendu = compte_rendu.trim().slice(0, 2000) || null;

  const { data, error } = await supabaseAdmin
    .from("missions")
    .update(maj)
    .eq("id", mission.id)
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Admin : missions d'une semaine, avec le nom de chaque employé ---
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  const semaine = lundiDe(req.query.semaine);

  const { data, error } = await supabaseAdmin
    .from("missions")
    .select("*")
    .eq("semaine_debut", semaine)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  try {
    const noms = Object.fromEntries(
      (await listerUtilisateurs()).map((u) => [u.id, u.user_metadata?.nom || u.email])
    );
    res.json({ semaine, missions: data.map((m) => ({ ...m, nom: noms[m.personnel_id] || "Employé" })) });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Admin : envoyer une mission à un ou plusieurs employés (ou à tous) ---
// { titre, description?, semaine_debut, personnel_ids: [...] | tous: true }
router.post("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { titre, description, semaine_debut, personnel_ids, tous } = req.body || {};
  if (!titre?.trim()) return res.status(400).json({ error: "Titre de la mission requis" });

  try {
    const employes = (await listerUtilisateurs()).filter((u) => u.app_metadata?.role === "admin_secondaire");
    let cibles;
    if (tous) {
      cibles = employes.map((u) => u.id);
    } else {
      if (!Array.isArray(personnel_ids) || personnel_ids.length === 0 || !personnel_ids.every((i) => UUID.test(String(i)))) {
        return res.status(400).json({ error: "Choisissez au moins un employé" });
      }
      const valides = new Set(employes.map((u) => u.id));
      cibles = personnel_ids.filter((i) => valides.has(i));
    }
    if (cibles.length === 0) return res.status(400).json({ error: "Aucun employé destinataire" });

    const semaine = lundiDe(semaine_debut);
    const lignes = cibles.map((id) => ({
      personnel_id: id,
      semaine_debut: semaine,
      titre: titre.trim().slice(0, 200),
      description: description?.trim().slice(0, 2000) || null,
      statut: "a_faire",
    }));

    const { error } = await supabaseAdmin.from("missions").insert(lignes);
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ ok: true, envoyees: lignes.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Admin : supprimer une mission ---
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });
  const { error } = await supabaseAdmin.from("missions").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
