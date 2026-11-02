import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}
function estEquipe(req) {
  return estAdmin(req) || estAdminSecondaire(req);
}

const STATUTS = ["brouillon", "en_attente", "acceptee", "en_route", "livree", "annulee"];

// Le client clique "Livre-moi à la maison" : on crée un brouillon, la discussion se fait sur WhatsApp
router.post("/", async (req, res) => {
  const { produit_id, solde_id, boutique_id, nom_produit, prix, devise } = req.body;

  if (!nom_produit || prix == null) {
    return res.status(400).json({ error: "Produit et prix requis" });
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
