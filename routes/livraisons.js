import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";
import { ajouterStock, DUREE_RESERVATION_MIN } from "../middleware/stockSolde.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}
function estEquipe(req) {
  return estAdmin(req) || estAdminSecondaire(req);
}

const STATUTS = ["brouillon", "en_attente", "acceptee", "en_route", "livree", "annulee"];

// Anti-abus : un même appareil ne peut pas « vider » un solde en cliquant sur « Livre-moi » en boucle
// (3 demandes maximum par offre pendant la durée de réservation).
const demandesParAppareil = new Map(); // "ip|solde" -> [horodatages]
function limiteAtteinte(req, soldeId) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip;
  const cle = `${ip}|${soldeId}`;
  const maintenant = Date.now();
  if (demandesParAppareil.size > 5000) demandesParAppareil.clear();
  const recentes = (demandesParAppareil.get(cle) || []).filter((t) => maintenant - t < DUREE_RESERVATION_MIN * 60000);
  if (recentes.length >= 3) {
    demandesParAppareil.set(cle, recentes);
    return true;
  }
  recentes.push(maintenant);
  demandesParAppareil.set(cle, recentes);
  return false;
}

// Le client clique "Livre-moi à la maison" : on crée un brouillon, la discussion se fait sur WhatsApp
router.post("/", async (req, res) => {
  const { produit_id, solde_id, boutique_id, nom_produit, prix, devise } = req.body;

  if (!nom_produit || prix == null) {
    return res.status(400).json({ error: "Produit et prix requis" });
  }

  // Offre en solde : le clic réserve un article. Impossible si le stock est écoulé.
  if (solde_id) {
    const { data: solde } = await supabaseAdmin.from("soldes").select("*").eq("id", solde_id).maybeSingle();
    if (solde && (await ajouterStock(solde)).restant === 0) {
      return res.status(409).json({ error: "Stock écoulé : cette offre n'est plus disponible." });
    }
    if (limiteAtteinte(req, solde_id)) {
      return res.status(429).json({ error: "Vous avez déjà plusieurs demandes en cours pour cette offre." });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .insert({
      produit_id: produit_id || null,
      solde_id: solde_id || null,
      boutique_id: boutique_id || null,
      nom_produit,
      prix: Number(prix),
      devise: devise || "USD",
      client_nom: "",
      client_telephone: "",
      client_adresse: "",
      statut: "brouillon",
    })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

// Le client appuie sur "Démarrer" une fois l'accord conclu : il donne son adresse, la livraison est lancée
router.put("/:id/demarrer", async (req, res) => {
  const { client_nom, client_telephone, client_adresse } = req.body;
  if (!client_nom?.trim() || !client_telephone?.trim() || !client_adresse?.trim()) {
    return res.status(400).json({ error: "Nom, téléphone et adresse requis" });
  }

  // La réservation faite au clic sur « Livre-moi » garde l'article le temps de conclure.
  // Si elle a expiré, on vérifie qu'il reste du stock avant de lancer la livraison.
  const { data: brouillon } = await supabaseAdmin
    .from("livraisons")
    .select("solde_id, created_at")
    .eq("id", req.params.id)
    .eq("statut", "brouillon")
    .maybeSingle();
  if (brouillon?.solde_id) {
    const reservationValide = Date.now() - new Date(brouillon.created_at).getTime() < DUREE_RESERVATION_MIN * 60000;
    if (!reservationValide) {
      const { data: solde } = await supabaseAdmin.from("soldes").select("*").eq("id", brouillon.solde_id).maybeSingle();
      if (solde && (await ajouterStock(solde)).restant === 0) {
        return res.status(409).json({ error: "Stock écoulé : cette offre n'est plus disponible." });
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .update({
      client_nom: client_nom.trim(),
      client_telephone: client_telephone.trim(),
      client_adresse: client_adresse.trim(),
      statut: "en_attente",
    })
    .eq("id", req.params.id)
    .eq("statut", "brouillon")
    .select("id, statut")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(400).json({ error: "Cette commande est déjà lancée ou introuvable" });
  res.json(data);
});

// Livreur : ses livraisons assignées (équipe uniquement)
router.get("/livreur/mes-livraisons", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });

  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .select("*")
    .eq("livreur_id", req.user.id)
    .in("statut", ["acceptee", "en_route"])
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin : toutes les livraisons récentes (pour assigner)
router.get("/", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .select("*")
    .neq("statut", "brouillon")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Début d'un identifiant (uuid) -> plage complète, pour retrouver une commande à partir de sa référence
function plageUuid(ref) {
  const mettreEnForme = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return [mettreEnForme(ref.padEnd(32, "0")), mettreEnForme(ref.padEnd(32, "f"))];
}

// Admin : retrouver une commande « Livre-moi » avec la référence du message WhatsApp
// (les 8 premiers caractères de l'identifiant). Marche aussi pour les brouillons.
router.get("/ref/:ref", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const saisie = String(req.params.ref || "").trim().split(/\s+/).pop();
  const ref = saisie.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 32);
  if (ref.length < 6) return res.status(400).json({ error: "Tapez au moins 6 caractères de la référence" });

  const [debut, fin] = plageUuid(ref);
  const { data: lignes, error } = await supabaseAdmin
    .from("livraisons")
    .select("id, created_at, statut, nom_produit, prix, devise, produit_id, solde_id, boutique_id, client_nom, client_telephone, client_adresse")
    .gte("id", debut)
    .lte("id", fin)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return res.status(500).json({ error: error.message });

  const siteUrl = process.env.FRONTEND_URL || "https://tonabk.com";
  const resultats = [];
  for (const l of lignes || []) {
    let photo = null;
    let lien = null;
    let boutique = null;
    if (l.produit_id) {
      const { data: p } = await supabaseAdmin.from("produits").select("photo_url, boutiques(nom)").eq("id", l.produit_id).maybeSingle();
      photo = p?.photo_url || null;
      boutique = p?.boutiques?.nom || null;
      lien = `${siteUrl}/boutique/produit/${l.produit_id}`;
    } else if (l.solde_id) {
      const { data: s } = await supabaseAdmin.from("soldes").select("photos, photo_url").eq("id", l.solde_id).maybeSingle();
      photo = s?.photos?.[0] || s?.photo_url || null;
      lien = `${siteUrl}/soldes/${l.solde_id}`;
    }
    if (!boutique && l.boutique_id) {
      const { data: b } = await supabaseAdmin.from("boutiques").select("nom").eq("id", l.boutique_id).maybeSingle();
      boutique = b?.nom || null;
    }
    resultats.push({
      reference: l.id.slice(0, 8),
      date: l.created_at,
      statut: l.statut,
      nom_produit: l.nom_produit,
      prix: l.prix,
      devise: l.devise,
      boutique,
      photo,
      lien,
      client_nom: l.client_nom || "",
      client_telephone: l.client_telephone || "",
      client_adresse: l.client_adresse || "",
    });
  }
  res.json(resultats);
});

// Suivi public d'une livraison (le lien contient l'identifiant, impossible à deviner)
router.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .select("id, nom_produit, prix, devise, client_adresse, statut, lat_livreur, lng_livreur, derniere_position_le, livreur_id, created_at")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Livraison introuvable" });

  let livreur_nom = null;
  if (data.livreur_id) {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.livreur_id);
    livreur_nom = u?.user?.user_metadata?.nom || null;
  }
  const { livreur_id, ...publique } = data;
  res.json({ ...publique, livreur_nom });
});

// Admin : assigner un livreur
router.put("/:id/assigner", verifyAuth, async (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });

  const { livreur_id } = req.body;
  const { data, error } = await supabaseAdmin
    .from("livraisons")
    .update({ livreur_id, statut: "acceptee" })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Livreur (ou admin) : changer le statut
router.put("/:id/statut", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  const { statut } = req.body;
  if (!STATUTS.includes(statut)) return res.status(400).json({ error: "Statut invalide" });

  const { data: livraison } = await supabaseAdmin.from("livraisons").select("livreur_id").eq("id", req.params.id).single();
  if (!livraison) return res.status(404).json({ error: "Livraison introuvable" });
  if (!estAdmin(req) && livraison.livreur_id !== req.user.id) {
    return res.status(403).json({ error: "Cette livraison ne vous est pas assignée" });
  }

  const { data, error } = await supabaseAdmin
    .from("livraisons").update({ statut }).eq("id", req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Livreur : envoyer sa position en direct
router.put("/:id/position", verifyAuth, async (req, res) => {
  if (!estEquipe(req)) return res.status(403).json({ error: "Réservé à l'équipe" });
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: "Position requise" });

  const { data: livraison } = await supabaseAdmin.from("livraisons").select("livreur_id").eq("id", req.params.id).single();
  if (!livraison || livraison.livreur_id !== req.user.id) {
    return res.status(403).json({ error: "Cette livraison ne vous est pas assignée" });
  }

  const { error } = await supabaseAdmin
    .from("livraisons")
    .update({ lat_livreur: lat, lng_livreur: lng, derniere_position_le: new Date().toISOString() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
