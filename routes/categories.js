import express from "express";
import { supabaseAdmin } from "../middleware/verifyAuth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("*")
    .eq("actif", true)
    .order("ordre");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
