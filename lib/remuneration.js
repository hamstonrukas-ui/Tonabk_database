// Compteur de rémunération des agents — TOUS les réglages sont ici.
// Principe : chaque mission vaut un % de la base. Dans une mission, chaque critère vaut un % et est rempli
// en proportion de sa cible mensuelle. Cible atteinte = 100 % du critère ; en dessous = manque ; au-dessus = surplus
// (le surplus est affiché mais n'augmente pas les points).

export const BASE_POINTS = 5000;                 // = 100 % (les 4 missions). Changez ce nombre (3000, 5000…).
export const POIDS = { app: 10, sensi: 25, clients: 45, renseignement: 20 };
export const SEM = 4;                             // cible mensuelle = cible hebdomadaire × 4
// "sem" = cible d'une semaine ; "niveau" = ne se multiplie pas (niveau en %)

export const CRITERES = {
  // Gestion de l'application (3 sorties/semaine : lundi, mercredi, samedi)
  app: [
    { libelle: "Soldes publiés", sem: 3, poids: 30, lire: (l) => l.app.solde },
    { libelle: "Mali mupya publiés", sem: 6, poids: 10, lire: (l) => l.app.mali_mupya },
    { libelle: "Kisakoshi publiés", sem: 3, poids: 10, lire: (l) => l.app.kisakoshi },
    { libelle: "Articles ajoutés", sem: 100, poids: 50, lire: (l) => l.app.article },
  ],
  // Sensibilisation terrain (2 sorties/semaine) — cible = bas de la fourchette ; "haut" = haut de la fourchette
  sensi: [
    { libelle: "Personnes sensibilisées", sem: 50, haut: 60, poids: 10, lire: (l) => l.sensibilisation.declarees },
    { libelle: "Visites (téléphones différents)", sem: 30, haut: 40, poids: 40, lire: (l) => l.sensibilisation.visiteurs },
    { libelle: "Contacts WhatsApp", sem: 5, haut: 10, poids: 20, lire: (l) => l.sensibilisation.whatsapp },
    { libelle: "Livre-moi", sem: 3, haut: 5, poids: 20, lire: (l) => l.sensibilisation.livraisons },
    { libelle: "Applications installées", sem: 3, haut: 5, poids: 10, lire: (l) => l.sensibilisation.installations },
  ],
  // Gestion des clients (saisie chaque semaine)
  clients: [
    { libelle: "Clients acquis", sem: 10, poids: 10, lire: (l) => l.clients.clients_acquis },
    { libelle: "Niveau de relance (%)", sem: 100, niveau: true, poids: 5, lire: (l) => l.clients.relance },
    { libelle: "Commandes confirmées", sem: 3, poids: 25, lire: (l) => l.clients.commandes_confirmees },
    { libelle: "Ventes réalisées", sem: 1, poids: 40, lire: (l) => l.clients.ventes_realisees },
    { libelle: "Chiffre d'affaires ($)", sem: 25, poids: 20, lire: (l) => l.clients.chiffre_affaires },
  ],
};

const arrondi1 = (n) => Math.round(n * 10) / 10;

// k = SEM (4) pour le mois, 1 pour une semaine
export function calculer(ligne, k = SEM) {
  const missions = {};
  let total = 0, max = 0;
  for (const [m, criteres] of Object.entries(CRITERES)) {
    const maxM = (BASE_POINTS * POIDS[m]) / 100 / (k === 1 ? SEM : 1);
    let pct = 0, surplus = 0;
    const details = criteres.map((c) => {
      const mult = c.niveau ? 1 : k;
      const cible = c.sem * mult, haut = c.haut ? c.haut * mult : null;
      const fait = Number(c.lire(ligne)) || 0;
      const r = cible ? fait / cible : 0;
      pct += c.poids * Math.min(r, 1);
      surplus += c.poids * Math.max(r - 1, 0);
      return {
        libelle: c.libelle, fait: arrondi1(fait), cible, haut, poids: c.poids,
        atteint: Math.round(Math.min(r, 1) * 100), ecart: arrondi1(fait - cible),
      };
    });
    const points = Math.round((maxM * pct) / 100);
    missions[m] = { pct: arrondi1(pct), points, max: Math.round(maxM), surplus: arrondi1(surplus), details };
    total += (maxM * pct) / 100; max += maxM;
  }
  total = Math.round(total); max = Math.round(max);
  // Service renseignement & livraison : occasionnel, à côté du total
  const niveau = Math.min(Math.max(Number(ligne.renseignement_niveau) || 0, 0), 100);
  const maxR = Math.round((BASE_POINTS * POIDS.renseignement) / 100);
  return {
    base: BASE_POINTS, total, max, pct: max ? arrondi1((total / max) * 100) : 0, missions,
    renseignement: { niveau, points: Math.round((maxR * niveau) / 100), max: maxR },
  };
}
