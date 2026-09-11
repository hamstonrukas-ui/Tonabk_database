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

  const titre = echapperHTML(produit.nom);
  const prixTexte = `${Number(produit.prix).toLocaleString("fr-FR")} ${produit.devise || "USD"}`;
  const description = echapperHTML(
    `${prixTexte}${produit.boutiques?.nom ? " — " + produit.boutiques.nom : ""} — Vu sur TonaBk`
  );
  const image = produit.photo_url || `${siteUrl}/icon-512.png`;

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${titre}</title>
<meta property="og:title" content="${titre}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${echapperHTML(image)}" />
<meta property="og:url" content="${urlReelle}" />
<meta property="og:type" content="product" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0;url=${urlReelle}" />
<script>window.location.replace(${JSON.stringify(urlReelle)});</script>
</head>
<body>
<p>Redirection vers TonaBk…</p>
</body>
</html>`);
});

export default router;
