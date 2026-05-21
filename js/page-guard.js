// ═══════════════════════════════════════════
// Hero Hub · Guardia de Páginas
// ═══════════════════════════════════════════
// Este módulo se importa desde las páginas que NO son index.html
// (carriers, directorio, guias, politicas, onboarding, equipo, admin).
//
// Hace tres cosas:
//   1. Verifica que el usuario esté logueado (si no, redirige a index)
//   2. Carga el rol del usuario y verifica que pueda ver esta página
//   3. Si no puede, redirige silenciosamente a index.html
//   4. Filtra el topbar para ocultar enlaces a páginas no permitidas
//
// También expone `getPageContext()` para que el script específico de
// cada página pueda obtener el rol del usuario si lo necesita.
//
// USO desde el HTML:
//   <script type="module" src="js/page-guard.js"></script>
// Y debe cargarse ANTES de los scripts específicos de la página.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { loadUserRole, canAccessPage, filterTopbarByRole, getCurrentPage, isAdmin as isAdminRole } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

// Exponemos el contexto en window para que otros scripts lo puedan usar
window.HeroHubContext = {
  user: null,
  userRole: null,
  isReady: false,
  readyPromise: null
};

// Promesa que se resuelve cuando el contexto está listo
window.HeroHubContext.readyPromise = new Promise((resolve) => {
  window._resolveHubContext = resolve;
});

onAuthStateChanged(auth, async (user) => {
  // 1. Sin usuario → redirigir a index para hacer login
  if (!user) {
    location.href = "index.html";
    return;
  }

  // 2. Dominio incorrecto → cerrar sesión y volver a index
  if (!user.email.endsWith("@heroinsuranceusa.com")) {
    location.href = "index.html";
    return;
  }

  // 3. Cargar el rol del usuario
  const userRole = await loadUserRole(user.email);
  if (!userRole) {
    // Sin rol asignado → redirigir a index donde auth.js mostrará el mensaje.
    // Await el log para garantizar persistencia antes del redirect.
    await logEvent(ACTIONS.AUTH_DENIED_NO_ROLE, user.email, {
      page: getCurrentPage()
    });
    location.href = "index.html";
    return;
  }

  // 4. Verificar que el usuario pueda ver esta página
  const currentPage = getCurrentPage();
  if (!canAccessPage(currentPage, userRole)) {
    // Acceso denegado → redirigir silenciosamente al inicio.
    // Await el log para garantizar persistencia antes del redirect.
    await logEvent(ACTIONS.AUTH_DENIED_PAGE, user.email, {
      page: currentPage,
      role: userRole.role
    });
    location.href = "index.html";
    return;
  }

  // 5. Guardar el contexto globalmente
  window.HeroHubContext.user = user;
  window.HeroHubContext.userRole = userRole;
  window.HeroHubContext.isReady = true;

  // 6. Filtrar el topbar (oculta links a páginas no permitidas)
  filterTopbarByRole(userRole);

  // 7. Resolver la promesa para que otros scripts puedan continuar
  window._resolveHubContext({ user, userRole });
});

// Función auxiliar para que los scripts de cada página obtengan el contexto
window.getPageContext = async function() {
  if (window.HeroHubContext.isReady) return window.HeroHubContext;
  return window.HeroHubContext.readyPromise.then(() => window.HeroHubContext);
};
