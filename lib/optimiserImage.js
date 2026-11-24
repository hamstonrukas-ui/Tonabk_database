// Allège les photos avant de les ranger sur R2 : une photo de téléphone (2 à 6 Mo) devient
// une image WebP d'environ 60 à 150 Ko, et une miniature d'environ 10 à 30 Ko pour les listes.
// Si « sharp » n'est pas installé, ou si l'image est illisible, on renvoie null : l'appelant garde alors
// la photo d'origine (comportement d'avant), donc rien ne casse.
let sharp = null;
let tente = false;

async function charger() {
  if (tente) return sharp;
  tente = true;
  try {
    sharp = (await import("sharp")).default;
    sharp.cache(false);      // économise la mémoire sur un petit serveur
    sharp.concurrency(1);
  } catch (e) {
    console.warn("[photos] sharp indisponible, les photos seront gardées telles quelles :", e.message);
  }
  return sharp;
}

const TYPES_OPTIMISABLES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Renvoie { principale, miniature } (deux Buffers WebP) ou null
export async function optimiserPhoto(buffer, mimetype, { largeur = 1200, qualite = 75, largeurMiniature = 400, qualiteMiniature = 70 } = {}) {
  if (!TYPES_OPTIMISABLES.has(mimetype)) return null;
  const s = await charger();
  if (!s) return null;
  try {
    const principale = await s(buffer, { failOn: "none" })
      .rotate()                                            // respecte l'orientation du téléphone
      .resize({ width: largeur, height: largeur, fit: "inside", withoutEnlargement: true })
      .webp({ quality: qualite })
      .toBuffer();
    const miniature = await s(principale)
      .resize({ width: largeurMiniature, height: largeurMiniature, fit: "inside", withoutEnlargement: true })
      .webp({ quality: qualiteMiniature })
      .toBuffer();
    // Si l'image d'origine était déjà plus légère, on la garde
    if (principale.length >= buffer.length) return null;
    return { principale, miniature };
  } catch (e) {
    console.warn("[photos] optimisation impossible, photo gardée telle quelle :", e.message);
    return null;
  }
}
