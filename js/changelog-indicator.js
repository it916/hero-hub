// ═══════════════════════════════════════════
// Hero Hub · Indicador de novedades del Changelog
// ═══════════════════════════════════════════
// Solo se incluye en index.html. Compara el id de la entrada más reciente
// del changelog con users/{email}.lastChangelogSeenId. Si difieren, pinta
// un punto cyan sobre el link "Changelog" del topbar.
//
// Hasta la v2.36.0 esto era un banner flotante sobre el dashboard, con
// texto y botón de cerrar. Se retiró el 2026-08-21 por invasivo: el punto
// avisa igual sin interrumpir.
//
// El punto no se apaga solo: desaparece cuando el usuario entra a
// changelog.html, que es donde se marca lastChangelogSeenId. Por eso este
// módulo ya no escribe en Firestore — solo lee.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { canSeeAudience } from "./roles.js";

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  // Pequeño delay para no competir con la carga inicial del dashboard
  setTimeout(() => checkChangelogIndicator(user), 1500);
});

// Decide si una entrada del changelog es visible para el rol dado.
// Misma regla que la página del changelog — vive en roles.js (canSeeAudience).
function entryVisibleFor(entry, role) {
  return canSeeAudience(entry.audience, role);
}

async function checkChangelogIndicator(user) {
  let latestId = null;

  // Rol del usuario desde el cache que persiste auth.js. Si todavía no está
  // (primera carga del browser tras este deploy), asumimos "agente" — el más
  // restrictivo — para no filtrar de menos. La próxima visita ya estará poblado.
  let role = "agente";
  try {
    const stored = localStorage.getItem("hero-user-role");
    if (stored) role = stored;
  } catch (_) {}

  // 1. Obtener el id más reciente del changelog VISIBLE para este usuario
  try {
    const res = await fetch("data/changelog.json", { cache: "no-store" });
    if (!res.ok) return;
    const all = await res.json();
    if (!Array.isArray(all) || !all.length) return;

    const entries = all.filter(e => entryVisibleFor(e, role));
    if (!entries.length) return;

    entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    latestId = entries[0].id;
  } catch (e) {
    console.warn("No se pudo leer changelog.json:", e.message);
    return;
  }

  if (!latestId) return;

  // 2. Comparar con lo que el usuario ya vio
  try {
    const snap = await getDoc(doc(db, "users", user.email));
    const lastSeenId = snap.exists() ? snap.data().lastChangelogSeenId : null;
    if (lastSeenId === latestId) return; // ya lo vio
  } catch (e) {
    console.warn("No se pudo leer last seen:", e.message);
    return;
  }

  // 3. Marcar el link del topbar
  showIndicator();
}

function showIndicator() {
  // El topbar puede haberse filtrado por rol (roles.js → filterTopbarByRole).
  // Si el link quedó oculto, no tiene sentido pintarle el punto.
  const link = document.querySelector('#topbar-nav .nav-link[href="changelog.html"]');
  if (!link || link.style.display === "none") return;
  link.classList.add("has-news");
}
