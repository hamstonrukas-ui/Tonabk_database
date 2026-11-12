    import express from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
// Audio des soldes : 8 Mo maximum
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function estAdmin(req) {
  return req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
}

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

    if (!boutique || (boutique.owner_id !== req.user.id && !estAdmin(req) && !estAdminSecondaire(req))) {
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

// Upload de la photo de profil (logo) d'une boutique — stocké sur Supabase Storage (pas sur R2), et ne compte pas dans le quota de photos produits
router.post("/photo-boutique-logo", verifyAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });

    const boutiqueId = req.body.boutiqueId;

    const { data: boutique } = await supabaseAdmin
      .from("boutiques")
      .select("owner_id")
      .eq("id", boutiqueId)
      .single();

    if (!boutique || boutique.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Non autorisé sur cette boutique" });
    }

    const extension = req.file.mimetype === "image/png" ? "png" : "jpg";
    const chemin = `${boutiqueId}/${randomUUID()}.${extension}`;

    const { error: erreurUpload } = await supabaseAdmin.storage
      .from("logos-boutiques")
      .upload(chemin, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (erreurUpload) {
      console.error("Erreur upload Supabase Storage :", erreurUpload);
      return res.status(500).json({ error: "Échec de l'upload de la photo" });
    }

    const { data: urlPublique } = supabaseAdmin.storage
      .from("logos-boutiques")
      .getPublicUrl(chemin);

    res.json({ url: urlPublique.publicUrl });
  } catch (error) {
    console.error("Erreur upload logo boutique :", error);
    res.status(500).json({ error: "Échec de l'upload de la photo" });
  }
});

// Upload d'une photo de maison
router.post("/photo-maison", verifyAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });

    const maisonId = req.body.maisonId;

    const { data: maison } = await supabaseAdmin
      .from("maisons")
      .select("publie_par")
      .eq("id", maisonId)
      .single();

    if (!maison || maison.publie_par !== req.user.id) {
      return res.status(403).json({ error: "Non autorisé sur cette annonce" });
    }

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

// Upload d'une photo de solde (admin uniquement, pas de limite ni de boutique liée)
router.post("/photo-solde", verifyAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });

    const extension = req.file.mimetype === "image/png" ? "png" : "jpg";
    const key = `soldes/${randomUUID()}.${extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    res.json({ url: `${process.env.R2_PUBLIC_URL}/${key}` });
  } catch (error) {
    console.error("Erreur upload R2 :", error);
    res.status(500).json({ error: "Échec de l'upload de la photo" });
  }
});

// Upload d'une photo de nouveauté (statut de 48 h) : admin ou commerçant ayant une boutique, 6 Mo max
const uploadNouveaute = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });
const EXTENSIONS_PHOTO = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
router.post("/photo-nouveaute", verifyAuth, (req, res, next) => {
  uploadNouveaute.single("photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Photo trop lourde (6 Mo maximum)" : "Fichier invalide" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });
    const extension = EXTENSIONS_PHOTO[req.file.mimetype];
    if (!extension) return res.status(400).json({ error: "Format de photo non pris en charge" });

    if (!estAdmin(req)) {
      const { data: boutiques } = await supabaseAdmin
        .from("boutiques").select("id").eq("owner_id", req.user.id).limit(1);
      if (!boutiques?.length) return res.status(403).json({ error: "Une boutique est nécessaire pour publier une nouveauté" });
    }

    const key = `nouveautes/${randomUUID()}.${extension}`;
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );
    res.json({ url: `${process.env.R2_PUBLIC_URL}/${key}` });
  } catch (error) {
    console.error("Erreur upload R2 (nouveauté) :", error);
    res.status(500).json({ error: "Échec de l'upload de la photo" });
  }
});

// Upload de l'audio d'une annonce de solde (admin uniquement, 8 Mo max)
const EXTENSIONS_AUDIO = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
};
router.post("/audio-solde", verifyAuth, (req, res, next) => {
  uploadAudio.single("audio")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Audio trop lourd (8 Mo maximum)" : "Fichier audio invalide" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!estAdmin(req)) return res.status(403).json({ error: "Réservé à l'admin" });
    if (!req.file) return res.status(400).json({ error: "Aucun audio reçu" });

    const extension = EXTENSIONS_AUDIO[req.file.mimetype];
    if (!extension) return res.status(400).json({ error: "Format audio non pris en charge (mp3, m4a, ogg, wav)" });

    const key = `soldes/audio/${randomUUID()}.${extension}`;
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    res.json({ url: `${process.env.R2_PUBLIC_URL}/${key}` });
  } catch (error) {
    console.error("Erreur upload R2 (audio) :", error);
    res.status(500).json({ error: "Échec de l'upload de l'audio" });
  }
});

export default router;


      
