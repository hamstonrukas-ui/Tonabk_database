// Admin secondaire (personnel) : peut voir toutes les boutiques, ajouter et modifier des
// produits. Ne peut JAMAIS supprimer un produit ni une boutique (réservé à l'admin complet).
// Le rôle est lu UNIQUEMENT dans app_metadata, que seul l'administrateur du projet peut
// modifier. Ne jamais le lire dans user_metadata : chaque utilisateur peut y écrire lui-même.
export function estAdminSecondaire(req) {
  return req.user.app_metadata?.role === "admin_secondaire";
}
