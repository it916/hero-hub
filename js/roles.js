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
// CATÁLOGO DE PÁGINAS Y FEATURES
// ═══════════════════════════════════════════
// Estas dos listas son CÓDIGO, no configuración: describen qué existe en el
// Hub. Lo que se configura desde admin.html → Permisos es qué rol tiene cada
// cosa, no qué cosas hay. Al agregar una página o una feature nueva, hay que
// declararla aquí para que aparezca en la matriz.

export const PAGE_LABELS = {
  index: "Inicio",
  equipo: "Equipo",
  portales: "Portales",
  agencias: "Agencias",
  directorio: "Directorio",
  guias: "Guías",
  politicas: "Políticas",
  onboarding: "Onboarding",
  reuniones: "Reuniones",
  grabaciones: "Grabaciones",
  contracting: "Contracting",
  "solicitud-cuenta": "Solicitud de cuenta",
  changelog: "Changelog",
  "mi-perfil": "Mi perfil",
  finanzas: "Finanzas",
  "finanzas-manual": "Manual de Finanzas",
  "it-console": "IT Console",
  admin: "Admin"
};

// Páginas que nadie puede perder: sin index no hay a dónde redirigir y sin
// mi-perfil el menú del avatar queda roto. La UI las muestra bloqueadas.
export const PAGINAS_OBLIGATORIAS = ["index", "mi-perfil"];

export const FEATURES = {
  "hqcc-tiles":       { group: "Dashboard",           label: "Tiles del banner (Oficina · Asistencia · CRMs)" },
  "dashboard-social": { group: "Dashboard",           label: "Misiones, Celebraciones y Mensajes" },
  "tile-database":    { group: "Accesos rápidos",     label: "Base de Datos" },
  "tile-finanzas":    { group: "Accesos rápidos",     label: "Finanzas", nota: "El módulo está en retirada" },
  "tile-it-console":  { group: "Accesos rápidos",     label: "IT Console" },
  "tile-correos":     { group: "Accesos rápidos",     label: "Correos", nota: "Requiere también la página Solicitud de cuenta" },
  "tile-calendario":  { group: "Accesos rápidos",     label: "Calendario" },
  "portales-team":    { group: "Permisos de edición", label: "Portales · pestaña Cuentas del Equipo" },
  "portales-delete":  { group: "Permisos de edición", label: "Portales · eliminar carriers del equipo" },
  "agencias-edit":    { group: "Permisos de edición", label: "Agencias · editar", nota: "Inerte mientras las agencias se lean del Google Sheet" },
  "admin-migracion":  { group: "Permisos de edición", label: "Admin · tabs de migración de datos" }
};

const TODAS_LAS_PAGINAS  = Object.keys(PAGE_LABELS);
const TODAS_LAS_FEATURES = Object.keys(FEATURES);


// ═══════════════════════════════════════════
// DEFINICIÓN DE ROLES (valores por defecto)
// ═══════════════════════════════════════════
// Es el catálogo de respaldo. Si shared/rolePermissions existe y es válido,
// sus pages/features tienen prioridad; si falla la lectura, si el doc no
// existe o si viene corrupto, se usa esto y nadie se queda fuera del Hub.
//
// Las CLAVES de los roles no son editables desde la UI — no se pueden crear
// ni borrar roles, solo cambiar qué ve cada uno.

export const DEFAULT_ROLES = {
  admin: {
    label: "Administrador",
    pages: TODAS_LAS_PAGINAS,
    features: TODAS_LAS_FEATURES,
    isAdmin: true
  },
  interno: {
    label: "Equipo interno",
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "onboarding", "grabaciones", "reuniones", "changelog", "mi-perfil", "contracting", "solicitud-cuenta"],
    features: ["hqcc-tiles", "dashboard-social", "tile-database", "tile-correos", "tile-calendario", "portales-team"],
    isAdmin: false
  },
  // El rol "finanzas" se retiró al descontinuarse el módulo de Finanzas
  // (2026-08-20). Sus dos titulares — financesupport@ y samortiz@ — pasaron
  // a "interno". El alias de LEGACY_ROLE_ALIASES cubre cualquier doc que
  // todavía diga "finanzas": sin él caerían en FALLBACK_ROLE, que es
  // "agente", y perderían medio Hub.
  // Las páginas finanzas / finanzas-manual siguen en el rol "admin" para
  // poder exportar los datos antes de apagar las colecciones.
  it: {
    label: "IT",
    // Misma visibilidad que "interno" + la IT Console. Sin acceso a admin.
    // it@ está en LEGACY_ADMIN_EMAILS y entra como admin — este rol es para
    // futuros asistentes de IT o cuentas de servicio que necesiten la consola.
    pages: ["index", "equipo", "agencias", "portales", "directorio", "guias", "politicas", "reuniones", "changelog", "it-console", "mi-perfil", "contracting", "solicitud-cuenta"],
    features: ["hqcc-tiles", "dashboard-social", "tile-database", "tile-correos", "tile-calendario", "tile-it-console", "portales-team", "portales-delete", "admin-migracion"],
    isAdmin: false
  },
  agente: {
    label: "Agente",
    // Acceso restringido: solo Inicio, Equipo, Portales, Grabaciones y Changelog.
    // Los agentes NO pueden solicitar altas/bajas de cuentas — es tarea de líderes.
    // En portales.js sigue habiendo lógica que muestra al agente solo su sección personal.
    pages: ["index", "equipo", "portales", "grabaciones", "changelog", "mi-perfil"],
    features: ["tile-calendario"],
    isAdmin: false
  }
};

// Alias histórico: media docena de módulos importan { ROLES } para leer las
// claves y los labels. Se mantiene apuntando al catálogo por defecto porque
// esos dos datos no son configurables desde la UI.
export const ROLES = DEFAULT_ROLES;


// ═══════════════════════════════════════════
// CATÁLOGO REMOTO — shared/rolePermissions
// ═══════════════════════════════════════════
// Lo edita admin.html → Permisos. Se cachea en localStorage para que la
// siguiente carga resuelva sin esperar a Firestore (y para que el script
// inline del <head> pueda pre-aplicar las clases sin flash).
//
// Regla de oro: ante cualquier duda sobre la validez del doc remoto, se cae
// al catálogo por defecto. Un doc corrupto no puede dejar a nadie fuera.

const CATALOGO_CACHE_KEY = "hero-roles-catalog";

let catalogoRemoto = null;     // objeto ya validado, o null si no hay
let catalogoPromesa = null;    // evita lecturas duplicadas en paralelo

function leerCatalogoCacheado() {
  try {
    const raw = localStorage.getItem(CATALOGO_CACHE_KEY);
    if (!raw) return null;
    return validarCatalogo(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

/**
 * Deja pasar solo lo que tiene sentido: roles conocidos, páginas y features
 * que existen en el código, y el rol admin siempre con todo.
 * Devuelve null si el objeto entero es inservible.
 */
function validarCatalogo(datos) {
  if (!datos || typeof datos !== "object") return null;

  const limpio = {};
  for (const nombre of Object.keys(DEFAULT_ROLES)) {
    const base = DEFAULT_ROLES[nombre];

    // El rol admin no es configurable: siempre ve todo.
    if (base.isAdmin) {
      limpio[nombre] = { pages: TODAS_LAS_PAGINAS, features: TODAS_LAS_FEATURES };
      continue;
    }

    const remoto = datos[nombre];
    if (!remoto || !Array.isArray(remoto.pages)) {
      limpio[nombre] = { pages: base.pages, features: base.features };
      continue;
    }

    // Se descartan las páginas y features que ya no existen en el código
    // (por ejemplo si se elimina un módulo y el doc quedó desactualizado).
    const pages = remoto.pages.filter(p => TODAS_LAS_PAGINAS.includes(p));
    const features = Array.isArray(remoto.features)
      ? remoto.features.filter(f => TODAS_LAS_FEATURES.includes(f))
      : base.features;

    // Las obligatorias se reponen aunque el doc diga lo contrario.
    for (const obligatoria of PAGINAS_OBLIGATORIAS) {
      if (!pages.includes(obligatoria)) pages.push(obligatoria);
    }

    limpio[nombre] = { pages, features };
  }
  return limpio;
}

/**
 * Lee shared/rolePermissions. Devuelve el catálogo validado o null.
 * No lanza: si falla, el Hub sigue con los valores por defecto.
 */
export async function loadRolesCatalog({ force = false } = {}) {
  if (catalogoRemoto && !force) return catalogoRemoto;
  if (catalogoPromesa) return catalogoPromesa;

  catalogoPromesa = (async () => {
    try {
      const { db } = await import("./firebase-config.js");
      const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const snap = await getDoc(doc(db, "shared", "rolePermissions"));
      if (!snap.exists()) return null;

      const validado = validarCatalogo(snap.data().roles);
      if (!validado) return null;

      catalogoRemoto = validado;
      try { localStorage.setItem(CATALOGO_CACHE_KEY, JSON.stringify(validado)); } catch (_) {}
      return validado;
    } catch (e) {
      console.warn("No se pudo leer shared/rolePermissions:", e.message);
      return null;
    } finally {
      catalogoPromesa = null;
    }
  })();

  return catalogoPromesa;
}

/**
 * Definición efectiva de un rol: el default con las pages/features del
 * catálogo remoto encima, si lo hay. label e isAdmin nunca vienen de Firestore.
 */
function definicionEfectiva(nombreRol) {
  const base = DEFAULT_ROLES[nombreRol];
  if (!base) return null;

  const catalogo = catalogoRemoto || leerCatalogoCacheado();
  const remoto = catalogo && catalogo[nombreRol];
  if (!remoto) return base;

  return { ...base, pages: remoto.pages, features: remoto.features };
}

// Alias para roles antiguos que ya no existen en el catálogo.
// Si Firestore aún tiene usuarios como "directivo" o "rrhh", se tratan como "interno"
// (sus permisos eran idénticos antes de la simplificación).
const LEGACY_ROLE_ALIASES = {
  directivo: "interno",
  rrhh: "interno",
  finanzas: "interno"   // retirado el 2026-08-20 al descontinuarse el módulo
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

  // Catálogo de permisos: si ya hay una copia en localStorage se usa de
  // inmediato y el refresco viaja en segundo plano (no añade latencia a la
  // carga de la página). La primera vez sí se espera.
  if (leerCatalogoCacheado()) {
    loadRolesCatalog();
  } else {
    await loadRolesCatalog();
  }

  // Legacy: emails hardcodeados como admin siempre entran como admin
  if (LEGACY_ADMIN_EMAILS.includes(normalizedEmail)) {
    cachedEmail = normalizedEmail;
    cachedRole = { role: "admin", definition: DEFAULT_ROLES.admin, trackAttendance: true };
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

    const definition = definicionEfectiva(roleName);
    // trackAttendance: opt-out por usuario. Default true — solo los docs con
    // access.trackAttendance === false quedan exentos de fichar (directiva, etc.).
    const trackAttendance = person.access?.trackAttendance !== false;
    if (!definition) {
      console.warn(`Rol desconocido "${roleName}" para ${email}. Usando fallback.`);
      cachedRole = { role: FALLBACK_ROLE, definition: definicionEfectiva(FALLBACK_ROLE), trackAttendance };
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
 * ¿El usuario tiene habilitada esta feature?
 * @param {object} userRole - objeto devuelto por loadUserRole()
 * @param {string} feature - clave de FEATURES, ej. "portales-team"
 */
export function hasFeature(userRole, feature) {
  const lista = userRole && userRole.definition && userRole.definition.features;
  if (!Array.isArray(lista)) return false;
  return lista.includes(feature);
}

/**
 * Marca el <body> con el rol y las features del usuario, y deja ambos en
 * localStorage para que la próxima carga los pre-aplique sin flash.
 *
 * Reemplaza al bloque que cada bootstrap repetía a mano (auth.js,
 * mi-perfil.js, solicitud-cuenta.js…). Debe llamarse ANTES de mostrar el
 * dashboard, no después.
 */
export function applyRoleClasses(userRole) {
  if (!userRole || !userRole.definition) return;
  const body = document.body;

  // Rol: se limpian los anteriores por si la clase quedó de una sesión previa
  for (const nombre of Object.keys(DEFAULT_ROLES)) body.classList.remove(`role-${nombre}`);
  body.classList.add(`role-${userRole.role}`);

  // Features
  for (const clave of Object.keys(FEATURES)) body.classList.remove(`feat-${clave}`);
  const features = Array.isArray(userRole.definition.features) ? userRole.definition.features : [];
  for (const clave of features) body.classList.add(`feat-${clave}`);

  // Opt-out de asistencia — es por usuario, no por rol (access.trackAttendance)
  if (userRole.trackAttendance === false) {
    body.classList.add("no-attendance");
    try { localStorage.setItem("hero-user-no-attendance", "1"); } catch (_) {}
  } else {
    body.classList.remove("no-attendance");
    try { localStorage.removeItem("hero-user-no-attendance"); } catch (_) {}
  }

  try {
    localStorage.setItem("hero-user-role", userRole.role);
    localStorage.setItem("hero-user-features", features.join(" "));
  } catch (_) {}
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
// AUDIENCIAS (changelog y anuncios internos)
// ═══════════════════════════════════════════
// Roles que cuentan como "equipo interno" para las entradas con
// audience: "team". Es todo el personal de la empresa menos "agente",
// que es externo y solo debe ver novedades de audiencia "all".
export const TEAM_ROLES = ["admin", "interno", "it"];

/**
 * ¿Un contenido con esta audiencia es visible para este rol?
 * @param {string} audience - "all" (o vacío) | "team" | "admin"
 * @param {string} role - clave del rol ("admin", "interno", "it", "agente")
 */
export function canSeeAudience(audience, role) {
  const a = audience || "all";
  if (a === "admin") return role === "admin";
  if (a === "team") return TEAM_ROLES.includes(role);
  return true; // "all" y cualquier valor desconocido → visible
}


// ═══════════════════════════════════════════
// UTILIDAD: limpiar cache al cerrar sesión
// ═══════════════════════════════════════════

export function clearRoleCache() {
  cachedRole = null;
  cachedEmail = null;
  try {
    localStorage.removeItem("hero-user-role");
    localStorage.removeItem("hero-user-features");
  } catch (_) {}
  // El catálogo de permisos NO se limpia: no es del usuario, es del Hub, y
  // conservarlo evita que el próximo login espere a Firestore.
}
