// Script à exécuter une seule fois pour donner un rôle admin à un utilisateur.
// Utilise les mêmes variables d'environnement que le serveur (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY) — donc à lancer là où elles sont déjà disponibles :
// le plus simple est l'onglet "Shell" de ton service sur Render.
//
// Usage : node definir-role.js <uid> <role>
// Exemple : node definir-role.js 0ba9b5b2-40a9-4717-9048-cb6f05459b45 admin_secondaire

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const [, , uid, role] = process.argv;

if (!uid || !role) {
  console.error("Usage : node definir-role.js <uid> <role>");
  process.exit(1);
}

const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
  app_metadata: { role },
});

if (error) {
  console.error("Échec :", error.message);
  process.exit(1);
}

console.log(`OK — rôle "${role}" appliqué à ${data.user.email} (${uid})`);
console.log("app_metadata actuel :", data.user.app_metadata);
  
