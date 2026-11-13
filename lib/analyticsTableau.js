// Calcul du tableau de bord des statistiques à partir des événements bruts.
// Fonction pure (sans base de données) : facile à tester. Heure locale de Bukavu = UTC+2, sans changement d'heure.

export const DECALAGE_MIN = 120;
const MIN = 60 * 1000;
const H = 60 * MIN;
const J = 24 * H;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERIODES = {
  "24h": { unite: H, n: 24 },
  "7j": { unite: J, n: 7 },
  "30j": { unite: J, n: 30 },
};

const decalage = DECALAGE_MIN * MIN;
const indexLocal = (t, unite) => Math.floor((t + decalage) / unite);

// Début (en UTC, ms) de la fenêtre d'une période : début du premier créneau affiché
export function debutFenetre(periode, maintenant = Date.now()) {
  const { unite, n } = PERIODES[periode];
  return (indexLocal(maintenant, unite) - (n - 1)) * unite - decalage;
}
// Début de la fenêtre précédente (même durée), pour les tendances
export function debutFenetrePrecedente(periode, maintenant = Date.now()) {
  const { unite, n } = PERIODES[periode];
  return debutFenetre(periode, maintenant) - n * unite;
}

function section(chemin) {
  if (chemin === "/" || chemin === "") return "Accueil";
  if (chemin.startsWith("/boutique")) return "Boutique";
  if (chemin.startsWith("/location")) return "Location";
  if (chemin.startsWith("/requete")) return "Requêtes";
  if (chemin.startsWith("/soldes")) return "Soldes";
  if (chemin.startsWith("/nouveautes")) return "Nouveautés";
  if (chemin.startsWith("/mes-commandes")) return "Commandes";
  return "Autres";
}

function normaliser(chemin) {
  return (
    "/" +
    chemin.split("?")[0].split("/").filter(Boolean)
      .map((s) => (UUID.test(s) || /^\d{4,}$/.test(s) ? ":id" : s))
      .join("/")
  );
}

const compter = (liste, cle) => {
  const m = new Map();
  for (const x of liste) { const k = cle(x); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const moyenne = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const mediane = (a) => {
  if (!a.length) return 0;
  const t = [...a].sort((x, y) => x - y);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

// Indicateurs d'un ensemble d'événements
function indicateurs(ev, maintenant) {
  const actifs = ev.filter((e) => e.type === "visite" || e.type === "page_vue" || e.type === "duree");
  const visiteurs = new Set(actifs.map((e) => e.session_id).filter(Boolean));

  // Visites : une par visite_id ; les anciens événements « visite » sans visite_id comptent chacun pour une
  const visites = new Set(actifs.map((e) => e.visite_id).filter(Boolean));
  const visitesAnciennes = ev.filter((e) => e.type === "visite" && !e.visite_id).length;
  const nbVisites = visites.size + visitesAnciennes;

  const pages = ev.filter((e) => e.type === "page_vue");
  const pagesParVisite = new Map();
  for (const p of pages) if (p.visite_id) pagesParVisite.set(p.visite_id, (pagesParVisite.get(p.visite_id) || 0) + 1);
  const rebonds = [...pagesParVisite.values()].filter((n) => n === 1).length;

  const dureeParVisite = new Map();
  for (const e of ev) if (e.type === "duree" && e.visite_id) dureeParVisite.set(e.visite_id, (dureeParVisite.get(e.visite_id) || 0) + (e.duree_secondes || 0));
  const durees = [...dureeParVisite.values()].filter((d) => d > 0);

  const clics = ev.filter((e) => e.type === "clic_whatsapp");
  const clicsVisiteurs = new Set(clics.map((e) => e.session_id).filter(Boolean));

  const ilYa5min = maintenant - 5 * MIN;
  const enLigne = new Set(actifs.filter((e) => new Date(e.created_at).getTime() >= ilYa5min).map((e) => e.session_id).filter(Boolean));

  return {
    visiteurs: visiteurs.size,
    visites: nbVisites,
    pages_vues: pages.length,
    pages_par_visite: pagesParVisite.size ? pages.filter((p) => p.visite_id).length / pagesParVisite.size : 0,
    duree_moyenne: Math.round(moyenne(durees)),
    duree_mediane: Math.round(mediane(durees)),
    taux_rebond: pagesParVisite.size ? Math.round((rebonds / pagesParVisite.size) * 100) : null,
    clics_whatsapp: clics.length,
    taux_conversion: visiteurs.size ? Math.round((clicsVisiteurs.size / visiteurs.size) * 1000) / 10 : null,
    en_ligne: enLigne.size,
    _durees: durees,
  };
}

export function calculerTableau(evenements, periode, maintenant = Date.now()) {
  const { unite, n } = PERIODES[periode];
  const debut = debutFenetre(periode, maintenant);
  const debutPrec = debutFenetrePrecedente(periode, maintenant);

  const ts = (e) => new Date(e.created_at).getTime();
  const courants = evenements.filter((e) => ts(e) >= debut && ts(e) <= maintenant);
  const precedents = evenements.filter((e) => ts(e) >= debutPrec && ts(e) < debut);

  const cur = indicateurs(courants, maintenant);
  const prec = indicateurs(precedents, maintenant);
  const { _durees, ...kpi } = cur;
  delete prec._durees;

  // --- Courbe : un point par heure (24 h) ou par jour (7 j / 30 j) ---
  const premier = indexLocal(debut, unite);
  const courbe = Array.from({ length: n }, (_, k) => {
    const idx = premier + k;
    const t = idx * unite - decalage; // début du créneau en UTC
    const d = new Date(t + decalage);
    return {
      t,
      label: unite === H ? `${String(d.getUTCHours()).padStart(2, "0")}h` : `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      visiteurs: new Set(), pages_vues: 0, clics: 0,
    };
  });
  for (const e of courants) {
    const i = indexLocal(ts(e), unite) - premier;
    if (i < 0 || i >= n) continue;
    const c = courbe[i];
    if (e.type === "page_vue") c.pages_vues++;
    if (e.type === "clic_whatsapp") c.clics++;
    if ((e.type === "visite" || e.type === "page_vue" || e.type === "duree") && e.session_id) c.visiteurs.add(e.session_id);
  }
  const courbeFinale = courbe.map((c) => ({ t: c.t, label: c.label, visiteurs: c.visiteurs.size, pages_vues: c.pages_vues, clics: c.clics }));

  // --- Heures de la journée les plus actives (pages vues par heure locale) ---
  const heures = Array(24).fill(0);
  for (const e of courants) if (e.type === "page_vue") heures[Math.floor(((ts(e) + decalage) % J) / H)]++;

  // --- Appareils (visiteurs uniques) et provenance (visites) ---
  const appareilParVisiteur = new Map();
  for (const e of courants) if (e.appareil && e.session_id) appareilParVisiteur.set(e.session_id, e.appareil);
  const appareils = topN(compter([...appareilParVisiteur.values()], (a) => a), 10).map(([nom, nb]) => ({ nom, nb }));

  const sourceParVisite = new Map();
  for (const e of courants) if (e.source && e.visite_id) sourceParVisite.set(e.visite_id, e.source);
  const sources = topN(compter([...sourceParVisite.values()], (s) => s), 10).map(([nom, nb]) => ({ nom, nb }));

  // --- Pages vues ---
  const pages = courants.filter((e) => e.type === "page_vue" && e.chemin);
  const vuesSection = new Map();
  for (const p of pages) {
    const s = section(p.chemin);
    const e = vuesSection.get(s) || { vues: 0, visiteurs: new Set() };
    e.vues++; if (p.session_id) e.visiteurs.add(p.session_id);
    vuesSection.set(s, e);
  }
  const sections = [...vuesSection.entries()].map(([nom, e]) => ({ nom, vues: e.vues, visiteurs: e.visiteurs.size })).sort((a, b) => b.vues - a.vues);

  const topPages = topN(compter(pages, (p) => normaliser(p.chemin)), 10).map(([chemin, vues]) => ({ chemin, vues }));

  // Boutiques et produits les plus vus (identifiants ; les noms sont ajoutés par la route)
  const parCible = (extraire) => {
    const m = new Map();
    for (const p of pages) {
      const id = extraire(p.chemin);
      if (!id) continue;
      const e = m.get(id) || { vues: 0, visiteurs: new Set() };
      e.vues++; if (p.session_id) e.visiteurs.add(p.session_id);
      m.set(id, e);
    }
    return [...m.entries()].map(([id, e]) => ({ id, vues: e.vues, visiteurs: e.visiteurs.size })).sort((a, b) => b.vues - a.vues).slice(0, 10);
  };
  const boutiques = parCible((c) => { const m = c.match(/^\/boutique\/([^/?]+)/); return m && UUID.test(m[1]) ? m[1] : null; });
  const produits = parCible((c) => { const m = c.match(/^\/boutique\/produit\/([^/?]+)/); return m ? m[1] : null; });

  // --- Temps passé : répartition des visites par durée ---
  const tranches = [
    ["Moins de 10 s", 0, 10], ["10 – 30 s", 10, 30], ["30 s – 1 min", 30, 60],
    ["1 – 3 min", 60, 180], ["3 – 10 min", 180, 600], ["Plus de 10 min", 600, Infinity],
  ];
  const repartitionDuree = tranches.map(([nom, a, b]) => ({ nom, nb: _durees.filter((d) => d >= a && d < b).length }));

  // --- Clics WhatsApp par type de cible ---
  const clicsParType = topN(compter(courants.filter((e) => e.type === "clic_whatsapp"), (e) => e.cible_type || "autre"), 10).map(([nom, nb]) => ({ nom, nb }));

  return {
    periode,
    genere_le: new Date(maintenant).toISOString(),
    kpi, precedent: prec,
    courbe: courbeFinale, heures,
    appareils, sources, sections, top_pages: topPages,
    boutiques, produits,
    repartition_duree: repartitionDuree,
    clics_par_type: clicsParType,
    nb_evenements: courants.length,
  };
}
