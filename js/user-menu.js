// ═══════════════════════════════════════════
// Menú del usuario en el avatar del topbar
// ═══════════════════════════════════════════
// Módulo compartido entre todas las páginas del Hero Hub. Se auto-inicializa
// cuando la sesión de Firebase resuelve; no requiere que las páginas lo
// importen ni lo llamen manualmente.
//
// Cada página del Hub carga este archivo como <script type="module">.
// Cuando `onAuthStateChanged` emite un usuario, bindea el botón del avatar
// para abrir el dropdown y le pone header, ítems y handlers.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function saveUserField(fields) {
  const user = auth.currentUser;
  if (!user) return;
  try { await updateDoc(doc(db, "users", user.email), fields); }
  catch (e) { console.error("[user-menu] Error guardando:", e); }
}

async function toggleHubTheme() {
  const current = document.body.dataset.theme || "light";
  const next = current === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  try { localStorage.setItem("hero-theme", next); } catch (e) {}
  syncThemeMenuItem();
  await saveUserField({ theme: next });
}

function syncThemeMenuItem() {
  const item = document.getElementById("user-menu-theme");
  if (!item) return;
  const theme = document.body.dataset.theme || "light";
  const icon = theme === "dark" ? "sun" : "moon";
  const label = theme === "dark" ? "Cambiar a día" : "Cambiar a noche";
  item.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  if (window.refreshIcons) window.refreshIcons();
}

export function attachUserMenu() {
  const btn = document.getElementById("user-avatar-btn");
  const menu = document.getElementById("user-menu");
  if (!btn || !menu || btn.dataset.bound) return;
  btn.dataset.bound = "1";

  const user = auth.currentUser;
  if (user) {
    const nameEl  = document.getElementById("user-menu-name");
    const emailEl = document.getElementById("user-menu-email");
    if (nameEl)  nameEl.textContent  = user.displayName || user.email.split("@")[0];
    if (emailEl) emailEl.textContent = user.email;

    // Rol: leer del body class que aplicó auth/page-guard (patrón role-{nombre}).
    // Si es admin, hacer visible el ítem "Admin" del menú.
    const roleClass = [...document.body.classList].find(c => c.startsWith("role-"));
    if (roleClass) {
      const roleName = roleClass.replace("role-", "");
      const roleEl = document.getElementById("user-menu-role");
      if (roleEl) {
        roleEl.textContent = roleName.toUpperCase();
        roleEl.hidden = false;
      }
      if (roleName === "admin") {
        const adminItem = document.getElementById("user-menu-admin");
        if (adminItem) adminItem.hidden = false;
      }
    }
  }

  // Copia la foto del user-avatar al user-menu-avatar. Si el src ya está listo
  // se copia enseguida; si aún no (los JS de página lo setean con
  // getFreshGooglePhotoURL en async), un MutationObserver lo captura al cambiar.
  const userAv = document.getElementById("user-avatar");
  const menuAv = document.getElementById("user-menu-avatar");
  if (userAv && menuAv) {
    const copySrc = () => {
      if (userAv.src && !userAv.src.startsWith("data:image/gif")) {
        menuAv.src = userAv.src;
      }
    };
    copySrc();
    new MutationObserver(copySrc).observe(userAv, {
      attributes: true,
      attributeFilter: ["src"]
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    }
  });

  // Cerrar sesión: reusa el listener existente en el JS de cada página
  // disparando click en el botón #btn-logout (que queda oculto en el topbar).
  const logoutBtn = document.getElementById("user-menu-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const legacyLogoutBtn = document.getElementById("btn-logout");
      if (legacyLogoutBtn) legacyLogoutBtn.click();
    });
  }

  // Toggle día/noche.
  syncThemeMenuItem();
  const themeItem = document.getElementById("user-menu-theme");
  if (themeItem) themeItem.addEventListener("click", toggleHubTheme);
}

// Auto-init: cuando la auth resuelva un usuario, bindea el menú.
// requestAnimationFrame da un tick para que el DOM del topbar termine de pintar.
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  requestAnimationFrame(attachUserMenu);
});
