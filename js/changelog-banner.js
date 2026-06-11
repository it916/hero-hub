// ═══════════════════════════════════════════
// Hero Hub · Banner de novedades del Changelog
// ═══════════════════════════════════════════
// Solo se incluye en index.html. Compara el id de la entrada más reciente
// del changelog con users/{email}.lastChangelogSeenId. Si difieren, muestra
// el banner. Al hacer clic en el banner, marca como visto + redirige.
// La × también marca como visto pero sin redirigir.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  // Pequeño delay para no competir con la carga inicial del dashboard
  setTimeout(() => checkChangelogBanner(user), 1500);
});

async function checkChangelogBanner(user) {
  let latestId = null;

  // 1. Obtener el id más reciente del changelog
  try {
    const res = await fetch("data/changelog.json", { cache: "no-store" });
    if (!res.ok) return;
    const entries = await res.json();
    if (!Array.isArray(entries) || !entries.length) return;

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

  // 3. Mostrar el banner
  showBanner(user, latestId);
}

function showBanner(user, latestId) {
  const banner = document.getElementById("changelog-banner");
  if (!banner) return;

  banner.style.display = "flex";
  // Pequeño retardo para que el navegador aplique display:flex antes del fade-in
  requestAnimationFrame(() => banner.classList.add("is-open"));
  if (window.refreshIcons) window.refreshIcons();

  const goToChangelog = async () => {
    await markSeen(user.email, latestId);
    location.href = "changelog.html";
  };

  const dismissOnly = async (e) => {
    e.stopPropagation();
    await markSeen(user.email, latestId);
    banner.classList.remove("is-open");
    setTimeout(() => { banner.style.display = "none"; }, 300);
  };

  // Clic en cualquier parte del banner (excepto la ×) → ir al changelog
  banner.addEventListener("click", goToChangelog);
  banner.querySelector(".changelog-banner-close")?.addEventListener("click", dismissOnly);
}

async function markSeen(email, latestId) {
  try {
    await setDoc(
      doc(db, "users", email),
      { lastChangelogSeenId: latestId },
      { merge: true }
    );
  } catch (e) {
    console.warn("No se pudo guardar last seen:", e.message);
  }
}
