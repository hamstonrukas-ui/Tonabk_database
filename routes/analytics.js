import { API_URL } from "./api";

// Envoi "silencieux" — on ne bloque jamais l'utilisateur si ça échoue (réseau instable)
export function enregistrerClicWhatsapp(cibleType, cibleId) {
  fetch(`${API_URL}/api/analytics/clic-whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cible_type: cibleType, cible_id: cibleId }),
  }).catch(() => {});
}

// Une visite = une session de navigateur (pas à chaque changement de page)
const CLE_SESSION_VISITE = "tonabk_visite_enregistree";

export function enregistrerVisiteSession() {
  if (sessionStorage.getItem(CLE_SESSION_VISITE)) return;
  sessionStorage.setItem(CLE_SESSION_VISITE, "1");
  fetch(`${API_URL}/api/analytics/visite`, { method: "POST" }).catch(() => {});
}
