import { supabaseAdmin } from "./verifyAuth.js";

// Utilisés par routes/livraisons.js (anti-spam par appareil et réservation de commande).
// Ils n'influencent PLUS le stock affiché des soldes.
export const STATUTS_VENTE = ["en_attente", "acceptee", "en_route", "livree"];
export const DUREE_RESERVATION_MIN = 120;

// Le stock d'un solde est entièrement géré à la main par l'admin :
//   vendus_total = colonne « vendus » (réglée par l'admin : boutons −1 / +1 ou « Définir le reste »)
//   restant      = quantite - vendus (jamais sous 0) ; null si la quantité n'est pas suivie (quantite = 0)
// Un clic sur « Livre-moi » ou « Je veux cette offre » ne change donc plus le stock tout seul :
// le chiffre vu par les clients ne bouge que quand l'admin le modifie.
export async function ajouterStock(soldes) {
  const liste = Array.isArray(soldes) ? soldes : [soldes];

  const resultat = liste.map((s) => {
    const total = s.vendus || 0;
    const suivi = (s.quantite || 0) > 0;
    return {
      ...s,
      vendus_auto: 0,
      vendus_total: total,
      restant: suivi ? Math.max(0, s.quantite - total) : null,
    };
  });

  return Array.isArray(soldes) ? resultat : resultat[0];
}
