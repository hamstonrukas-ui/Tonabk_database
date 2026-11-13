import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

function echapperHTML(texte) {
  return String(texte)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageApercu({ titre, description, image, urlReelle }) {
  const t = echapperHTML(titre);
  const d = echapperHTML(description);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${t}</title>
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${echapperHTML(image)}" />
<meta property="og:url" content="${echapperHTML(urlReelle)}" />
<meta property="og:type" content="product" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0;url=${echapperHTML(urlReelle)}" />
<script>window.location.replace(${JSON.stringify(urlReelle)});</script>
</head>
<body>
<p>Redirection vers TonaBk…</p>
</body>
</html>`;
}

const formatPrix = (n, devise) => `${Number(n).toLocaleString("fr-FR")} ${devise || "USD"}`;

// Page de partage pour un produit : WhatsApp lit cette page pour générer l'aperçu
// (photo + titre + prix), puis redirige immédiatement un vrai visiteur vers la fiche produit.
router.get("/produit/:id", async (req, res) => {
  const siteUrl = process.env.FRONTEND_URL || "https://tonabk.com";
  const urlReelle = `${siteUrl}/boutique/produit/${req.params.id}`;

  const { data: produit } = await supabaseAdmin
    .from("produits")
    .select("nom, prix, devise, photo_url, boutiques(nom)")
    .eq("id", req.params.id)
    .single();

  if (!produit) return res.redirect(urlReelle);

  res.send(pageApercu({
    titre: produit.nom,
    description: `${formatPrix(produit.prix, produit.devise)}${produit.boutiques?.nom ? " — " + produit.boutiques.nom : ""} — Vu sur TonaBk`,
    image: produit.photo_url || `${siteUrl}/icon-512.png`,
    urlReelle,
  }));
});

// Même principe pour une offre en solde (photo + titre + prix soldé)
router.get("/solde/:id", async (req, res) => {
  const siteUrl = process.env.FRONTEND_URL || "https://tonabk.com";
  const urlReelle = `${siteUrl}/soldes/${req.params.id}`;

  const { data: solde } = await supabaseAdmin
    .from("soldes")
    .select("titre, prix_solde, devise, photo_url, photos")
    .eq("id", req.params.id)
    .single();

  if (!solde) return res.redirect(urlReelle);

  res.send(pageApercu({
    titre: solde.titre,
    description: `Offre : ${formatPrix(solde.prix_solde, solde.devise)} — Vu sur TonaBk`,
    image: solde.photos?.[0] || solde.photo_url || `${siteUrl}/icon-512.png`,
    urlReelle,
  }));
});

// Même principe pour une nouveauté : la photo apparaît dans le message WhatsApp du client
router.get("/nouveaute/:id", async (req, res) => {
  const siteUrl = process.env.FRONTEND_URL || "https://tonabk.com";
  const urlReelle = `${siteUrl}/nouveautes`;

  const { data: n } = await supabaseAdmin
    .from("nouveautes")
    .select("boutique_id, photo_url, photos, texte, expire_le")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!n || new Date(n.expire_le).getTime() <= Date.now()) return res.redirect(urlReelle);

  let nom = "TonaBk";
  if (n.boutique_id) {
    const { data: b } = await supabaseAdmin.from("boutiques").select("nom").eq("id", n.boutique_id).maybeSingle();
    if (b?.nom) nom = b.nom;
  }

  res.send(pageApercu({
    titre: `Nouveauté — ${nom}`,
    description: `${n.texte ? n.texte + " — " : ""}Vu sur TonaBk`,
    image: n.photos?.[0] || n.photo_url || `${siteUrl}/icon-512.png`,
    urlReelle,
  }));
});

// Même principe pour un Kisakoshi (valise) : la première photo apparaît dans le message WhatsApp
router.get("/kisakoshi/:id", async (req, res) => {
  const siteUrl = process.env.FRONTEND_URL || "https://tonabk.com";
  const urlReelle = `${siteUrl}/kisakoshi`;

  const { data: k } = await supabaseAdmin
    .from("kisakoshi")
    .select("boutique_id, contenu, prix, devise, photos, expire_le")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!k || new Date(k.expire_le).getTime() <= Date.now()) return res.redirect(urlReelle);

  const { data: b } = await supabaseAdmin.from("boutiques").select("nom").eq("id", k.boutique_id).maybeSingle();
  const prix = `${Number(k.prix).toLocaleString("fr-FR")} ${k.devise}`;

  res.send(pageApercu({
    titre: `Kisakoshi — ${b?.nom || "TonaBk"}`,
    description: `${k.contenu} — ${prix} — Vu sur TonaBk`,
    image: k.photos?.[0] || `${siteUrl}/icon-512.png`,
    urlReelle,
  }));
});

export default router;
