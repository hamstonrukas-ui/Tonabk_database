import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function seedDuJour() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// Supabase ne renvoie jamais plus de 1000 lignes par requête. Au-delà, les produits les
// plus récents étaient simplement ignorés : le nombre de pages cessait de grandir.
// On lit donc par tranches de 1000 jusqu'à tout avoir.
async function toutLire(construireRequete) {
  const TAILLE = 1000;
  let debut = 0;
  let tout = [];
  while (true) {
    const { data, error } = await construireRequete().range(debut, debut + TAILLE - 1);
    if (error) throw error;
    tout = tout.concat(data || []);
    if (!data || data.length < TAILLE) break;
    debut += TAILLE;
  }
  return tout;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Une sous-catégorie + ses enfants directs (2 niveaux : Femme -> Robes)
async function idsAvecEnfants(id) {
  if (!UUID.test(String(id))) return [];
  const { data, error } = await supabaseAdmin
    .from("sous_categories")
    .select("id")
    .or(`id.eq.${id},parent_id.eq.${id}`);
  if (error) throw error;
  return (data || []).map((r) => r.id);
}

// Remplace GET /api/produits/accueil (monté avant l'ancienne route, qui n'est plus atteinte)
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const { ville, categorie_id, sous_categorie_id } = req.query;
    const maintenant = new Date().toISOString();

    let idsSousCat = null;
    if (sous_categorie_id) {
      idsSousCat = await idsAvecEnfants(sous_categorie_id);
      if (!idsSousCat.length) return res.json({ data: [], total: 0, page, totalPages: 1 });
    }

    const filtrer = (q) => {
      if (ville) q = q.eq("boutiques.ville", ville);
      if (categorie_id) q = q.eq("boutiques.categorie_id", categorie_id);
      if (idsSousCat) q = q.in("sous_categorie_id", idsSousCat);
      return q;
    };

    // 1) On ne récupère que les identifiants (léger), pour décider de l'ordre complet
    const sponsorises = await toutLire(() =>
      filtrer(
        supabaseAdmin
          .from("produits")
          .select("id, boutiques!inner(ville, categorie_id)")
          .eq("sponsorise", true)
          .gt("sponsorise_jusqua", maintenant)
          .order("id")
      )
    );

    const normaux = await toutLire(() =>
      filtrer(
        supabaseAdmin
          .from("produits")
          .select("id, boutiques!inner(ville, categorie_id)")
          .or(`sponsorise.eq.false,sponsorise.is.null,sponsorise_jusqua.lt.${maintenant}`)
          .order("id")
      )
    );

    const seed = seedDuJour();
    const normauxMelanges = [...normaux].sort((a, b) => hash(a.id + seed) - hash(b.id + seed));
    const ordre = [...sponsorises, ...normauxMelanges].map((p) => p.id);

    const total = ordre.length;
    const offset = (page - 1) * limit;
    const idsPage = ordre.slice(offset, offset + limit);

    // 2) On ne charge les détails que pour la page demandée
    let data = [];
    if (idsPage.length > 0) {
      const { data: lignes, error } = await supabaseAdmin
        .from("produits")
        .select("*, boutiques(nom, certifiee, telephone, ville)")
        .in("id", idsPage);
      if (error) throw error;
      const parId = new Map((lignes || []).map((p) => [p.id, p]));
      data = idsPage.map((id) => parId.get(id)).filter(Boolean);
    }

    res.json({ data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error("Erreur accueil produits :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
