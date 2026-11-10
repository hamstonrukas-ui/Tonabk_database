import { supabaseAdmin } from "./verifyAuth.js";

// Une livraison compte comme une vente dès que le client l'a lancée (accord conclu), tant qu'elle n'est pas annulée
export const STATUTS_VENTE = ["en_attente", "acceptee", "en_route", "livree"];

// Le clic sur « Livre-moi » (brouillon) réserve déjà l'article. Si le client ne confirme pas dans ce délai,
// la réservation expire et l'article est remis en stock.
export const DUREE_RESERVATION_MIN = 120;

// Ajoute à chaque solde :
//   vendus_auto  = commandes « Livre-moi » (réservations en cours + livraisons lancées)
//   vendus_total = vendus_auto + ventes enregistrées à la main par l'admin (colonne vendus)
//   restant      = quantité - vendus_total (jamais sous 0) ; null si la quantité n'est pas suivie (quantite = 0)
export async function ajouterStock(soldes) {
  const liste = Array.isArray(soldes) ? soldes : [soldes];
  const ids = liste.map((s) => s.id);
  const parSolde = new Map();

  if (ids.length > 0) {
    const depuis = new Date(Date.now() - DUREE_RESERVATION_MIN * 60000).toISOString();
    const [ventes, reservations] = await Promise.all([
      supabaseAdmin.from("livraisons").select("solde_id").in("solde_id", ids).in("statut", STATUTS_VENTE),
      supabaseAdmin.from("livraisons").select("solde_id").in("solde_id", ids).eq("statut", "brouillon").gte("created_at", depuis),
    ]);
    if (ventes.error) throw ventes.error;
    if (reservations.error) throw reservations.error;
    for (const l of [...(ventes.data || []), ...(reservations.data || [])]) {
      parSolde.set(l.solde_id, (parSolde.get(l.solde_id) || 0) + 1);
    }
  }

  const resultat = liste.map((s) => {
    const auto = parSolde.get(s.id) || 0;
    const total = auto + (s.vendus || 0);
    const suivi = (s.quantite || 0) > 0;
    return {
      ...s,
      vendus_auto: auto,
      vendus_total: total,
      restant: suivi ? Math.max(0, s.quantite - total) : null,
    };
  });

  return Array.isArray(soldes) ? resultat : resultat[0];
}
