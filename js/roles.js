// ═══════════════════════════════════════════
// Hero Hub · Sistema de Roles y Permisos
// ═══════════════════════════════════════════
// Define los roles disponibles, qué puede ver cada uno, y expone
// funciones para consultar permisos desde cualquier página del Hub.
//
// Desde v2.23.4 los roles se leen de la colección users/{email}.access.role
// (fuente de verdad unificada de la Fase 1 del refactor). shared/roles
// queda deprecado y sin lecturas.
//
// Si un usuario no tiene doc en users/, no tiene rol, o su access.active
// es false → se le niega el acceso al Hub.

import { getUserByEmail } from "./user-store.js";

// ═══════════════════════════════════════════
// DEFINICIÓN DE ROLES
// ═══════════════════════════════════════════
// Cada rol tiene una lista de páginas que puede ver.
// Los nombres de las páginas coinciden con los archivos HTML (sin .html).

export const ROLES = {
  admin: {
    label: "Administrador",
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "onboarding", "grabaciones", "reuniones", "changelog", "admin", "finanzas", "finanzas-manual", "it-console", "mi-perfil", "contracting", "solicitud-cuenta"],
    isAdmin: true
  },
  interno: {
    label: "Equipo interno",
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "onboarding", "grabaciones", "reuniones", "changelog", "mi-perfil", "contracting", "solicitud-cuenta"],
    isAdmin: false
  },
  finanzas: {
    label: "Finanzas",
    // Misma visibilidad que "interno" + la página de Finanzas y su manual. Sin acceso a admin/grabaciones/onboarding.
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "reuniones", "changelog", "finanzas", "finanzas-manual", "mi-perfil", "contracting", "solicitud-cuenta"],
    isAdmin: false
  },
  it: {
    label: "IT",
    // Misma visibilidad que "interno" + la IT Console. Sin acceso a admin/finanzas.
    // it@ está en LEGACY_ADMIN_EMAILS y entra como admin — este rol es para
    // futuros asistentes de IT o cuentas de servicio que necesiten la consola.
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "reuniones", "changelog", "it-console", "mi-perfil", "contracting", "solicitud-cuenta"],
    isAdmin: false
  },
  agente: {
    label: "Agente",
    // Acceso restringido: solo Inicio, Equipo, Portales, Grabaciones y Changelog.
    // Los agentes NO pueden solicitar altas/bajas de cuentas — es tarea de líderes.
    // En portales.js sigue habiendo lógica que muestra al agente solo su sección personal.
    pages: ["index", "equipo", "portales", "grabaciones", "changelog", "mi-perfil"],
    isAdmin: false
  }
};

// Alias para roles antiguos que ya no existen en el catálogo.
// Si Firestore aún tiene usuarios como "directivo" o "rrhh", se tratan como "interno"
// (sus permisos eran idénticos antes de la simplificación).
const LEGACY_ROLE_ALIASES = {
  directivo: "interno",
  rrhh: "interno"
};

// Rol por defecto si algo falla — el más restrictivo
const FALLBACK_ROLE = "agente";

// Lista para migración desde el esquema anterior:
// emails hardcodeados que ya eran admins en el código viejo.
// Cuando se lea el rol, si el email está aquí pero no tiene rol en Firestore,
// se le asigna admin automáticamente (una sola vez, hasta que guardes el doc).
const LEGACY_ADMIN_EMAILS = ["it@heroinsuranceusa.com"];


// ═══════════════════════════════════════════
// CARGA DEL ROL DEL USUARIO ACTUAL
// ═══════════════════════════════════════════

// Cache para no pedir el rol en cada página
let cachedRole = null;
let cachedEmail = null;

/**
 * Obtiene el rol de un usuario desde Firestore users/{email}.
 * Devuelve un objeto { role, definition } donde:
 *   - role: el string del rol ("admin", "agente", etc.)
 *   - definition: el objeto de ROLES con las páginas permitidas
 *
 * Devuelve null si:
 *   - el email no existe en users/ (ni como docId ni como alias en identity.emails[])
 *   - access.role es null (usuario sin rol asignado)
 *   - access.active es false (usuario desactivado)
 *
 * Los emails de LEGACY_ADMIN_EMAILS (it@) siempre obtienen admin —
 * backdoor para arranque/recovery si Firestore está mal.
 */
export async function loadUserRole(email) {
  if (!email) return null;
  const normalizedEmail = email.toLowerCase().trim();

  // Devolver cache si ya lo consultamos en esta sesión
  if (cachedEmail === normalizedEmail && cachedRole) return cachedRole;

  // Legacy: emails hardcodeados como admin siempre entran como admin
  if (LEGACY_ADMIN_EMAILS.includes(normalizedEmail)) {
    cachedEmail = normalizedEmail;
    cachedRole = { role: "admin", definition: ROLES.admin, trackAttendance: true };
    return cachedRole;
  }

  try {
    // getUserByEmail matchea docId Y aliases en identity.emails[]
    const person = await getUserByEmail(normalizedEmail);
    if (!person) return null;

    // Usuario existe pero está desactivado explícitamente
    if (person.access?.active === false) return null;

    let roleName = person.access?.role;
    if (!roleName) return null;

    // Migración de roles antiguos (directivo, rrhh → interno) por si
    // algún doc migrado hace tiempo aún tiene valores legacy
    if (LEGACY_ROLE_ALIASES[roleName]) {
      roleName = LEGACY_ROLE_ALIASES[roleName];
    }

    const definition = ROLES[roleName];
    // trackAttendance: opt-out por usuario. Default true — solo los docs con
    // access.trackAttendance === false quedan exentos de fichar (directiva, etc.).
    const trackAttendance = person.access?.trackAttendance !== false;
    if (!definition) {
      console.warn(`Rol desconocido "${roleName}" para ${email}. Usando fallback.`);
      cachedRole = { role: FALLBACK_ROLE, definition: ROLES[FALLBACK_ROLE], trackAttendance };
    } else {
      cachedRole = { role: roleName, definition, trackAttendance };
    }

    cachedEmail = normalizedEmail;
    return cachedRole;

  } catch (e) {
    console.error("Error cargando rol del usuario:", e);
    return null;
  }
}


// ═══════════════════════════════════════════
// FUNCIONES DE CONSULTA
// ═══════════════════════════════════════════

/**
 * ¿El usuario puede ver esta página?
 * @param {string} pageName - ej. "portales", "equipo", "admin"
 * @param {object} userRole - objeto devuelto por loadUserRole()
 */
export function canAccessPage(pageName, userRole) {
  if (!userRole || !userRole.definition) return false;
  return userRole.definition.pages.includes(pageName);
}

/**
 * ¿El usuario es admin?
 */
export function isAdmin(userRole) {
  return !!(userRole && userRole.definition && userRole.definition.isAdmin);
}

/**
 * Lista las páginas visibles para el usuario (para construir el topbar).
 */
export function getVisiblePages(userRole) {
  if (!userRole || !userRole.definition) return [];
  return userRole.definition.pages;
}

/**
 * Detecta en qué página estamos actualmente según la URL.
 * Ejemplo: si estamos en /portales.html → devuelve "portales"
 */
export function getCurrentPage() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  return path.replace('.html', '') || 'index';
}


// ═══════════════════════════════════════════
// GUARDIÁN DE PÁGINA
// ═══════════════════════════════════════════
// Función de alto nivel que cada página puede llamar al cargar:
// 1. Verifica que el usuario esté logueado
// 2. Carga su rol
// 3. Verifica que pueda ver la página actual
// 4. Si no puede: redirige a index.html o muestra mensaje
// 5. Si sí puede: devuelve { user, userRole } para que la página lo use

/**
 * Redirige al usuario a una página permitida si no puede ver la actual.
 */
function redirectToAllowedPage(userRole) {
  if (!userRole || !userRole.definition) {
    location.href = "index.html";
    return;
  }
  // Si puede ver index, ahí lo mandamos. Si no, a la primera página permitida.
  const pages = userRole.definition.pages;
  const destination = pages.includes("index") ? "index.html" : `${pages[0]}.html`;
  location.href = destination;
}

/**
 * Protege una página verificando que el usuario tenga permiso.
 * Debe llamarse DESPUÉS de que Firebase Auth confirmó el login.
 *
 * @param {object} user - el usuario de Firebase Auth
 * @returns {object|null} - { user, userRole } o null si no tiene acceso
 */
export async function guardPage(user) {
  const currentPage = getCurrentPage();

  // 1. Cargar el rol del usuario
  const userRole = await loadUserRole(user.email);

  // 2. Sin rol = sin acceso
  if (!userRole) {
    showAccessDenied(
      `La cuenta ${user.email} no tiene rol asignado en el Hero Hub. ` +
      `Contacta al administrador de IT.`
    );
    return null;
  }

  // 3. Verificar permiso para esta página específica
  if (!canAccessPage(currentPage, userRole)) {
    // En lugar de mostrar acceso denegado, redirigir silenciosamente
    // al dashboard (más amigable para el usuario)
    redirectToAllowedPage(userRole);
    return null;
  }

  // 4. Todo bien, devolver el contexto
  return { user, userRole };
}

/**
 * Muestra la pantalla de acceso denegado (reemplaza todo el body).
 */
function showAccessDenied(message) {
  document.body.innerHTML = `
    <div style="
      min-height: 100vh; display: flex; align-items: center;
      justify-content: center; padding: 20px;
      background: linear-gradient(135deg, #062a33 0%, #0a5c8a 100%);
      font-family: 'Inter', 'Trebuchet MS', Arial, sans-serif;
    ">
      <div style="
        background: #fff; border-radius: 20px; padding: 40px;
        max-width: 480px; text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      ">
        <div style="font-size: 64px; margin-bottom: 20px;">🚫</div>
        <h1 style="color: #1a2733; margin: 0 0 12px; font-size: 24px;">Acceso denegado</h1>
        <p style="color: #5a6b7a; margin: 0 0 24px; line-height: 1.5;">${message}</p>
        <button onclick="location.href='index.html'" style="
          background: #06a3b6; color: #fff; border: none;
          padding: 12px 24px; border-radius: 8px; cursor: pointer;
          font-size: 15px; font-family: inherit; font-weight: 600;
        ">Volver al inicio</button>
      </div>
    </div>
  `;
}


// ═══════════════════════════════════════════
// FILTRADO DEL TOPBAR
// ═══════════════════════════════════════════

/**
 * Oculta del topbar los enlaces a páginas que el usuario no puede ver.
 * Debe ejecutarse después de que Firebase y el rol estén cargados.
 *
 * Detecta los enlaces por su href (ej. "portales.html") y los oculta
 * si la página no está en la lista de permisos del usuario.
 */
export function filterTopbarByRole(userRole) {
  if (!userRole || !userRole.definition) return;

  const allowedPages = userRole.definition.pages;
  const topbar = document.getElementById("topbar-nav");
  if (!topbar) return;

  topbar.querySelectorAll(".nav-link").forEach(link => {
    const href = link.getAttribute("href") || "";
    const pageName = href.replace(".html", "").replace("./", "");

    if (pageName && !allowedPages.includes(pageName)) {
      link.style.display = "none";
    }
  });

  // Si todos los hijos de un .nav-group quedaron ocultos, ocultar también
  // el grupo (toggle "Operaciones" o "Recursos") para no dejar dropdowns vacíos.
  topbar.querySelectorAll(".nav-group").forEach(group => {
    const children = group.querySelectorAll(".nav-dropdown .nav-link");
    const visibleChildren = Array.from(children).filter(
      c => c.style.display !== "none"
    );
    if (children.length && !visibleChildren.length) {
      group.style.display = "none";
    }
  });

  // Botón de admin
  const adminBtn = document.getElementById("btn-admin");
  if (adminBtn) {
    adminBtn.style.display = isAdmin(userRole) ? "inline-flex" : "none";
  }
}


// ═══════════════════════════════════════════
// UTILIDAD: limpiar cache al cerrar sesión
// ═══════════════════════════════════════════

export function clearRoleCache() {
  cachedRole = null;
  cachedEmail = null;
  try { localStorage.removeItem("hero-user-role"); } catch (_) {}
}
