import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

// ⚠️ ROUTE TEMPORAIRE — à supprimer une fois le rôle admin attribué.
// Aucune protection : n'importe qui connaissant l'URL peut s'en servir.
router.get("/rendre-admin/:userId", async (req, res) => {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.userId, {
    user_metadata: { role: "admin" },
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: "Rôle admin attribué" });
});

export default router;
           
