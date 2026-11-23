// Journal automatique des opérations du personnel (admins secondaires) : alimente le « Tableau du personnel ».
import { supabaseAdmin } from "../middleware/verifyAuth.js";
import { estAdminSecondaire } from "../middleware/roles.js";

// type : "solde" | "mali_mupya" | "kisakoshi" | "article"
// Les messages "[ACTIVITE]" apparaissent dans les Logs de Render : ils disent si l'opération a été comptée ou pourquoi non.
export async function noterActivite(req, type, nombre = 1) {
  try {
    if (!estAdminSecondaire(req)) {
      console.log(`[ACTIVITE] ${type} ignoré : ${req.user?.email || req.user?.id} n'est pas admin_secondaire (app_metadata.role = ${req.user?.app_metadata?.role ?? "vide"})`);
      return;
    }
    const { error } = await supabaseAdmin.from("activite_personnel").insert({ personnel_id: req.user.id, type, nombre });
    if (error) console.error(`[ACTIVITE] ${type} NON enregistré :`, error.message);
    else console.log(`[ACTIVITE] ${type} enregistré pour ${req.user.email || req.user.id}`);
  } catch (e) {
    console.error("[ACTIVITE] erreur :", e.message);
  }
}
