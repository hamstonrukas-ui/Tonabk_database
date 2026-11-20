// Journal automatique des opérations du personnel (admins secondaires) : alimente le « Tableau du personnel ».
import { supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

// type : "solde" | "mali_mupya" | "kisakoshi" | "article"
export async function noterActivite(req, type, nombre = 1) {
  try {
    if (!estAdminSecondaire(req)) return;
    const { error } = await supabaseAdmin.from("activite_personnel").insert({ personnel_id: req.user.id, type, nombre });
    if (error) console.error("Journal d'activité :", error.message);
  } catch (e) {
    console.error("Journal d'activité :", e.message);
  }
}
