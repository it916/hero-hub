// ═══════════════════════════════════════════
// Hero Hub · Tracker de Métricas
// Registra cada visita a una página del Hub
// ═══════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Detectar la página actual desde la URL
function getPageName() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  return path.replace('.html', '') || 'index';
}

// Registrar un evento
async function trackVisit(user) {
  const page = getPageName();

  // Evitar tracking si la página no es del Hub
  const validPages = ['index', 'equipo', 'carriers', 'directorio', 'guias', 'politicas', 'onboarding', 'admin'];
  if (!validPages.includes(page)) return;

  // Evitar doble tracking: si ya trackeamos esta página en los últimos 30 segundos, saltar
  const cacheKey = `lastTrack_${page}`;
  const lastTrack = parseInt(sessionStorage.getItem(cacheKey) || '0');
  const now = Date.now();
  if (now - lastTrack < 30000) return;
  sessionStorage.setItem(cacheKey, now.toString());

  try {
    await addDoc(collection(db, "events"), {
      email: user.email,
      page: page,
      timestamp: serverTimestamp()
    });
  } catch (e) {
    // Silencioso: si falla el tracking no queremos molestar al usuario
    console.warn("Track failed:", e.message);
  }
}

// Esperar a que el usuario esté autenticado y trackear
onAuthStateChanged(auth, (user) => {
  if (user && user.email && user.email.endsWith("@heroinsuranceusa.com")) {
    trackVisit(user);
  }
});
