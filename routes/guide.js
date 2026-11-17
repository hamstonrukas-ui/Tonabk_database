// Textes du guide de bienvenue (3 écrans). Pour changer un texte, modifiez-le ici.
export const ECRANS_GUIDE = [
  { n: "1", icone: "🛍️", titre: "Choisissez un rayon", texte: "Chemises, robes, souliers… Touchez une catégorie, puis le type de produit qui vous intéresse." },
  { n: "2", icone: "💬", titre: "Écrivez au vendeur", texte: "Touchez un article, puis le bouton WhatsApp pour parler au vendeur. Ou touchez « Livre-moi » : on vous livre à la maison." },
  { n: "3", icone: "🔎", titre: "Vous ne trouvez pas ?", texte: "Dites-nous ce que vous cherchez avec le bouton « Demander » : on le cherche pour vous." },
];

export const PHRASE_RASSURANCE = "Aucun compte nécessaire pour parcourir et écrire au vendeur.";

const CLE_VU = "tonabk_guide_vu";
export function guideVu() {
  try { return localStorage.getItem(CLE_VU) === "1"; } catch { return true; } // stockage bloqué : on n'insiste pas
}
export function marquerGuideVu() {
  try { localStorage.setItem(CLE_VU, "1"); } catch { /* pas grave */ }
}
