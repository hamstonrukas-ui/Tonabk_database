import express from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Upload d'une photo produit, avec vérification de la limite gratuite
router.post("/photo", verifyAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });

    const boutiqueId = req.body.boutiqueId;

    const { data: boutique } = await supabaseAdmin
      .from("boutiques")
      .select("photos_utilisees, photo_limite_gratuite, owner_id")
      .eq("id", boutiqueId)
      .single();

    if (!boutique || boutique.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Non autorisé sur cette boutique" });
    }

    if (boutique.photos_utilisees >= boutique.photo_limite_gratuite) {
      return res.status(402).json({
        error: "Limite de photos gratuites atteinte",
        message: `Vous avez atteint votre limite de ${boutique.photo_limite_gratuite} photos gratuites. Passez à un forfait payant pour continuer.`,
      });
    }

    const extension = req.file.mimetype === "image/png" ? "png" : "jpg";
    const key = `boutiques/${boutiqueId}/produits/${randomUUID()}.${extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const url = `${process.env.R2_PUBLIC_URL}/${key}`;

    await supabaseAdmin
      .from("boutiques")
      .update({ photos_utilisees: boutique.photos_utilisees + 1 })
      .eq("id", boutiqueId);

    res.json({ url });
  } catch (error) {
    console.error("Erreur upload R2 :", error);
    res.status(500).json({ error: "Échec de l'upload de la photo" });
  }
});

// Upload d'une photo de maison
router.post("/photo-maison", verifyAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });

    const maisonId = req.body.maisonId;
    const extension = req.file.mimetype === "image/png" ? "png" : "jpg";
    const key = `maisons/${maisonId}/${randomUUID()}.${extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const url = `${process.env.R2_PUBLIC_URL}/${key}`;
    res.json({ url });
  } catch (error) {
    console.error("Erreur upload R2 :", error);
    res.status(500).json({ error: "Échec de l'upload de la photo" });
  }
});

export default router;
