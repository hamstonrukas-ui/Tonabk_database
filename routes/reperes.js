import express from "express";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}
function equipe(req, res) {
  if (!estAdmin(req) && !estAdminSecondaire(req)) {
    res.status(403).json({ error: "Réservé à l'équipe d'administration" });
    return false;
  }
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texte = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const CHAMPS = "produit_id, code, fournisseur_nom, fournisseur_contact, note, produits(id, nom, prix, devise, photo_url, boutique_id, boutiques(id, nom, telephone, ville, commune))";

// Repères de tous les produits d'une boutique : { produit_id: {code, fournisseur_nom, ...} }
router.get("/boutique/:id", verifyAuth, async (req, res) => {
  if (!equipe(req, res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Boutique invalide" });

  const resultat = {};
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await supabaseAdmin
      .from("produits_reperes")
      .select("produit_id, code, fournisseur_nom, fournisseur_contact, note, produits!inner(boutique_id)")
      .eq("produits.boutique_id", req.params.id)
      .range(debut, debut + 999);
    if (error) return res.status(500).json({ error: error.message });
    for (const r of data) {
      resultat[r.produit_id] = { code: r.code, fournisseur_nom: r.fournisseur_nom, fournisseur_contact: r.fournisseur_contact, note: r.note };
    }
    if (data.length < 1000) break;
  }
  res.json(resultat);
});

// Enregistrer la source d'un produit : { fournisseur_nom, fournisseur_contact, note }
router.put("/produit/:id", verifyAuth, async (req, res) => {
  if (!equipe(req, res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Produit invalide" });

  const { data: produit } = await supabaseAdmin.from("produits").select("id").eq("id", req.params.id).maybeSingle();
  if (!produit) return res.status(404).json({ error: "Produit introuvable" });

  const { data, error } = await supabaseAdmin
    .from("produits_reperes")
    .upsert({
      produit_id: req.params.id,
      fournisseur_nom: texte(req.body.fournisseur_nom, 120) || null,
      fournisseur_contact: texte(req.body.fournisseur_contact, 120) || null,
      note: texte(req.body.note, 500) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "produit_id" })
    .select("produit_id, code, fournisseur_nom, fournisseur_contact, note")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Retrouver un produit : par numéro de repère (1042, R1042, #1042), par id complet,
// ou par texte (nom du produit, nom / contact du fournisseur, note).
router.get("/chercher", verifyAuth, async (req, res) => {
  if (!equipe(req, res)) return;
  const q = texte(req.query.q, 100);
  if (!q) return res.json([]);

  const numero = q.replace(/^[\s#rR.\-_]*/, "");
  let lignes = [];

  if (/^\d{1,12}$/.test(numero)) {
    const { data, error } = await supabaseAdmin.from("produits_reperes").select(CHAMPS).eq("code", Number(numero)).limit(5);
    if (error) return res.status(500).json({ error: error.message });
    lignes = data;
  } else if (UUID.test(q)) {
    const { data, error } = await supabaseAdmin.from("produits_reperes").select(CHAMPS).eq("produit_id", q).limit(5);
    if (error) return res.status(500).json({ error: error.message });
    lignes = data;
  } else {
    const motif = q.replace(/[%,()*\\]/g, " ").trim();
    if (motif.length < 2) return res.json([]);
    const [a, b] = await Promise.all([
      supabaseAdmin.from("produits_reperes").select(CHAMPS)
        .or(`fournisseur_nom.ilike.%${motif}%,fournisseur_contact.ilike.%${motif}%,note.ilike.%${motif}%`).limit(30),
      supabaseAdmin.from("produits").select("id").ilike("nom", `%${motif}%`).limit(30),
    ]);
    if (a.error) return res.status(500).json({ error: a.error.message });
    lignes = a.data || [];
    const ids = (b.data || []).map((p) => p.id).filter((id) => !lignes.some((l) => l.produit_id === id));
    if (ids.length) {
      const { data } = await supabaseAdmin.from("produits_reperes").select(CHAMPS).in("produit_id", ids);
      lignes = lignes.concat(data || []);
    }
  }

  res.json(lignes.filter((l) => l.produits).map((l) => ({
    code: l.code,
    produit_id: l.produit_id,
    fournisseur_nom: l.fournisseur_nom,
    fournisseur_contact: l.fournisseur_contact,
    note: l.note,
    produit: { nom: l.produits.nom, prix: l.produits.prix, devise: l.produits.devise, photo_url: l.produits.photo_url },
    boutique: l.produits.boutiques || null,
  })));
});

export default router;
