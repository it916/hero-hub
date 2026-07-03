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
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Banderas SVG por país (subset — patrón ya usado en equipo.js).
const FLAG_URLS = {
  'venezuela': 'https://flagicons.lipis.dev/flags/4x3/ve.svg',
  'cuba': 'https://flagicons.lipis.dev/flags/4x3/cu.svg',
  'colombia': 'https://flagicons.lipis.dev/flags/4x3/co.svg',
  'chile': 'https://flagicons.lipis.dev/flags/4x3/cl.svg',
  'estados unidos': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'eeuu': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'us': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
};
const getFlagUrl = (c) => c ? (FLAG_URLS[c.toLowerCase().trim()] || null) : null;

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Formatea una fecha de cumpleaños que puede venir como "YYYY-MM-DD",
// "MM-DD" o "DD/MM/YYYY". Devuelve algo tipo "22 de mayo".
function formatBirthday(str) {
  if (!str) return null;
  const s = String(str).trim();
  let month, day;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { month = parseInt(m[2], 10); day = parseInt(m[3], 10); }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{2,4}$/))) {
    month = parseInt(m[2], 10); day = parseInt(m[1], 10);
  }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/))) {
    month = parseInt(m[1], 10); day = parseInt(m[2], 10);
  }
  if (!month || !day) return s;
  const name = MONTHS_ES[month - 1];
  if (!name) return s;
  return `${day} de ${name}`;
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

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

  // Mi perfil: intercepta el click y abre el modal en vez de navegar a Equipo.
  const profileItem = document.getElementById("user-menu-profile");
  if (profileItem) {
    profileItem.addEventListener("click", (e) => {
      e.preventDefault();
      // Cerrar el dropdown antes de abrir el modal para evitar solapamiento visual.
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      openMyProfileModal();
    });
  }
}

// Modal de "Mi perfil" con foto, cargo, rol, contacto, cumpleaños y bio.
// Los datos se cargan desde shared/team.members matcheado por email del usuario
// actual. Si el usuario no está en shared/team se muestra solo el mínimo.
async function openMyProfileModal() {
  const user = auth.currentUser;
  if (!user) return;

  // Buscar la entry del usuario en shared/team.
  let member = null;
  try {
    const snap = await getDoc(doc(db, "shared", "team"));
    if (snap.exists()) {
      const members = snap.data().members || [];
      const email = user.email.toLowerCase();
      member = members.find(m => {
        const emails = Array.isArray(m.email) ? m.email : [m.email];
        return emails.some(e => (e || "").toLowerCase() === email);
      });
    }
  } catch (e) {
    console.error("[my-profile] Error cargando shared/team:", e);
  }

  // Rol del sistema (body class role-{X})
  const roleClass = [...document.body.classList].find(c => c.startsWith("role-"));
  const roleName = roleClass ? roleClass.replace("role-", "") : null;

  // Datos combinados
  const displayName = member?.name || user.displayName || user.email.split("@")[0];
  const cargo = member?.role || null;
  const photoUrl = user.photoURL || member?.photo || '';
  const phones = Array.isArray(member?.phone) ? member.phone.filter(Boolean) : (member?.phone ? [member.phone] : []);
  const country = member?.country || null;
  const flagUrl = country ? getFlagUrl(country) : null;
  const birthdayFmt = formatBirthday(member?.birthdate);
  const themeLabel = (document.body.dataset.theme === "dark") ? "Noche" : "Día";
  const bio = member?.bio || null;

  const dash = '<span class="mp-empty">—</span>';
  const contactRows = [];
  if (phones.length) {
    contactRows.push(`<div class="mp-row"><span class="mp-label">Teléfono</span><span class="mp-value">${escapeHtml(phones.join(", "))}</span></div>`);
  }
  if (country) {
    const flagImg = flagUrl ? `<img src="${flagUrl}" alt="" class="mp-flag">` : '';
    contactRows.push(`<div class="mp-row"><span class="mp-label">País</span><span class="mp-value">${flagImg}${escapeHtml(country)}</span></div>`);
  }

  const dataRows = [];
  dataRows.push(`<div class="mp-row"><span class="mp-label">Cumpleaños</span><span class="mp-value">${birthdayFmt ? escapeHtml(birthdayFmt) : dash}</span></div>`);
  dataRows.push(`<div class="mp-row"><span class="mp-label">Tema</span><span class="mp-value">${themeLabel}</span></div>`);

  const dialog = document.createElement("sl-dialog");
  dialog.label = "Mi perfil";
  dialog.className = "hh-dialog hh-my-profile-dialog";
  dialog.innerHTML = `
    <div class="mp-header">
      <img class="mp-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}">
      <div class="mp-header-info">
        <div class="mp-name">${escapeHtml(displayName)}</div>
        ${cargo ? `<div class="mp-cargo">${escapeHtml(cargo)}</div>` : ''}
        ${roleName ? `<div class="mp-badge">${escapeHtml(roleName.toUpperCase())}</div>` : ''}
      </div>
    </div>
    <div class="mp-email">${escapeHtml(user.email)}</div>

    ${contactRows.length ? `
    <div class="mp-section">
      <div class="mp-section-title">Contacto</div>
      ${contactRows.join('')}
    </div>` : ''}

    <div class="mp-section">
      <div class="mp-section-title">Datos</div>
      ${dataRows.join('')}
    </div>

    <div class="mp-section">
      <div class="mp-section-title">Sobre mí</div>
      <div class="mp-bio">${bio ? escapeHtml(bio) : dash}</div>
    </div>

    <sl-button slot="footer" id="mp-close" variant="primary">Cerrar</sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  dialog.addEventListener("sl-after-hide", () => dialog.remove());
  dialog.querySelector("#mp-close").addEventListener("click", () => dialog.hide());

  // Shoelace lazy-registra el custom element en el primer uso.
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

// Auto-init: cuando la auth resuelva un usuario, bindea el menú.
// requestAnimationFrame da un tick para que el DOM del topbar termine de pintar.
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  requestAnimationFrame(attachUserMenu);
});
