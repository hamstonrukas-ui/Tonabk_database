// Dépôt de colis : le client remplit le formulaire (sans compte), l'équipe voit les demandes dans l'admin.
import express from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { verifyAuth, supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 3 } });
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const STATUTS = ["nouveau", "en_cours", "termine"];

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

const estAdmin = (req) => req.user.app_metadata?.role === "admin" || req.user.user_metadata?.role === "admin";
const equipe = (req) => estAdmin(req); // réservé à l'administrateur principal

// Anti-abus simple : 6 dépôts par heure et par adresse IP
const essais = new Map();
function limite(ip) {
  const maintenant = Date.now();
  const liste = (essais.get(ip) || []).filter((t) => maintenant - t < 3600_000);
  if (liste.length >= 6) return true;
  liste.push(maintenant);
  essais.set(ip, liste);
  if (essais.size > 5000) essais.clear();
  return false;
}

const nettoyer = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// POST /api/colis  (multipart : depart, destination, description, nom, telephone, photos x3 max)
router.post("/", (req, res, next) => {
  upload.array("photos", 3)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Photo trop lourde (6 Mo maximum)" : "Fichiers invalides" });
    next();
  });
}, async (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
    if (limite(ip)) return res.status(429).json({ error: "Trop de demandes, réessayez plus tard ou écrivez-nous sur WhatsApp." });

    const depart = nettoyer(req.body.depart, 80);
    const destination = nettoyer(req.body.destination, 80);
    const description = nettoyer(req.body.description, 1500);
    const nom = nettoyer(req.body.nom, 80);
    const telephone = nettoyer(req.body.telephone, 30);
    if (!depart || !destination) return res.status(400).json({ error: "Indiquez le lieu de départ et la destination" });
    if (!description) return res.status(400).json({ error: "Décrivez votre colis" });
    if (telephone.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "Indiquez un numéro WhatsApp valide" });

    const photos = [];
    for (const f of req.files || []) {
      const ext = EXTENSIONS[f.mimetype];
      if (!ext) return res.status(400).json({ error: "Format de photo non pris en charge (JPG, PNG ou WebP)" });
      const key = `colis/${randomUUID()}.${ext}`;
      await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: f.buffer, ContentType: f.mimetype }));
      photos.push(`${process.env.R2_PUBLIC_URL}/${key}`);
    }

    const { data, error } = await supabaseAdmin
      .from("colis_depots").insert({ depart, destination, description, nom: nom || null, telephone, photos })
      .select("id").single();
    if (error) throw error;
    res.json({ ok: true, id: data.id });
  } catch (e) {
    console.error("Dépôt de colis :", e);
    res.status(500).json({ error: "Impossible d'enregistrer votre demande, écrivez-nous sur WhatsApp." });
  }
});

// GET /api/colis  (équipe)
router.get("/", verifyAuth, async (req, res) => {
  if (!equipe(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const { data, error } = await supabaseAdmin.from("colis_depots").select("*").order("cree_le", { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: "Lecture impossible" });
  res.json(data || []);
});

// PATCH /api/colis/:id  { statut?, note? }  (équipe)
router.patch("/:id", verifyAuth, async (req, res) => {
  if (!equipe(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const maj = {};
  if (req.body.statut !== undefined) {
    if (!STATUTS.includes(req.body.statut)) return res.status(400).json({ error: "Statut invalide" });
    maj.statut = req.body.statut;
  }
  if (req.body.note !== undefined) maj.note = nettoyer(req.body.note, 1000) || null;
  if (!Object.keys(maj).length) return res.status(400).json({ error: "Rien à modifier" });
  const { error } = await supabaseAdmin.from("colis_depots").update(maj).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "Modification impossible" });
  res.json({ ok: true });
});

// DELETE /api/colis/:id  (équipe)
router.delete("/:id", verifyAuth, async (req, res) => {
  if (!equipe(req)) return res.status(403).json({ error: "Réservé à l'administrateur principal" });
  const { error } = await supabaseAdmin.from("colis_depots").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "Suppression impossible" });
  res.json({ ok: true });
});

export default router;
