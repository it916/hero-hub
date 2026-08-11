const atSign = '@';

// ── Bootstrap desde Hero Hub ──────────────────────────────────
// La consola vive como página gated del Hero Hub. El Hub ya autenticó al
// usuario con Firebase; nosotros solo intercambiamos su Firebase ID token
// por un HERO_TOKEN via POST /auth/hub-login (whitelist IT_EMAILS del Worker).
// El resto del flujo (authFetch, HERO_TOKEN en sessionStorage) queda intacto.
async function bootstrapFromHub() {
  try {
    // firebase-config.js ejecuta initializeApp al importarse; getAuth requiere
    // eso para no tirar "no default app". Import path absoluto porque estamos
    // en un <script> clásico y los relativos resuelven contra la URL de la página.
    await import('/js/firebase-config.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const user = await waitForFirebaseUser(getAuth(), 5000);
    if (!user) { redirectToHub('No se detectó sesión de Firebase'); return false; }
    const idToken = await user.getIdToken();
    const resp = await fetch(WORKER_URL + '/auth/hub-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const data = await resp.json();
    if (!resp.ok || !data.token) {
      redirectToHub('No se pudo intercambiar el token: ' + (data.error || resp.status));
      return false;
    }
    HERO_TOKEN = data.token;
    const nombre  = data.nombre || user.displayName || user.email;
    const email   = data.email  || user.email;
    const picture = user.photoURL || '';
    sessionStorage.setItem('hero_token', data.token);
    sessionStorage.setItem('hero_auth', JSON.stringify({ email, nombre, picture, ts: Date.now() }));
    showApp(nombre, picture);
    return true;
  } catch (err) {
    redirectToHub('Error al iniciar sesión: ' + (err && err.message ? err.message : err));
    return false;
  }
}

// La firebase-auth SDK se importa lazy; puede que currentUser aún no esté listo
// cuando llamamos a bootstrap. Sondeamos cada 100ms hasta timeoutMs.
function waitForFirebaseUser(auth, timeoutMs) {
  return new Promise((resolve) => {
    if (auth.currentUser) return resolve(auth.currentUser);
    const start = Date.now();
    const iv = setInterval(() => {
      if (auth.currentUser) { clearInterval(iv); resolve(auth.currentUser); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(null); }
    }, 100);
  });
}

function redirectToHub(msg) {
  console.warn('[it-console]', msg);
  window.location.href = '/index.html';
}

function showApp(nombre, picture) {
  const appEl = document.getElementById('app-content');
  appEl.style.display = 'flex';
  appEl.style.width = '100%';
  appEl.style.minHeight = '100vh';
  appEl.style.flexDirection = 'row';
  const userLabel = document.querySelector('.user-label');
  if (userLabel) userLabel.textContent = nombre + ' · IT Admin';
  addLog('Sesión iniciada como ' + nombre, 'success');
  applyStoredTheme();
  loadHome();
  checkSystemStatus();
}

function checkExistingSession() {
  try {
    const stored = sessionStorage.getItem('hero_auth');
    const token  = sessionStorage.getItem('hero_token');
    if (!stored || !token) return false;
    const { email, nombre, picture, ts } = JSON.parse(stored);
    // Session valid for 8 hours
    if (Date.now() - ts > 8 * 60 * 60 * 1000) {
      sessionStorage.removeItem('hero_auth');
      sessionStorage.removeItem('hero_token');
      return false;
    }
    HERO_TOKEN = token;
    showApp(nombre, picture);
    return true;
  } catch(e) { return false; }
}

// ── Tema claro / oscuro ──────────────────────────────────────
// Integrado con el Hero Hub: setea data-theme sobre <body> (no <html>) y
// comparte la key "hero-theme" de localStorage con el resto del Hub para
// que al volver al dashboard el tema quede sincronizado.
function toggleTheme() {
  const body = document.body;
  const isDark = body.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  body.setAttribute('data-theme', newTheme);
  localStorage.setItem('hero-theme', newTheme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = '<iconify-icon icon="tabler:' + (newTheme === 'dark' ? 'moon' : 'sun') + '"></iconify-icon>';
  // Sincronizar el select en Configuración si está montado.
  const pref = document.getElementById('cfg-pref-theme');
  if (pref) pref.value = newTheme;
}

function applyStoredTheme() {
  const stored = localStorage.getItem('hero-theme') || 'light';
  document.body.setAttribute('data-theme', stored);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = '<iconify-icon icon="tabler:' + (stored === 'dark' ? 'moon' : 'sun') + '"></iconify-icon>';
}

// ── Logs globales ─────────────────────────────────────────────
const sessionLogs = [];
let sessionActionCount = 0;

// ── Navegación ────────────────────────────────────────────────
const pageLabels = {
  'dashboard': 'Home',
  'reset': 'Reset de Contraseña',
  'usuarios': 'Usuarios Workspace',
  'logs': 'Historial de Logs',
  'config': 'Configuración',
  'solicitudes': 'Solicitudes',
  'tickets': 'Soporte · Tickets',
  'auditoria': 'Auditoría',
  'crear-usuario': 'Crear Usuario',
  'onboarding': 'Enviar Onboarding',
  'toolbox': 'Soporte · Toolbox',
  'dispositivos': 'Soporte · Dispositivos',
  'plantillas': 'Plantillas de email'
};

// Las 3 sub-páginas del módulo Soporte comparten una sola entrada del sidebar
// (la de Tickets, que es el tab default). Cuando navegamos a cualquiera de ellas
// queremos que ese nav-item quede resaltado.
const SOPORTE_TABS = ['tickets', 'toolbox', 'dispositivos'];

// ── Sidebar móvil ─────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  } else {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

function showPage(id) {
  // Back-compat: 'mi-dia' se fusionó dentro de 'dashboard' (Home).
  if (id === 'mi-dia') id = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  // Para resaltar el sidebar: las 4 sub-páginas de Soporte mapean al item 'tickets'.
  const sidebarId = SOPORTE_TABS.includes(id) ? 'tickets' : id;
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + sidebarId + "'")) {
      n.classList.add('active');
    }
  });
  document.getElementById('current-section-label').textContent = pageLabels[id] || id;

  // Cerrar sidebar en móvil al navegar
  closeSidebar();

  // Auto-cargar datos al navegar
  const autoLoad = {
    'dashboard':    () => loadHome(),
    'usuarios':     () => loadUsers(),
    'tickets':      () => loadTickets(),
    'solicitudes':  () => loadSolicitudes(),
    'auditoria':    () => loadAudit(),
    'dispositivos': () => loadDevices(),
    'offboarding':  () => { if (!window._workspaceUsers) loadUsers(); renderOffboardingSteps(); _consumePreselectedUser('offboarding'); },
    'onboarding':   () => _consumePreselectedUser('onboarding'),
    'reset':        () => _consumePreselectedUser('reset'),
    'toolbox':      () => loadToolbox(),
    'logs':         () => renderSessionLogs(),
    'config':       () => loadConfig(),
    'plantillas':   () => loadPlantillas(),
    'crear-usuario': () => initCrearUsuario(),
  };
  if (autoLoad[id]) autoLoad[id]();

  return false;
}

// ── Reloj ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const opts = { timeZone: 'America/New_York', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit' };
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('es-MX', opts) + ' ET';
}
let _clockInterval = setInterval(updateClock, 1000);
updateClock();

// ── Worker URL ────────────────────────────────────────────────
const WORKER_URL = 'https://hero-email-worker.broad-fire-d2d6.workers.dev';

// ── Pase de sesión + fetch autenticado ───────────────────────
// El pase lo emite el Worker al intercambiar el Firebase ID token del Hub
// (ver bootstrapFromHub) y se reenvía en cada llamada de administración.
// authFetch lo adjunta solo.
let HERO_TOKEN = sessionStorage.getItem('hero_token') || null;

async function authFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (HERO_TOKEN) headers['Authorization'] = 'Bearer ' + HERO_TOKEN;
  const resp = await fetch(url, Object.assign({}, opts, { headers }));
  if (resp.status === 401) {
    handleAuthExpired();
  } else if (resp.status >= 500) {
    // 5xx implica fallo del Worker — antes se ignoraban silenciosamente.
    // No mostramos toast en cada poll para no spamear; solo addLog que queda
    // visible en el panel Logs si Fernando entra a investigar.
    addLog('Worker ' + resp.status + ' en ' + (typeof url === 'string' ? url.replace(WORKER_URL, '') : '?'), 'warn');
  }
  return resp;
}

// Si el Worker rechaza el pase (expiró o es inválido), renovamos usando el
// Firebase ID token del Hub (la sesión de Firebase suele durar más que el
// HERO_TOKEN de 8h). Si el bootstrap falla, redirige al Hub para re-loguear.
async function handleAuthExpired() {
  if (!HERO_TOKEN) return;
  HERO_TOKEN = null;
  sessionStorage.removeItem('hero_token');
  sessionStorage.removeItem('hero_auth');
  try { showToast('Renovando sesión...'); } catch (_) {}
  await bootstrapFromHub();
}

// ── Panel de estado del ecosistema ───────────────────────────
async function checkSystemStatus() {
  const btn = document.getElementById('btn-check-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }

  const setStatus = (svc, state, detail) => {
    const dot = document.getElementById('dot-' + svc);
    const det = document.getElementById('detail-' + svc);
    if (dot) { dot.className = 'status-dot ' + state; }
    if (det) { det.textContent = detail; }
  };

  // Mark all as loading
  ['worker','google','zoho','resend'].forEach(s => setStatus(s, 'loading', 'Verificando...'));

  // 1. Worker ping
  try {
    const t0 = Date.now();
    const r = await authFetch(WORKER_URL + '/audit?limit=1');
    if (r.ok) setStatus('worker', 'ok', 'Online · ' + (Date.now()-t0) + 'ms');
    else setStatus('worker', 'error', 'Error ' + r.status);
  } catch { setStatus('worker', 'error', 'Sin respuesta'); }

  // 2. Google Workspace
  try {
    const t0 = Date.now();
    const r = await authFetch(WORKER_URL + '/users');
    const d = await r.json();
    if (r.ok && d.users) setStatus('google', 'ok', d.users.length + ' usuarios · ' + (Date.now()-t0) + 'ms');
    else setStatus('google', 'error', d.error || 'Error');
  } catch { setStatus('google', 'error', 'Sin respuesta'); }

  // 3. Zoho Assist
  try {
    const t0 = Date.now();
    const r = await authFetch(WORKER_URL + '/zoho/devices');
    const d = await r.json();
    if (r.ok) setStatus('zoho', 'ok', d.devices.length + ' dispositivos · ' + (Date.now()-t0) + 'ms');
    else setStatus('zoho', 'error', d.error || 'Error');
  } catch { setStatus('zoho', 'error', 'Sin respuesta'); }

  // 4. Resend — test via Worker general email endpoint availability
  try {
    // We just check that worker responds to POST /  without crashing
    const r = await authFetch(WORKER_URL + '/ticket?limit=1');
    if (r.ok) setStatus('resend', 'ok', 'Activo vía Worker');
    else setStatus('resend', 'error', 'Error ' + r.status);
  } catch { setStatus('resend', 'error', 'Sin respuesta'); }

  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Verificar'; }
  addLog('Verificación de estado completada', 'info');
}


// ── Búsqueda global ───────────────────────────────────────────
let searchDebounce = null;

function openGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('global-search-input').focus(), 50);
}
function closeGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'none';
  document.getElementById('global-search-input').value = '';
  document.getElementById('global-search-results').innerHTML = '';
}
function onGlobalSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runGlobalSearch, 300);
}
async function runGlobalSearch() {
  const q = document.getElementById('global-search-input').value.trim().toLowerCase();
  const results = document.getElementById('global-search-results');
  if (q.length < 2) { results.innerHTML = ''; return; }
  results.innerHTML = '<div style="text-align:center;padding:20px;"><l-line-spinner size="24" stroke="2" speed="1" color="#06a3b6"></l-line-spinner></div>';
  const found = [];
  try {
    const r = await authFetch(WORKER_URL + '/ticket');
    if (r.ok) {
      const d = await r.json();
      (d.tickets || []).forEach(t => {
        if ((t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q) || (t.descripcion||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:ticket"></iconify-icon> Ticket', title: t.ticketId + ' — ' + t.asunto, sub: t.nombre + ' · ' + t.estado, action: "showPage('tickets')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/alta-agente');
    if (r.ok) {
      const d = await r.json();
      (d.solicitudes || []).forEach(s => {
        if ((s.nombre||'').toLowerCase().includes(q) || (s.apellido||'').toLowerCase().includes(q) || (s.correo||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:inbox"></iconify-icon> Solicitud', title: s.nombre + ' ' + s.apellido, sub: s.correo + ' · ' + s.estado, action: "showPage('solicitudes')" });
      });
    }
  } catch {}
  try {
    const r = await authFetch(WORKER_URL + '/device');
    if (r.ok) {
      const d = await r.json();
      (d.devices || []).forEach(dev => {
        if ((dev.nombre||'').toLowerCase().includes(q) || (dev.usuario||'').toLowerCase().includes(q))
          found.push({ type:'<iconify-icon icon="tabler:device-desktop"></iconify-icon> Dispositivo', title: dev.nombre, sub: (dev.usuario||'Sin usuario') + ' · ' + dev.estado, action: "showPage('dispositivos')" });
      });
    }
  } catch {}
  if (window._workspaceUsers) {
    window._workspaceUsers.forEach(u => {
      if ((u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
        found.push({ type:'<iconify-icon icon="tabler:user"></iconify-icon> Usuario', title: u.nombre, sub: u.email + ' · ' + u.estado, action: "showPage('usuarios')" });
    });
  }
  // Auditoría — buscar en descripción/detalle de entradas recientes
  if (typeof allAuditEntradas !== 'undefined' && Array.isArray(allAuditEntradas)) {
    allAuditEntradas.slice(0, 200).forEach(e => {
      const blob = ((e.descripcion||'') + ' ' + (e.detalle||'')).toLowerCase();
      if (blob.includes(q))
        found.push({ type:'<iconify-icon icon="tabler:files"></iconify-icon> Auditoría', title: e.descripcion || '(sin descripción)', sub: (e.tipo || '') + ' · ' + (e.usuario || ''), action: "showPage('auditoria')" });
    });
  }
  // Toolbox — busca en título, contenido y tags
  if (typeof allToolbox !== 'undefined' && Array.isArray(allToolbox)) {
    allToolbox.forEach(a => {
      const blob = (a.titulo + ' ' + (a.contenido || '') + ' ' + (a.tags || []).join(' ')).toLowerCase();
      if (blob.includes(q))
        found.push({ type:'<iconify-icon icon="tabler:tools"></iconify-icon> Toolbox', title: a.titulo, sub: (a.tags || []).slice(0, 3).join(', ') || 'sin tags', action: "showPage('toolbox')" });
    });
  }
  if (!found.length) {
    results.innerHTML = '<div style="text-align:center;padding:24px;color:var(--hero-text-muted);font-size:13px;">Sin resultados para "' + escHtml(q) + '"</div>';
    return;
  }
  results.innerHTML = found.map(f =>
    '<div onclick="' + f.action + ';closeGlobalSearch()" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--hero-border);transition:background 0.15s;" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'"> '
    + '<span style="font-size:11px;padding:2px 8px;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:20px;color:var(--hero-text-muted);white-space:nowrap;flex-shrink:0;">' + f.type + '</span>'
    + '<div><div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(f.title) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + escHtml(f.sub) + '</div></div></div>'
  ).join('');
}

async function auditLog(tipo, descripcion, detalle = null) {
  try {
    // Toma el nombre real del usuario logueado en lugar de hardcodear "Fernando
    // Romero" — si en algún momento entra otra persona, queda registrado bien.
    let usuario = 'Sistema';
    try {
      const auth = JSON.parse(sessionStorage.getItem('hero_auth') || '{}');
      if (auth.nombre) usuario = auth.nombre;
    } catch (_) {}
    await authFetch(WORKER_URL + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, descripcion, detalle, usuario })
    });
  } catch(e) { addLog('auditLog error: ' + e.message, 'warn'); }
}
async function sendViaResend({ to, subject, html, text }) {
  const resp = await authFetch(WORKER_URL + '/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html, text })
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || result.error || 'Error del Worker');
  return result;
}

// Variante para el email de onboarding del empleado nuevo — apunta al
// endpoint /email/onboarding del Worker, que acepta destinos externos
// (@gmail, @yahoo, etc.) por diseño. El endpoint /email genérico restringe
// el destino a @heroinsuranceusa para evitar envíos accidentales.
// `from` opcional (el Worker fuerza que sea @heroinsuranceusa.com igual);
// útil cuando el mensaje debe firmarse como equipo, no como Fernando.
async function sendOnboardingViaResend({ to, subject, html, text, from }) {
  const payload = { to, subject, html, text };
  if (from) payload.from = from;
  const resp = await authFetch(WORKER_URL + '/email/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || result.error || 'Error del Worker');
  return result;
}

// ── Log helper ────────────────────────────────────────────────
const SESSION_LOGS_MAX = 500;
function addLog(message, type = 'info', consoleId = null) {
  const now = new Date();
  const t = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  sessionLogs.push({ time: t, message, type });
  // Cap a últimos 500 — sin esto, una sesión larga acumula sin fin y deja
  // pesado el panel Logs cuando se renderiza por completo.
  if (sessionLogs.length > SESSION_LOGS_MAX) sessionLogs.splice(0, sessionLogs.length - SESSION_LOGS_MAX);
  sessionActionCount++;
  const line = `<div class="log-line"><span class="log-time">${t}</span><span class="log-msg ${type}">${escHtml(message)}</span></div>`;
  const fullLog = document.getElementById('log-full');
  if (fullLog) {
    const empty = fullLog.querySelector('.log-empty');
    if (empty) empty.remove();
    fullLog.insertAdjacentHTML('beforeend', line);
    fullLog.scrollTop = fullLog.scrollHeight;
  }
  if (consoleId) {
    const specific = document.getElementById(consoleId);
    if (specific) {
      if (specific.querySelector('.log-empty')) specific.innerHTML = '';
      specific.insertAdjacentHTML('beforeend', line);
      specific.scrollTop = specific.scrollHeight;
    }
  }
}

// ── Escape HTML ───────────────────────────────────────────────
// Para insertar de forma segura texto con innerHTML. Los formularios públicos
// (tickets y solicitudes) son la fuente principal de datos no confiables.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Para valores que se interpolan dentro de un atributo HTML que contiene
// una cadena JS, ej: onclick="fn('${escJs(s)}')". Combina escape JS (\, ',
// newlines) con escape de atributo HTML (&, ", <, >). escHtml por sí solo
// NO es seguro acá porque el HTML decodifica antes que JS parsee — un valor
// con apóstrofe terminaría la cadena JS y permitiría inyección.
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// ── Toast (con cola) ──────────────────────────────────────────
// Antes showToast sobreescribía el mensaje anterior si llegaban dos en sucesión.
// Ahora encolamos: el segundo espera a que el primero termine (3.2s) y luego
// se muestra. La cola se vacía sola.
const _toastQueue = [];
let _toastShowing = false;
function showToast(msg) {
  _toastQueue.push(String(msg == null ? '' : msg));
  if (!_toastShowing) _drainToast();
}
function _drainToast() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const t = document.getElementById('toast');
  const msg = _toastQueue.shift();
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    // Pequeño gap entre toasts para que el cambio sea visible
    setTimeout(_drainToast, 200);
  }, 3200);
}

// ── Persistencia de preferencias UI (filtros, vistas) ─────────
// localStorage es sincrónico y barato; un try/catch cubre el caso de modo
// privado o cuota llena (raro en SPA tan pequeña pero no rompe la app).
function persistState(key, value) {
  try { localStorage.setItem('hero_' + key, JSON.stringify(value)); } catch (_) {}
}
function restoreState(key, defaultValue) {
  try {
    const v = localStorage.getItem('hero_' + key);
    return v == null ? defaultValue : JSON.parse(v);
  } catch (_) { return defaultValue; }
}

// ── Confirm modal estilizado (reemplazo de window.confirm) ───
// Devuelve Promise<boolean>. Mantiene branding + soporta:
//   destructive: true     → botón rojo
//   mustType: 'string'    → input obligatorio (acciones críticas tipo
//                            offboarding/suspender — patrón "type to confirm")
// El modal se crea on-demand y se reutiliza. ESC y focus trap los hereda
// del sistema A11y global (installModalA11y vuelve a query'ar en cada ESC).
function heroConfirm(opts) {
  return new Promise(resolve => {
    let modal = document.getElementById('confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'cf-title');
      modal.setAttribute('data-close-fn', '__heroConfirmCancel');
      // z-index:1000 — encima de los otros modales del Console
      // (#user-modal, #ticket-modal, #dev-modal, #lic-modal) que están
      // forzados a z-index:300 !important desde el CSS. Sin esto, el
      // heroConfirm quedaba oculto detrás del modal padre al confirmar
      // acciones como "Eliminar cuenta" o "Suspender".
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:1000;overflow-y:auto;padding:24px;';
      modal.innerHTML =
          '<div style="background:#ffffff;border:1px solid var(--hero-border);border-radius:14px;max-width:440px;margin:60px auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18);">'
        +   '<div id="cf-title" style="font-size:16px;font-weight:700;color:var(--hero-text-primary);margin-bottom:8px;"></div>'
        +   '<div id="cf-body" style="font-size:13px;color:var(--hero-text-body);line-height:1.6;margin-bottom:16px;white-space:pre-line;"></div>'
        +   '<div id="cf-type-wrap" style="display:none;margin-bottom:16px;">'
        +     '<label id="cf-type-label" for="cf-type-input" style="display:block;font-size:11px;color:var(--hero-text-muted);margin-bottom:6px;"></label>'
        +     '<input id="cf-type-input" class="form-input" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;"/>'
        +   '</div>'
        +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
        +     '<button id="cf-cancel" class="btn btn-secondary" style="font-size:13px;">Cancelar</button>'
        +     '<button id="cf-ok" class="btn btn-primary" style="font-size:13px;">Confirmar</button>'
        +   '</div>'
        + '</div>';
      document.body.appendChild(modal);
      if (typeof _setupModalA11y === 'function') _setupModalA11y(modal);
    }

    const titleEl  = document.getElementById('cf-title');
    const bodyEl   = document.getElementById('cf-body');
    const btnOk    = document.getElementById('cf-ok');
    const btnCancel= document.getElementById('cf-cancel');
    const typeWrap = document.getElementById('cf-type-wrap');
    const typeLbl  = document.getElementById('cf-type-label');
    const typeInp  = document.getElementById('cf-type-input');

    titleEl.textContent = opts.title || '¿Confirmar?';
    bodyEl.textContent  = opts.body || '';
    btnOk.textContent   = opts.confirmText || 'Confirmar';
    btnCancel.textContent = opts.cancelText || 'Cancelar';
    btnOk.className = opts.destructive ? 'btn btn-danger' : 'btn btn-primary';

    if (opts.mustType) {
      typeWrap.style.display = 'block';
      typeLbl.textContent = 'Para confirmar, escribe: ' + opts.mustType;
      typeInp.value = '';
      btnOk.disabled = true;
      typeInp.oninput = () => { btnOk.disabled = typeInp.value.trim() !== opts.mustType; };
    } else {
      typeWrap.style.display = 'none';
      btnOk.disabled = false;
      typeInp.oninput = null;
    }

    const close = (val) => {
      modal.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      typeInp.oninput = null;
      delete window.__heroConfirmCancel;
      resolve(val);
    };
    btnOk.onclick = () => close(true);
    btnCancel.onclick = () => close(false);
    // ESC global (instalado por installModalA11y) llama data-close-fn
    window.__heroConfirmCancel = () => close(false);

    modal.style.display = 'block';
  });
}

// ── Empty state con CTA opcional ──────────────────────────────
// Usado cuando una colección está legítimamente vacía (no por error).
function renderEmpty(el, opts) {
  if (!el) return;
  const icon    = opts.icon || '<iconify-icon icon="tabler:mailbox"></iconify-icon>';
  const message = opts.message || 'Sin datos';
  const ctaText = opts.ctaText || '';
  const ctaFn   = opts.ctaFn || null;
  el.innerHTML =
      '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;">'
    +   '<div style="font-size:36px;opacity:0.35;margin-bottom:14px;">' + icon + '</div>'
    +   '<div style="font-size:13px;color:var(--hero-text-muted);margin-bottom:' + (ctaText ? '16px' : '0') + ';">' + escHtml(message) + '</div>'
    +   (ctaText ? '<button class="btn btn-secondary" data-empty-cta style="font-size:12px;">' + ctaText + '</button>' : '')
    + '</div>';
  if (ctaFn) {
    const btn = el.querySelector('[data-empty-cta]');
    if (btn) btn.addEventListener('click', () => { try { ctaFn(); } catch (_) {} });
  }
}

// ── Loading skeleton (shimmer rectangles) ─────────────────────
// Reemplaza spinners genéricos durante el fetch. Tipos:
//   'list' (default) — filas horizontales para tablas/listas
//   'card' — bloques más altos para grids/kanban
//   'stat' — chips compactos para el dashboard
function renderSkeleton(el, opts) {
  if (!el) return;
  const rows = (opts && opts.rows) || 4;
  const cls = opts && opts.type === 'card' ? 'skel-card'
            : opts && opts.type === 'stat' ? 'skel-stat'
            : 'skel-row';
  el.innerHTML = Array(rows).fill(0).map(() => '<div class="skel ' + cls + '"></div>').join('');
}

// ── Error state renderer con botón Reintentar ─────────────────
// Reemplaza el patrón "innerHTML = 'Error: ' + msg" — el usuario sí ve qué
// falló y puede reintentar sin navegar fuera de la página.
function renderError(el, err, retryFn) {
  if (!el) return;
  const msg = (err && err.message) || String(err || 'Error desconocido');
  el.innerHTML =
      '<div style="text-align:center;padding:32px;">'
    +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;color:var(--hero-warning);"><iconify-icon icon="tabler:alert-triangle"></iconify-icon></div>'
    +   '<div style="font-family:var(--mono);font-size:12px;color:var(--hero-danger);margin-bottom:14px;">' + escHtml(msg) + '</div>'
    +   (retryFn ? '<button class="btn btn-secondary" data-retry style="font-size:12px;">↺ Reintentar</button>' : '')
    + '</div>';
  if (retryFn) {
    const btn = el.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', () => { try { retryFn(); } catch (_) {} });
  }
}


// ── Last updated indicator ────────────────────────────────
function setLastUpdated(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const now = new Date().toLocaleString('es-MX', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  el.textContent = 'Actualizado: ' + now + ' ET';
}

// ── Clear form ────────────────────────────────────────────────
function clearForm(prefix) {
  ['nombre','email','password','email-personal'].forEach(f => {
    const el = document.getElementById(prefix + '-' + f);
    if (el) el.value = '';
  });
}

function clearAllLogs() {
  ['log-full','log-emp','log-agt','log-rst'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:trash"></iconify-icon></div><div class="log-empty-text">Logs limpiados</div></div>';
  });
  sessionLogs.length = 0;
}

// ── Validar formulario ────────────────────────────────────────
function validateForm(prefix) {
  const nombre = document.getElementById(prefix + '-nombre').value.trim();
  const email  = document.getElementById(prefix + '-email').value.trim();
  const pers   = document.getElementById(prefix + '-email-personal').value.trim();
  if (!nombre) { showToast('Falta el nombre del usuario'); return false; }
  if (!email)  { showToast('Falta el email corporativo'); return false; }
  if (!pers)   { showToast('Falta el email personal'); return false; }
  return { nombre, email, pers };
}

// ── Verificar API key ─────────────────────────────────────────
// ── Reset Password — integrado con Workspace ─────────────────
let rstSelectedUser = null;

function filterResetUsers() {
  const q = document.getElementById('rst-search').value.toLowerCase();
  const sug = document.getElementById('rst-suggestions');
  if (!q || q.length < 2 || !window._workspaceUsers) { sug.style.display = 'none'; return; }
  const matches = window._workspaceUsers.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!matches.length) { sug.style.display = 'none'; return; }
  sug.style.display = 'block';
  sug.innerHTML = matches.map(u =>
    '<div onclick="selectResetUser(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\',\'' + escJs(u.estado) + '\')" '
    + 'style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" '
    + 'onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + escHtml(u.email) + ' · ' + escHtml(u.estado) + '</div></div>'
  ).join('');
}

function selectResetUser(email, nombre, estado) {
  rstSelectedUser = { email, nombre, estado };
  document.getElementById('rst-search').value = nombre;
  document.getElementById('rst-suggestions').style.display = 'none';
  document.getElementById('rst-sel-nombre').textContent = nombre;
  document.getElementById('rst-sel-email').textContent  = email;
  document.getElementById('rst-sel-estado').textContent = 'Estado: ' + estado;
  document.getElementById('rst-selected').style.display = 'block';
  addLog('Usuario seleccionado: ' + email, 'info', 'log-rst');
}

function clearResetUser() {
  rstSelectedUser = null;
  document.getElementById('rst-search').value = '';
  document.getElementById('rst-selected').style.display = 'none';
  document.getElementById('rst-new-password').value = '';
}

// Genera una contraseña fuerte de 12 chars (1 mayúscula, 1 minúscula, 1 dígito,
// 1 especial + 8 random). Sin caracteres ambiguos (0/O/I/l/1). Usa
// crypto.getRandomValues — Math.random no es criptográficamente seguro.
function _generateStrongPassword() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#*$';
  const all     = upper + lower + digits + special;
  const rand = (max) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  let pwd = upper[rand(upper.length)]
          + lower[rand(lower.length)]
          + digits[rand(digits.length)]
          + special[rand(special.length)];
  for (let i = 0; i < 8; i++) pwd += all[rand(all.length)];
  // Fisher-Yates shuffle para que los 4 primeros chars no estén siempre en orden U-L-D-S
  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function generateResetPassword() {
  const pwd = _generateStrongPassword();
  document.getElementById('rst-new-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
}

async function executeReset() {
  if (!rstSelectedUser) { showToast('Selecciona un usuario primero'); return; }
  const password = document.getElementById('rst-new-password').value.trim();
  if (!password) { showToast('Genera o escribe una contraseña temporal'); return; }

  const btn = document.getElementById('btn-exec-reset');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Reseteando...';
  addLog('Reseteando contraseña de ' + rstSelectedUser.email + '...', 'warn', 'log-rst');

  try {
    // 1. Reset en Workspace
    const resp = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rstSelectedUser.email, action: 'reset', newPassword: password })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error en Workspace');
    addLog('Contraseña reseteada en Workspace', 'success', 'log-rst');

    // 2. Enviar email de notificación al correo corporativo
    await sendViaResend({
      to: rstSelectedUser.email,
      subject: 'Restablecimiento de contraseña - Hero Insurance USA',
      html: buildEmailReset(rstSelectedUser.nombre, rstSelectedUser.email, password),
      text: 'Hola ' + rstSelectedUser.nombre + ', tu contraseña ha sido restablecida. Nueva contraseña temporal: ' + password,
    });
    addLog('Email de notificación enviado a ' + rstSelectedUser.email, 'success', 'log-rst');

    auditLog('reset', 'Contraseña reseteada: ' + rstSelectedUser.nombre, rstSelectedUser.email);
    showToast('Contraseña reseteada y usuario notificado');
    clearResetUser();
  } catch(err) {
    addLog('Error: ' + err.message, 'error', 'log-rst');
    showToast('Error: ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:key"></iconify-icon> Resetear contraseña en Workspace y notificar';
}


// ── Configuración ─────────────────────────────────────────────
// 3 secciones: Autorizadores (KV), Preferencias (localStorage), Plantillas
// (placeholder con link al código). Cada sección tiene su propio load/save.

// Lista en memoria mientras se edita; cfgSaveAuthorizers la pushea al Worker.
let cfgAuthorizers = [];

async function loadConfig() {
  cfgLoadAuthorizers();
  cfgLoadPrefs();
}

async function cfgLoadAuthorizers() {
  const listEl = document.getElementById('cfg-authorizers-list');
  if (!listEl) return;
  renderSkeleton(listEl, { type: 'list', rows: 3 });
  try {
    const r = await authFetch(WORKER_URL + '/config/authorizers');
    if (!r.ok) throw new Error('Worker ' + r.status);
    const d = await r.json();
    cfgAuthorizers = d.authorizers || [];
    const status = document.getElementById('cfg-auth-status');
    if (status) status.textContent = d.isDefault ? 'usando lista por defecto' : cfgAuthorizers.length + ' configurado' + (cfgAuthorizers.length !== 1 ? 's' : '');
    _renderAuthorizers();
  } catch (e) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--hero-danger);padding:8px;">Error: ' + escHtml(e.message) + '</div>';
  }
}

function _renderAuthorizers() {
  const listEl = document.getElementById('cfg-authorizers-list');
  if (!listEl) return;
  if (!cfgAuthorizers.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--hero-text-muted);padding:8px;text-align:center;">Sin autorizadores configurados. Agregá al menos uno o se vuelve al fallback hardcoded.</div>';
    return;
  }
  listEl.innerHTML = cfgAuthorizers.map((a, i) =>
    '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:8px;">'
    + '<div style="flex:1;min-width:0;">'
    +   '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(a.nombre) + '</div>'
    +   '<div style="font-size:11px;font-family:var(--mono);color:var(--hero-primary);">' + escHtml(a.email) + '</div>'
    + '</div>'
    + '<button onclick="cfgRemoveAuthorizer(' + i + ')" style="background:transparent;border:1px solid var(--hero-border);color:var(--hero-danger);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;"><iconify-icon icon="tabler:trash"></iconify-icon> Quitar</button>'
    + '</div>'
  ).join('');
}

function cfgAddAuthorizer() {
  const email  = document.getElementById('cfg-auth-new-email').value.trim().toLowerCase();
  const nombre = document.getElementById('cfg-auth-new-nombre').value.trim();
  if (!email || !nombre) { showToast('Email y nombre son requeridos'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Email inválido'); return; }
  if (cfgAuthorizers.some(a => a.email === email)) { showToast('Ese email ya está en la lista'); return; }
  cfgAuthorizers.push({ email, nombre });
  document.getElementById('cfg-auth-new-email').value = '';
  document.getElementById('cfg-auth-new-nombre').value = '';
  _renderAuthorizers();
}

function cfgRemoveAuthorizer(idx) {
  cfgAuthorizers.splice(idx, 1);
  _renderAuthorizers();
}

async function cfgSaveAuthorizers() {
  const btn = document.getElementById('btn-cfg-save-auth');
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...'; }
  try {
    const r = await authFetch(WORKER_URL + '/config/authorizers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizers: cfgAuthorizers }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    showToast(d.usingDefault ? 'Lista vacía — usando fallback' : 'Guardados ' + d.count + ' autorizadores');
    auditLog('config', 'Autorizadores actualizados', d.count + ' entries');
    cfgLoadAuthorizers();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar cambios'; }
}

// Preferencias locales en localStorage. Aplicadas inmediatamente al guardar.
function cfgLoadPrefs() {
  const themeEl = document.getElementById('cfg-pref-theme');
  if (themeEl) themeEl.value = localStorage.getItem('hero-theme') || 'light';
}

function cfgSavePrefs() {
  const themeEl = document.getElementById('cfg-pref-theme');
  if (themeEl) {
    localStorage.setItem('hero-theme', themeEl.value);
    document.body.setAttribute('data-theme', themeEl.value);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.innerHTML = '<iconify-icon icon="tabler:' + (themeEl.value === 'dark' ? 'moon' : 'sun') + '"></iconify-icon>';
  }
  showToast('Preferencias guardadas');
}

// ── Email templates ───────────────────────────────────────────
function buildEmailEmpleado(nombre, email, password, lang) {
  return buildOnboardingEmail(nombre, email, password, 'empleado', lang);
}

function buildEmailAgente(nombre, email, password, lang) {
  return buildOnboardingEmail(nombre, email, password, 'agente', lang);
}

// Asunto y texto plano del correo de onboarding según idioma (es | en).
function onboardingSubject(tipo, lang) {
  var en = (lang === 'en');
  if (tipo === 'empleado')
    return en ? 'Welcome to Hero Insurance USA - Account access information'
              : 'Bienvenido(a) a Hero Insurance USA - Informacion de acceso';
  return en ? 'Welcome to Hero Insurance USA - Agent access'
            : 'Bienvenido(a) a Hero Insurance USA - Acceso de Agente';
}

function onboardingText(nombre, email, lang) {
  return (lang === 'en')
    ? 'Welcome ' + nombre + '. Email: ' + email
    : 'Bienvenido ' + nombre + '. Correo: ' + email;
}

function buildOnboardingEmail(nombre, email, password, tipo, lang) {
  lang = (lang === 'en') ? 'en' : 'es';
  var P    = '#06a3b6';
  var P2   = '#048395';
  var LOGO = 'https://i.ibb.co/PvS31B1z/shield-low.png';
  var SOPORTE_URL = 'https://hub.heroinsuranceusa.com/soporte.html';

  // Textos del correo en español (es) e inglés (en). Cada idioma incluye sus 4 pasos de inicio de sesión.
  var STR = {
    es: {
      htmlLang:    'es',
      role:        (tipo === 'empleado' ? 'Empleado' : 'Agente'),
      welcome:     '&iexcl;Bienvenido al equipo, ' + nombre + '!',
      welcomeSub:  'Tu cuenta corporativa ha sido creada y est&aacute; lista para usar.',
      credsTitle:  '&#128274; Tus credenciales de acceso',
      corpEmail:   'Correo corporativo',
      tempPass:    'Contrase&ntilde;a temporal',
      passFallback:'(se asignar&aacute; al iniciar sesi&oacute;n)',
      passNote:    'Deber&aacute;s cambiarla al iniciar sesi&oacute;n por primera vez.',
      stepsTitle:  '&#128204; C&oacute;mo iniciar sesi&oacute;n',
      secTitle:    '&#128274; Pol&iacute;ticas de seguridad',
      secItems: [
        'Tu cuenta es personal e intransferible',
        'Nunca compartas tu contrase&ntilde;a con nadie',
        'La informaci&oacute;n de clientes es estrictamente confidencial',
        'Reporta cualquier actividad sospechosa a IT de inmediato'
      ],
      supportQ:    '&iquest;Tienes alg&uacute;n problema para acceder?',
      supportSub:  'El equipo de IT est&aacute; disponible para ayudarte.',
      supportBtn:  'Abrir ticket de soporte &rarr;',
      steps: [
        ['1', '&#128187;', 'Abre Google Chrome',
         'Te recomendamos usar Google Chrome como navegador principal. Si no lo tienes instalado, desc&aacute;rgalo desde <a href="https://www.google.com/chrome" style="color:' + P + ';font-weight:700;">google.com/chrome</a>.'],
        ['2', '&#128274;', 'Inicia sesi&oacute;n con tus credenciales',
         'Ve a <a href="https://mail.google.com" style="color:' + P + ';font-weight:700;">mail.google.com</a> e ingresa tu correo corporativo y la contrase&ntilde;a temporal. Google te pedir&aacute; que la cambies de inmediato &mdash; elige una contrase&ntilde;a segura que no hayas usado antes.'],
        ['3', '&#128241;', 'Activa la verificaci&oacute;n en dos pasos',
         'Es obligatorio proteger tu cuenta corporativa. Ve a <a href="https://myaccount.google.com/security" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> &rarr; Seguridad &rarr; Verificaci&oacute;n en dos pasos y sigue los pasos.'],
        ['4', '&#128100;', 'Completa tu perfil de Google',
         'Agrega tu foto de perfil en <a href="https://myaccount.google.com" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> para que el equipo pueda identificarte f&aacute;cilmente en las comunicaciones.']
      ]
    },
    en: {
      htmlLang:    'en',
      role:        (tipo === 'empleado' ? 'Employee' : 'Agent'),
      welcome:     'Welcome to the team, ' + nombre + '!',
      welcomeSub:  'Your corporate account has been created and is ready to use.',
      credsTitle:  '&#128274; Your access credentials',
      corpEmail:   'Corporate email',
      tempPass:    'Temporary password',
      passFallback:'(will be set at first sign-in)',
      passNote:    'You will be asked to change it the first time you sign in.',
      stepsTitle:  '&#128204; How to sign in',
      secTitle:    '&#128274; Security policies',
      secItems: [
        'Your account is personal and non-transferable',
        'Never share your password with anyone',
        'Client information is strictly confidential',
        'Report any suspicious activity to IT immediately'
      ],
      supportQ:    'Having trouble signing in?',
      supportSub:  'The IT team is here to help.',
      supportBtn:  'Open a support ticket &rarr;',
      steps: [
        ['1', '&#128187;', 'Open Google Chrome',
         'We recommend using Google Chrome as your main browser. If you do not have it installed, download it from <a href="https://www.google.com/chrome" style="color:' + P + ';font-weight:700;">google.com/chrome</a>.'],
        ['2', '&#128274;', 'Sign in with your credentials',
         'Go to <a href="https://mail.google.com" style="color:' + P + ';font-weight:700;">mail.google.com</a> and enter your corporate email and the temporary password. Google will ask you to change it right away &mdash; choose a strong password you have not used before.'],
        ['3', '&#128241;', 'Turn on 2-step verification',
         'Protecting your corporate account is mandatory. Go to <a href="https://myaccount.google.com/security" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> &rarr; Security &rarr; 2-Step Verification and follow the steps.'],
        ['4', '&#128100;', 'Complete your Google profile',
         'Add your profile photo at <a href="https://myaccount.google.com" style="color:' + P + ';font-weight:700;">myaccount.google.com</a> so the team can easily identify you in communications.']
      ]
    }
  };
  var t = STR[lang];

  var pasosHtml = t.steps.map(function(p) {
    return '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:14px;">'
      + '<tr valign="top">'
      + '<td width="44" style="padding-right:12px;padding-top:2px;">'
      + '<div style="width:36px;height:36px;background:linear-gradient(135deg,' + P + ',' + P2 + ');border-radius:50%;text-align:center;line-height:36px;font-size:16px;">' + p[1] + '</div>'
      + '</td>'
      + '<td valign="top">'
      + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;font-weight:700;color:#1a1a1a;">' + p[0] + '. ' + p[2] + '</p>'
      + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:12px;color:#666;line-height:1.6;">' + p[3] + '</p>'
      + '</td>'
      + '</tr>'
      + '</table>';
  }).join('');

  return '<!DOCTYPE html><html lang="' + t.htmlLang + '"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    + '<body style="margin:0;padding:0;background:#f0f4f8;font-family:Trebuchet MS,Arial,sans-serif;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(6,163,182,0.12);">'

    // ── Header ────────────────────────────────────────────────────────────
    + '<tr><td style="background:linear-gradient(135deg,' + P + ' 0%,' + P2 + ' 60%,#036070 100%);padding:0;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="height:4px;background:linear-gradient(90deg,rgba(255,255,255,0.1),rgba(255,255,255,0.4),rgba(255,255,255,0.1));"></td></tr></table>'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr valign="middle"><td style="padding:32px 40px 28px;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%"><tr valign="middle">'
    + '<td width="80" style="padding-right:20px;">'
    + '<img src="' + LOGO + '" width="64" height="64" style="width:64px;height:64px;display:block;border-radius:50%;border:3px solid rgba(255,255,255,0.4);box-shadow:0 4px 20px rgba(0,0,0,0.2);"/>'
    + '</td>'
    + '<td valign="middle">'
    + '<div style="font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">Hero Insurance USA &nbsp;&bull;&nbsp; ' + t.role + '</div>'
    + '<h1 style="margin:0 0 5px;font-family:Trebuchet MS,Arial,sans-serif;font-size:24px;font-weight:700;color:#fff;line-height:1.2;">' + t.welcome + '</h1>'
    + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.8);">' + t.welcomeSub + '</p>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr></table>'
    + '</td></tr>'

    // ── Body ──────────────────────────────────────────────────────────────
    + '<tr><td style="padding:32px 40px;">'

    // Credentials
    + '<div style="background:linear-gradient(135deg,#f0f8fa,#e8f4f6);border-radius:14px;border:1px solid #c8e8ec;padding:20px;margin-bottom:24px;">'
    + '<p style="margin:0 0 14px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' + P + ';">' + t.credsTitle + '</p>'
    + '<div style="background:#fff;border-radius:8px;border:1px solid #d8e1ea;padding:12px 16px;margin-bottom:10px;">'
    + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a8494;">' + t.corpEmail + '</p>'
    + '<p style="margin:0;font-family:Courier New,monospace;font-size:14px;font-weight:700;color:' + P + ';">' + email + '</p>'
    + '</div>'
    + '<div style="background:#fffbf0;border-radius:8px;border:1px solid #f0d080;padding:12px 16px;">'
    + '<p style="margin:0 0 3px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08a00;">' + t.tempPass + '</p>'
    + '<p style="margin:0;font-family:Courier New,monospace;font-size:16px;font-weight:700;color:#7a5f00;letter-spacing:2px;">' + (password || t.passFallback) + '</p>'
    + '<p style="margin:6px 0 0;font-family:Trebuchet MS,Arial,sans-serif;font-size:11px;color:#b08a00;">' + t.passNote + '</p>'
    + '</div></div>'

    // Pasos de inicio de sesión + políticas: solo para empleados.
    // El correo de agente va directo de credenciales al botón de soporte.
    + (tipo === 'agente' ? '' : (
        // Steps
        '<div style="margin-bottom:24px;">'
      + '<p style="margin:0 0 16px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' + P + ';">' + t.stepsTitle + '</p>'
      + pasosHtml
      + '</div>'
        // Security
      + '<div style="background:#fff5f5;border-radius:10px;border:1px solid #ffd4d4;padding:16px 20px;margin-bottom:24px;">'
      + '<p style="margin:0 0 8px;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c0392b;">' + t.secTitle + '</p>'
      + '<ul style="margin:0;padding:0 0 0 16px;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;color:#4a5568;line-height:1.9;">'
      + t.secItems.map(function(s){ return '<li>' + s + '</li>'; }).join('')
      + '</ul></div>'
      ))

    // Support
    + '<div style="background:linear-gradient(135deg,#f0f8fa,#e8f4f6);border-radius:10px;border:1px solid #c8e8ec;padding:18px 20px;text-align:center;">'
    + '<p style="margin:0 0 4px;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">' + t.supportQ + '</p>'
    + '<p style="margin:0 0 14px;font-family:Trebuchet MS,Arial,sans-serif;font-size:12px;color:#777;">' + t.supportSub + '</p>'
    + '<a href="' + SOPORTE_URL + '" style="display:inline-block;padding:10px 24px;background:' + P + ';color:#fff;font-family:Trebuchet MS,Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;">' + t.supportBtn + '</a>'
    + '</div>'

    + '</td></tr>'

    // ── Footer ────────────────────────────────────────────────────────────
    + '<tr><td style="padding:16px 40px;background:#f0f4f8;text-align:center;border-top:1px solid #e8e8e8;">'
    + '<p style="margin:0;font-family:Trebuchet MS,Arial,sans-serif;font-size:11px;color:#aaa;">Hero Insurance USA &bull; IT Department &bull; <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';text-decoration:none;">it&#64;heroinsuranceusa.com</a></p>'
    + '<p style="margin:4px 0 0;font-family:Trebuchet MS,Arial,sans-serif;font-size:10px;color:#ccc;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
}

// Plantilla: bienvenida al Hero Hub después de que HR firma los consents.
// Destinatario: correo corporativo (@heroinsuranceusa.com), ya activo.
// No incluye credenciales — el usuario ya inició sesión en Workspace en la
// fase previa de onboarding. Este email cierra el ciclo de incorporación
// invitándolo al Hub y presentándole las secciones + recursos clave.
//
// Estilo: Hero Light real (docs/design-system.md) — Bricolage Grotesque
// para títulos, Inter para body, JetBrains Mono para URLs; card blanco
// radius 22px sobre paper #f0f4f8; único acento cyan (no colores por
// sección); tipografía sobre decoración. Se siente como una página del
// Hub en formato email, no como un template genérico.
function buildEmailBienvenidaHub(nombre, emailCorp) {
  var P       = '#06a3b6'; // --cyan
  var P_DEEP  = '#066b78'; // --cyan-deep
  var TEXT    = '#0a3d4a'; // --text
  var TEXT_2  = '#1a4a5a'; // --text-2
  var MUTED   = '#5a7480'; // --muted
  var PAPER   = '#f0f4f8'; // --paper
  var BORDER  = '#e5eaef'; // ~ --border en hex opaco (para clientes que ignoran rgba)
  var LOGO    = 'https://hub.heroinsuranceusa.com/images/logo-shield-only.png';
  var HUB_URL = 'https://hub.heroinsuranceusa.com';

  // Stacks web-safe con Google Fonts como preferida — Gmail y Apple Mail
  // las cargan del <link>; Outlook desktop cae al fallback system.
  var FF_DISP = "'Bricolage Grotesque','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif";
  var FF_SANS = "'Inter','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif";
  var FF_MONO = "'JetBrains Mono','SF Mono',Consolas,Menlo,monospace";

  // Íconos Lucide como PNG hospedados en el repo — mismos que el topbar del
  // Hub. Se sirven como <img> porque Gmail strippa SVG inline. Los PNG están
  // a 88x88 (2x retina) y se muestran a 22x22, así se ven nítidos incluso
  // en pantallas HiDPI.
  var ICO_BASE = HUB_URL + '/images/icons/lucide/';
  function ico(name) {
    return '<img src="' + ICO_BASE + name + '.png" width="22" height="22" alt="" style="display:block;width:22px;height:22px;border:0;"/>';
  }

  // Cuatro líneas — las secciones más relevantes para arrancar.
  // Cada sección con su ícono Lucide del topbar, en un tile 42x42 cyan-tenue.
  var secciones = [
    ['users',   'Equipo',     'Conoce al equipo y sus roles',      '/equipo.html'],
    ['network', 'Agencias',   'Organigrama y comisiones por plan', '/agencias.html'],
    ['shield',  'Portales',   'Accesos r&aacute;pidos a carriers', '/portales.html'],
    ['rocket',  'Onboarding', 'Tu ruta paso a paso al arrancar',   '/onboarding.html']
  ];

  var seccionesHtml = secciones.map(function(s) {
    return '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;"><tr valign="middle">'
      + '<td width="56" style="padding-right:14px;">'
      + '<a href="' + HUB_URL + s[3] + '" style="text-decoration:none;display:block;">'
      + '<table cellspacing="0" cellpadding="0" border="0"><tr><td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;background:rgba(6,163,182,0.08);border-radius:14px;">'
      + ico(s[0])
      + '</td></tr></table>'
      + '</a>'
      + '</td>'
      + '<td valign="middle">'
      + '<a href="' + HUB_URL + s[3] + '" style="text-decoration:none;color:' + TEXT + ';display:block;">'
      + '<div style="font-family:' + FF_SANS + ';font-size:15px;font-weight:600;color:' + TEXT + ';line-height:1.3;margin-bottom:2px;">' + s[1] + '</div>'
      + '<div style="font-family:' + FF_SANS + ';font-size:13px;font-weight:400;color:' + MUTED + ';line-height:1.4;">' + s[2] + '</div>'
      + '</a>'
      + '</td>'
      + '</tr></table>';
  }).join('');

  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="UTF-8"/>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"/>'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>'
    + '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet"/>'
    + '</head>'
    + '<body style="margin:0;padding:0;background:' + PAPER + ';font-family:' + FF_SANS + ';">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:' + PAPER + ';"><tr><td style="padding:40px 16px;">'
    + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 4px 20px rgba(10,61,74,0.06);">'

    // ── Header interno: logo + wordmark ───────────────────────
    + '<tr><td style="padding:32px 40px 24px;border-bottom:1px solid ' + BORDER + ';">'
    + '<table cellspacing="0" cellpadding="0" border="0"><tr valign="middle">'
    + '<td width="52" style="padding-right:14px;">'
    + '<img src="' + LOGO + '" width="40" height="40" alt="Hero Insurance USA" style="width:40px;height:40px;display:block;"/>'
    + '</td>'
    + '<td valign="middle">'
    + '<div style="font-family:' + FF_SANS + ';font-size:11px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:' + P + ';">Hero Hub</div>'
    + '<div style="font-family:' + FF_SANS + ';font-size:11px;font-weight:400;color:' + MUTED + ';margin-top:2px;">Hero Insurance USA</div>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr>'

    // ── Hero: título + intro + CTA ────────────────────────────
    + '<tr><td style="padding:40px 40px 8px;">'
    + '<h1 style="margin:0 0 20px;font-family:' + FF_DISP + ';font-size:32px;font-weight:700;color:' + TEXT + ';line-height:1.15;letter-spacing:-0.5px;">Bienvenido al equipo,<br>' + nombre + '.</h1>'
    + '<p style="margin:0 0 14px;font-family:' + FF_SANS + ';font-size:15px;color:' + TEXT_2 + ';line-height:1.65;">Hoy oficialmente formas parte de la familia Hero. Todo el equipo est&aacute; emocionado de tenerte a bordo.</p>'
    + '<p style="margin:0 0 30px;font-family:' + FF_SANS + ';font-size:15px;color:' + TEXT_2 + ';line-height:1.65;">Queremos compartir contigo el <strong style="color:' + TEXT + ';font-weight:600;">Hero Hub</strong>, nuestro cuartel general digital &mdash; ah&iacute; encontrar&aacute;s todo lo que necesitas para arrancar con el pie derecho.</p>'

    // CTA
    + '<table cellspacing="0" cellpadding="0" border="0"><tr><td>'
    + '<a href="' + HUB_URL + '" style="display:inline-block;padding:14px 28px;background:' + P + ';color:#ffffff;font-family:' + FF_SANS + ';font-size:14px;font-weight:600;text-decoration:none;border-radius:14px;letter-spacing:0.2px;">Entrar al Hub &nbsp;&rarr;</a>'
    + '</td></tr></table>'
    + '<p style="margin:14px 0 0;font-family:' + FF_MONO + ';font-size:12px;color:' + MUTED + ';">hub.heroinsuranceusa.com</p>'
    + '</td></tr>'

    // ── Divisor ────────────────────────────────────────────────
    + '<tr><td style="padding:36px 40px 0;"><div style="border-top:1px solid ' + BORDER + ';"></div></td></tr>'

    // ── Secciones del Hub ─────────────────────────────────────
    + '<tr><td style="padding:32px 40px 8px;">'
    + '<p style="margin:0 0 24px;font-family:' + FF_SANS + ';font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:' + MUTED + ';">Dentro del Hub</p>'
    + seccionesHtml
    + '</td></tr>'

    // ── Divisor ────────────────────────────────────────────────
    + '<tr><td style="padding:24px 40px 0;"><div style="border-top:1px solid ' + BORDER + ';"></div></td></tr>'

    // ── Firma CEO con foto ────────────────────────────────────
    + '<tr><td style="padding:32px 40px 40px;">'
    + '<p style="margin:0 0 20px;font-family:' + FF_SANS + ';font-size:14px;color:' + TEXT_2 + ';line-height:1.6;">Con la mejor bienvenida,</p>'
    + '<table cellspacing="0" cellpadding="0" border="0"><tr valign="middle">'
    + '<td width="76" style="padding-right:16px;">'
    + '<img src="' + HUB_URL + '/images/team/jesus-gutierrez.jpg" width="60" height="60" alt="Jes&uacute;s Guti&eacute;rrez" style="width:60px;height:60px;display:block;border-radius:50%;object-fit:cover;border:2px solid rgba(6,163,182,0.15);"/>'
    + '</td>'
    + '<td valign="middle">'
    + '<p style="margin:0 0 4px;font-family:' + FF_DISP + ';font-size:20px;font-weight:600;color:' + TEXT + ';line-height:1.2;">Jes&uacute;s Guti&eacute;rrez</p>'
    + '<p style="margin:0;font-family:' + FF_SANS + ';font-size:11px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:' + P + ';">CEO &nbsp;&middot;&nbsp; Hero Insurance USA</p>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr>'

    + '</table>'

    // ── Footer (fuera del card, sobre paper) ───────────────────
    + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="margin-top:20px;"><tr><td style="padding:0 40px;text-align:center;">'
    + '<p style="margin:0 0 4px;font-family:' + FF_SANS + ';font-size:11px;color:' + MUTED + ';">Hero Insurance USA &middot; <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';text-decoration:none;">it&#64;heroinsuranceusa.com</a></p>'
    + '<p style="margin:0;font-family:' + FF_SANS + ';font-size:10px;color:' + MUTED + ';opacity:0.7;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
    + '</td></tr></table>'

    + '</td></tr></table></body></html>';
}

function buildEmailReset(nombre, emailCorp, password) {
  var now = new Date();
  var fecha = now.toLocaleDateString('es-ES', { timeZone:'America/New_York', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><style>body{margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;}</style></head><body style="margin:0;padding:0;background:#f0f4f8;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;">'
  + '<tr><td style="background:linear-gradient(135deg,#06a3b6,#048395);padding:36px 40px;text-align:center;">'
  + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 20px;"/>'
  + '<h1 style="margin:0;font-size:24px;font-weight:900;color:#fff;">Restablecimiento de Contrasena</h1>'
  + '<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Se ha generado una nueva contrasena temporal.</p></td></tr>'
  + '<tr><td style="padding:36px 40px;">'
  + '<p style="margin:0 0 20px;font-size:15px;color:#2d3748;">Hola <strong>' + nombre + '</strong>, hemos procesado el restablecimiento de tu contrasena.</p>'
  + '<div style="background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;border-left:4px solid #f0b429;padding:14px 18px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#b08a00;text-transform:uppercase;letter-spacing:1px;">Aviso de seguridad</p>'
  + '<p style="margin:0;font-size:13px;color:#7a5f00;">Si no solicitaste este cambio, contacta de inmediato al equipo de IT.</p></div>'
  + '<div style="background:#f7faff;border-radius:12px;border:1px solid #e2eaf8;margin-bottom:20px;">'
  + '<div style="padding:12px 20px;background:#eef4ff;border-radius:12px 12px 0 0;font-size:11px;font-weight:900;letter-spacing:2px;color:#06a3b6;text-transform:uppercase;">Nuevas credenciales</div>'
  + '<div style="padding:18px 20px;">'
  + '<div style="padding:12px;background:#fff;border-radius:8px;border:1px solid #dde8ff;margin-bottom:10px;">'
  + '<div style="font-size:10px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Correo corporativo</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#06a3b6;">' + emailCorp + '</div></div>'
  + '<div style="padding:12px;background:#f0fff4;border-radius:8px;border:1px solid #9ae6b4;">'
  + '<div style="font-size:10px;font-weight:700;color:#276749;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Nueva contrasena temporal</div>'
  + '<div style="font-family:monospace;font-size:14px;font-weight:700;color:#22543d;">' + (password || 'Se te asignara una contrasena al iniciar sesion') + '</div></div>'
  + '</div></div>'
  + '<div style="background:#eef4ff;border-radius:12px;border:1px solid #c5deff;padding:18px 20px;margin-bottom:20px;">'
  + '<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1a202c;">Necesitas ayuda?</p>'
  + '<p style="margin:0 0 10px;font-size:12px;color:#4a5568;">Si no reconoces esta solicitud, contacta al equipo de IT de inmediato.</p>'
  + '<a href="https://hub.heroinsuranceusa.com/soporte.html" style="display:inline-block;padding:10px 20px;background:#06a3b6;color:#fff;font-size:12px;font-weight:700;text-decoration:none;border-radius:8px;">Contactar soporte IT</a></div>'
  + '<div style="text-align:center;padding:12px;background:#f7faff;border-radius:10px;border:1px solid #e2eaf8;">'
  + '<p style="margin:0;font-family:monospace;font-size:11px;color:#a0aec0;">Solicitud procesada el ' + fecha + ' (ET)</p></div>'
  + '</td></tr>'
  + '<tr><td style="padding:14px 40px;background:#f0f4f8;text-align:center;">'
  + '<p style="margin:0;font-size:10px;color:#a0aec0;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee. If you are not the intended recipient, please notify the sender immediately.</p>'
  + '</td></tr></table></td></tr></table></body></html>';
}

// ── Template: cuenta suspendida (al personal email) ──────────
// Se envía al correo personal (Gmail/etc.) cuando IT suspende una cuenta
// de Workspace. Incluye motivo específico + advertencia de eliminación a
// los 15 días + CTA de mailto a IT con subject pre-llenado para reactivación.
function buildEmailSuspension(nombre, emailCorp, fechaEliminacion, motivo) {
  var P = '#06a3b6';
  var motivoText = motivo || 'por decisión de la administración';
  var mailtoUrl = 'mailto:it@heroinsuranceusa.com'
    + '?subject=' + encodeURIComponent('Reactivar cuenta ' + emailCorp)
    + '&body=' + encodeURIComponent('Hola equipo de IT,\n\nSolicito la reactivacion de la cuenta ' + emailCorp + '.\n\nGracias.\n\n' + (nombre || ''));
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
  + '<body style="margin:0;padding:0;background:#f0f4f8;font-family:Trebuchet MS,Arial,sans-serif;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(192,57,43,0.10);">'
  + '<tr><td style="background:linear-gradient(135deg,#c0392b,#a52917);padding:32px 40px;text-align:center;">'
  + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 18px;"/>'
  + '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">CUENTA SUSPENDIDA</div>'
  + '<h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">Tu cuenta corporativa fue suspendida</h1>'
  + '</td></tr>'
  + '<tr><td style="padding:32px 40px;">'
  + '<p style="margin:0 0 16px;font-size:14px;color:#2d3748;line-height:1.55;">Hola <strong>' + nombre + '</strong>, este correo es para informarte que tu cuenta corporativa <strong style="color:#c0392b;">' + emailCorp + '</strong> fue suspendida.</p>'
  + '<div style="background:#f7faff;border-radius:10px;border:1px solid #d8e1ea;padding:14px 18px;margin-bottom:18px;">'
  + '<p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1.5px;">Motivo</p>'
  + '<p style="margin:0;font-size:13px;color:#2d3748;line-height:1.5;">' + escHtml(motivoText) + '</p>'
  + '</div>'
  + '<p style="margin:0 0 20px;font-size:13px;color:#4a5568;line-height:1.55;">Mientras la cuenta está suspendida no podrás acceder al correo, al calendario ni a ningún otro servicio de Google Workspace de Hero Insurance USA.</p>'
  + '<div style="background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;border-left:4px solid #f0b429;padding:16px 20px;margin-bottom:24px;">'
  + '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#b08a00;text-transform:uppercase;letter-spacing:1.5px;">Plazo importante</p>'
  + '<p style="margin:0;font-size:13px;color:#7a5f00;line-height:1.6;">Si no solicitas la reactivación de tu cuenta en los próximos <strong>15 días</strong>' + (fechaEliminacion ? ' (antes del <strong>' + fechaEliminacion + '</strong>)' : '') + ', la cuenta será <strong>eliminada de forma permanente</strong> y no podrás recuperar su contenido.</p>'
  + '</div>'
  + '<div style="text-align:center;margin:0 0 24px;">'
  + '<a href="' + mailtoUrl + '" style="display:inline-block;padding:14px 32px;background:' + P + ';color:#fff;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:30px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(6,163,182,0.30);">✉ Solicitar reactivación</a>'
  + '<p style="margin:12px 0 0;font-size:11px;color:#999;">Se abrirá tu cliente de correo con un mensaje pre-llenado para IT.</p>'
  + '</div>'
  + '<div style="background:#f7faff;border-radius:10px;border:1px solid #e2eaf8;padding:14px 18px;">'
  + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1.5px;">Contacto directo</p>'
  + '<p style="margin:0;font-size:13px;color:#4a5568;">También puedes escribir directamente a <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';font-weight:700;">it@heroinsuranceusa.com</a></p>'
  + '</div>'
  + '</td></tr>'
  + '<tr><td style="padding:14px 40px;background:#f0f4f8;text-align:center;border-top:1px solid #e8e8e8;">'
  + '<p style="margin:0;font-size:10px;color:#aaa;">Hero Insurance USA &bull; IT Department</p>'
  + '<p style="margin:4px 0 0;font-size:10px;color:#ccc;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
  + '</td></tr>'
  + '</table></td></tr></table></body></html>';
}

// ── Template: cuenta reactivada (al personal email) ──────────
// Se envía al correo personal cuando IT reactiva una cuenta que estaba
// suspendida — cierra el loop que abrió el email de suspensión (donde
// prometimos que si el usuario solicitaba reactivación, podría volver).
function buildEmailReactivation(nombre, emailCorp) {
  var P = '#06a3b6';
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
  + '<body style="margin:0;padding:0;background:#f0f4f8;font-family:Trebuchet MS,Arial,sans-serif;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(34,160,107,0.10);">'
  + '<tr><td style="background:linear-gradient(135deg,#22a06b,#0f8054);padding:32px 40px;text-align:center;">'
  + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" style="display:block;margin:0 auto 18px;"/>'
  + '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">CUENTA REACTIVADA</div>'
  + '<h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">Tu cuenta ya está activa nuevamente</h1>'
  + '</td></tr>'
  + '<tr><td style="padding:32px 40px;">'
  + '<p style="margin:0 0 18px;font-size:14px;color:#2d3748;line-height:1.55;">Hola <strong>' + nombre + '</strong>, tu cuenta corporativa <strong style="color:' + P + ';">' + emailCorp + '</strong> fue reactivada y ya puedes iniciar sesión con normalidad.</p>'
  + '<p style="margin:0 0 20px;font-size:13px;color:#4a5568;line-height:1.55;">Todo el contenido (correos, calendario, Drive) sigue disponible tal como estaba antes de la suspensión.</p>'
  + '<div style="text-align:center;margin:0 0 24px;">'
  + '<a href="https://mail.google.com" style="display:inline-block;padding:14px 32px;background:' + P + ';color:#fff;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:30px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(6,163,182,0.30);">✓ Iniciar sesión</a>'
  + '</div>'
  + '<div style="background:#eef4ff;border-radius:10px;border:1px solid #c5deff;padding:14px 18px;">'
  + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#8fa6cc;text-transform:uppercase;letter-spacing:1.5px;">¿Problemas para acceder?</p>'
  + '<p style="margin:0;font-size:13px;color:#4a5568;">Si necesitas restablecer tu contraseña o tienes cualquier inconveniente, escribe a <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';font-weight:700;">it@heroinsuranceusa.com</a></p>'
  + '</div>'
  + '</td></tr>'
  + '<tr><td style="padding:14px 40px;background:#f0f4f8;text-align:center;border-top:1px solid #e8e8e8;">'
  + '<p style="margin:0;font-size:10px;color:#aaa;">Hero Insurance USA &bull; IT Department</p>'
  + '<p style="margin:4px 0 0;font-size:10px;color:#ccc;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
  + '</td></tr>'
  + '</table></td></tr></table></body></html>';
}

// ── Template: aviso previo de suspensión por inactividad ─────
// Se envía al correo personal cuando IT dispara el aviso desde el bloque
// "Estado de actividad" del modal. La cuenta sigue activa; el correo avisa
// que en 15 días se suspenderá si no detecta login. Firma "Equipo de Hero
// Insurance USA" (no personal) porque es una comunicación de política.
function buildEmailPreSuspension(nombre, emailCorp, fechaDeadline) {
  var P = '#06a3b6';
  var ALERT = '#e8a317';
  var mailtoUrl = 'mailto:it@heroinsuranceusa.com'
    + '?subject=' + encodeURIComponent('Mantener activa cuenta ' + emailCorp)
    + '&body=' + encodeURIComponent('Hola equipo de IT,\n\nSolicito que mantengan activa mi cuenta ' + emailCorp + '.\n\nGracias.\n\n' + (nombre || ''));
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
  + '<body style="margin:0;padding:0;background:#f0f4f8;font-family:Trebuchet MS,Arial,sans-serif;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f0f4f8;"><tr><td style="padding:32px 16px;">'
  + '<table cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(232,163,23,0.10);">'
  + '<tr><td style="background:linear-gradient(135deg,' + ALERT + ',#c88a15);padding:32px 40px;text-align:center;">'
  + '<img src="https://i.ibb.co/Gr4mzLv/Nuevo-Logo-Cuadrado-compress.png" width="120" alt="Hero" style="display:block;margin:0 auto 18px;"/>'
  + '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:11px;letter-spacing:3px;padding:5px 14px;border-radius:20px;margin-bottom:10px;">AVISO PREVIO</div>'
  + '<h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">Tu cuenta corporativa está en riesgo de suspensión</h1>'
  + '</td></tr>'
  + '<tr><td style="padding:32px 40px;">'
  + '<p style="margin:0 0 16px;font-size:14px;color:#2d3748;line-height:1.55;">Hola <strong>' + escHtml(nombre) + '</strong>,</p>'
  + '<p style="margin:0 0 18px;font-size:14px;color:#2d3748;line-height:1.55;">Notamos que tu cuenta corporativa <strong style="color:#b08a00;">' + escHtml(emailCorp) + '</strong> no registra inicios de sesión en los <strong>últimos 3 meses</strong>. Como parte de nuestra política de seguridad, en <strong>15 días</strong> procederemos a suspenderla si no detectamos actividad.</p>'
  + '<div style="background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;border-left:4px solid ' + ALERT + ';padding:16px 20px;margin-bottom:24px;">'
  + '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#b08a00;text-transform:uppercase;letter-spacing:1.5px;">Plazo</p>'
  + '<p style="margin:0;font-size:13px;color:#7a5f00;line-height:1.6;">Tienes hasta el <strong>' + escHtml(fechaDeadline || '(15 días desde hoy)') + '</strong> para iniciar sesión o respondernos. Después de esa fecha la cuenta será suspendida automáticamente.</p>'
  + '</div>'
  + '<p style="margin:0 0 8px;font-size:14px;color:#2d3748;line-height:1.55;"><strong>¿Aún necesitas tu cuenta?</strong></p>'
  + '<ul style="margin:0 0 20px 18px;padding:0;font-size:13px;color:#4a5568;line-height:1.7;">'
  +   '<li>Inicia sesión en <a href="https://mail.google.com" style="color:' + P + ';font-weight:700;">mail.google.com</a> antes de la fecha indicada, o</li>'
  +   '<li>Responde este correo o escríbenos a <a href="mailto:it@heroinsuranceusa.com" style="color:' + P + ';font-weight:700;">it@heroinsuranceusa.com</a></li>'
  + '</ul>'
  + '<p style="margin:0 0 20px;font-size:13px;color:#4a5568;line-height:1.55;">Si ya no la necesitas, no hace falta que hagas nada — la suspenderemos automáticamente al vencer el plazo.</p>'
  + '<div style="text-align:center;margin:0 0 8px;">'
  + '<a href="' + mailtoUrl + '" style="display:inline-block;padding:14px 32px;background:' + P + ';color:#fff;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:30px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(6,163,182,0.30);">Solicitar mantener la cuenta</a>'
  + '</div>'
  + '</td></tr>'
  + '<tr><td style="padding:16px 40px 20px;background:#fafbfc;border-top:1px solid #e8e8e8;">'
  + '<p style="margin:0;font-size:11px;color:#8a9099;line-height:1.55;font-style:italic;">Recibes este correo en tu dirección personal porque la registraste al crear tu cuenta de Hero Insurance USA, específicamente para notificarte sobre cambios importantes como este.</p>'
  + '<p style="margin:12px 0 0;font-size:12px;color:#4a5568;line-height:1.5;">— <strong>Equipo de Hero Insurance USA</strong></p>'
  + '</td></tr>'
  + '<tr><td style="padding:14px 40px;background:#f0f4f8;text-align:center;border-top:1px solid #e8e8e8;">'
  + '<p style="margin:0;font-size:10px;color:#aaa;">Hero Insurance USA &bull; IT Department</p>'
  + '<p style="margin:4px 0 0;font-size:10px;color:#ccc;">CONFIDENTIALITY NOTICE: This email is intended solely for the addressee.</p>'
  + '</td></tr>'
  + '</table></td></tr></table></body></html>';
}

// ── Helpers Firestore: shared/workspaceUsers/{email} ─────────
// Guarda info paralela a Workspace que necesitamos y Workspace no expone:
// principalmente `personalEmail` para notificar al usuario cuando su cuenta
// se suspende. Import dinámico de firestore para no cargar el SDK si nunca
// llegamos a usarlo (el IT Console lo importa on-demand igual que en
// bootstrapFromHub). NUNCA sobreescribe fields no incluidos en `data` — usa
// setDoc merge para preservar el historial (fecha suspensión, reactivación).
async function _fsWorkspaceRef(email) {
  await import('/js/firebase-config.js');
  const [{ getFirestore, doc }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
  ]);
  const db = getFirestore();
  return { db, ref: doc(db, 'shared', 'workspaceUsers', 'byEmail', email) };
}

async function saveWorkspaceUser(email, data) {
  if (!email || !data) return;
  try {
    const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const { ref } = await _fsWorkspaceRef(email);
    await setDoc(ref, data, { merge: true });
  } catch (e) {
    console.warn('[workspaceUsers] save falló:', e && e.message);
  }
}

async function getWorkspaceUser(email) {
  if (!email) return null;
  try {
    const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const { ref } = await _fsWorkspaceRef(email);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('[workspaceUsers] get falló:', e && e.message);
    return null;
  }
}

// Lista todos los docs — usado por el chip de "próximas eliminaciones" en dashboard.
async function listWorkspaceUsers() {
  try {
    const { getFirestore, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await import('/js/firebase-config.js');
    const db = getFirestore();
    const snap = await getDocs(collection(db, 'shared', 'workspaceUsers', 'byEmail'));
    return snap.docs.map(d => ({ email: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[workspaceUsers] list falló:', e && e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Flujo de agentes inactivos ≥3m (Fase 1 · frontend, sin endpoints Fase 2)
// Ver memory/project_agentes_inactivos_flujo_wip.md.
// ═══════════════════════════════════════════════════════════════
const INACTIVITY_THRESHOLD_DAYS = 90;   // ≥3 meses sin login → candidato a aviso previo
const PRE_SUSPENSION_GRACE_DAYS = 15;   // aviso previo → 15d → suspensión
const SUSPENSION_TO_DELETION_DAYS = 15; // suspensión → 15d → eliminación (antes 7d)

// Map email→role del Hub (Firestore users/), cargado a demanda con cache en memoria.
// El role vive en `access.role` (schema del refactor v2.23 — ver js/user-store.js).
let _hubUserRolesCache = null;
async function getHubUserRoles(force) {
  if (_hubUserRolesCache && !force) return _hubUserRolesCache;
  try {
    const { getFirestore, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await import('/js/firebase-config.js');
    const db = getFirestore();
    const snap = await getDocs(collection(db, 'users'));
    const map = {};
    snap.docs.forEach(d => {
      const data = d.data() || {};
      // Fallback a `role` plano por si algún doc antiguo aún no migró al schema anidado.
      map[(d.id || '').toLowerCase()] = (data.access && data.access.role) || data.role || null;
    });
    _hubUserRolesCache = map;
    return map;
  } catch (e) {
    console.warn('[hubUserRoles] load falló:', e && e.message);
    return {};
  }
}

// Cache local del map Firestore shared/workspaceUsers indexado por email — se
// puebla en loadUsers() y se refresca al cerrar el modal de un usuario editado.
let _wsUsersMap = {};

// Detección de "agente" invertida: el refactor v2.23 migró el staff interno
// a users/, pero los agentes históricos siguen sin doc. Marcamos como agente
// a cualquier usuario Workspace que NO figure con rol de staff conocido —
// incluye tanto los pocos que tienen role:'agente' explícito como los que
// no están en users/ aún. Los admin/IT/finanzas/interno se excluyen.
const STAFF_ROLES = new Set(['admin', 'interno', 'IT', 'finanzas']);
function isAgente(u, rolesMap) {
  if (!u) return false;
  const role = rolesMap ? rolesMap[(u.email || '').toLowerCase()] : null;
  if (role && STAFF_ROLES.has(role)) return false;
  return true;
}

function daysSinceLogin(u) {
  if (!u || !u.ultimoLogin) return null;
  if (u.ultimoLogin === '1970-01-01T00:00:00.000Z') return null;
  const t = new Date(u.ultimoLogin).getTime();
  if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// Clasifica dónde está el agente en el flujo de suspensión por inactividad.
// Estados: 'active' · 'never-logged-in' · 'inactive' · 'notice-waiting' · 'notice-expired'
function classifyActivityStatus(u, wsData) {
  const noticeAt = wsData && wsData.preSuspensionNoticeSentAt
    ? new Date(wsData.preSuspensionNoticeSentAt).getTime() : null;
  if (noticeAt) {
    // Si volvió a loguearse tras el aviso, se considera activo (auto-limpieza suave).
    const loginTime = u && u.ultimoLogin ? new Date(u.ultimoLogin).getTime() : 0;
    if (loginTime > noticeAt) return 'active';
    const graceMs = PRE_SUSPENSION_GRACE_DAYS * 86400000;
    return (Date.now() - noticeAt >= graceMs) ? 'notice-expired' : 'notice-waiting';
  }
  const days = daysSinceLogin(u);
  if (days === null) return 'never-logged-in';
  if (days >= INACTIVITY_THRESHOLD_DAYS) return 'inactive';
  return 'active';
}

// Chips del Home para el flujo de agentes inactivos. Cuentan solo agentes
// con estado activo en Workspace. Tres chips: nunca-login (morado),
// inactivos-3m (amarillo), aviso-vencido (rojo).
async function _renderInactiveAgentsChips() {
  const chipNever = document.getElementById('home-alert-never-login');
  const chipA = document.getElementById('home-alert-inactive-noticeless');
  const chipB = document.getElementById('home-alert-notice-expired');
  if (!chipA || !chipB || !chipNever) return;
  try {
    // allUsers puede estar vacío si aún no se hizo "Cargar usuarios" en esta
    // sesión — silencio y ocultar chips hasta que exista data.
    if (!allUsers || !allUsers.length) {
      chipNever.style.display = 'none';
      chipA.style.display = 'none';
      chipB.style.display = 'none';
      return;
    }
    const [wsUsers, rolesMap] = await Promise.all([listWorkspaceUsers(), getHubUserRoles()]);
    const wsMap = {};
    (wsUsers || []).forEach(w => { wsMap[(w.email || '').toLowerCase()] = w; });
    _wsUsersMap = wsMap; // cache para filterUsers + renderActivityStatusBlock

    let neverLogin = 0;
    let inactiveNoticeless = 0;
    let noticeExpired = 0;
    allUsers.forEach(u => {
      if (u.estado !== 'activo') return;
      if (!isAgente(u, rolesMap)) return;
      const status = classifyActivityStatus(u, wsMap[(u.email || '').toLowerCase()]);
      if (status === 'never-logged-in') neverLogin++;
      else if (status === 'inactive') inactiveNoticeless++;
      else if (status === 'notice-expired') noticeExpired++;
    });

    if (neverLogin > 0) {
      document.getElementById('home-alert-never-count').textContent = String(neverLogin);
      document.getElementById('home-alert-never-plural').textContent = neverLogin === 1 ? '' : 's';
      document.getElementById('home-alert-never-plural2').textContent = neverLogin === 1 ? '' : 'n';
      chipNever.style.display = 'flex';
    } else {
      chipNever.style.display = 'none';
    }
    if (inactiveNoticeless > 0) {
      document.getElementById('home-alert-inactive-count').textContent = String(inactiveNoticeless);
      document.getElementById('home-alert-inactive-plural').textContent = inactiveNoticeless === 1 ? '' : 's';
      chipA.style.display = 'flex';
    } else {
      chipA.style.display = 'none';
    }
    if (noticeExpired > 0) {
      document.getElementById('home-alert-expired-count').textContent = String(noticeExpired);
      document.getElementById('home-alert-expired-plural').textContent = noticeExpired === 1 ? '' : 's';
      document.getElementById('home-alert-expired-plural2').textContent = noticeExpired === 1 ? '' : 's';
      chipB.style.display = 'flex';
    } else {
      chipB.style.display = 'none';
    }
  } catch (e) {
    console.warn('[inactive-agents-chips] error:', e && e.message);
  }
}

// Salta a Usuarios con el pill Actividad pre-configurado (para onclick del chip).
// Setea el select ANTES de showPage: como loadUsers termina llamando a
// filterUsers(), el filtro se aplica automáticamente cuando llegue la data.
function jumpToInactivityFilter(preset) {
  const sel = document.getElementById('usr-filter-actividad');
  if (sel) sel.value = preset;
  showPage('usuarios');
}

// Popula el bloque "Estado de actividad" del modal. Solo se muestra para agentes.
async function renderActivityStatusBlock(email, nombre) {
  const box = document.getElementById('um-actividad-box');
  const content = document.getElementById('um-actividad-content');
  if (!box || !content) return;
  box.style.display = 'none';
  while (content.firstChild) content.removeChild(content.firstChild);

  const u = (allUsers || []).find(x => (x.email || '').toLowerCase() === (email || '').toLowerCase());
  if (!u) return;
  const rolesMap = await getHubUserRoles();
  if (!isAgente(u, rolesMap)) return;

  const wsData = _wsUsersMap[(email || '').toLowerCase()] || await getWorkspaceUser(email);
  const status = classifyActivityStatus(u, wsData);
  const days = daysSinceLogin(u);
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' })
    : '—';
  // Fuentes del correo personal, en orden de prioridad:
  //   1. u.recoveryEmail — configurado por el propio usuario en Google Workspace
  //   2. wsData.personalEmail — poblado por IT (backfill) o al crear la cuenta
  //   3. prompt al enviar aviso — último recurso
  // El botón queda activo si tenemos (1) o (2). Si no, sigue activo pero al
  // hacer click abre un prompt para pedirlo.
  const hasPersonal = !!(u.recoveryEmail || (wsData && wsData.personalEmail));

  const card = document.createElement('div');
  card.style.cssText = 'padding:12px;border-radius:8px;';

  let dotColor = 'var(--hero-success)';
  let statusText = 'Activo';
  let detailText = u.ultimoLogin ? 'Último login: ' + fmtDate(u.ultimoLogin) : 'Sin registro de login';

  if (status === 'never-logged-in') {
    dotColor = '#7c3aed';
    statusText = 'Nunca ha iniciado sesión';
    detailText = 'Cuenta creada' + (u.creado ? ' el ' + fmtDate(u.creado) : '') + ' · sin registro de login';
    card.style.background = 'rgba(124,58,237,0.08)';
    card.style.border = '1px solid rgba(124,58,237,0.25)';
  } else if (status === 'inactive') {
    dotColor = '#e8a317';
    statusText = 'Inactivo ≥3m';
    detailText = 'Último login: ' + fmtDate(u.ultimoLogin) + ' (' + days + ' días)';
    card.style.background = 'rgba(232,163,23,0.08)';
    card.style.border = '1px solid rgba(232,163,23,0.25)';
  } else if (status === 'notice-waiting') {
    dotColor = '#e07b00';
    const noticeAt = wsData.preSuspensionNoticeSentAt;
    const deadlineMs = new Date(noticeAt).getTime() + PRE_SUSPENSION_GRACE_DAYS * 86400000;
    const deadline = new Date(deadlineMs);
    const daysLeft = Math.ceil((deadlineMs - Date.now()) / 86400000);
    statusText = 'Aviso enviado';
    detailText = 'Enviado el ' + fmtDate(noticeAt) + ' · plazo hasta ' + fmtDate(deadline.toISOString()) + ' (' + daysLeft + 'd)';
    card.style.background = 'rgba(224,123,0,0.08)';
    card.style.border = '1px solid rgba(224,123,0,0.25)';
  } else if (status === 'notice-expired') {
    dotColor = '#d64545';
    const noticeAt = wsData.preSuspensionNoticeSentAt;
    statusText = 'Aviso vencido';
    detailText = 'Aviso enviado el ' + fmtDate(noticeAt) + ' · plazo cumplido';
    card.style.background = 'rgba(214,69,69,0.08)';
    card.style.border = '1px solid rgba(214,69,69,0.25)';
  } else {
    card.style.background = 'rgba(34,160,107,0.06)';
    card.style.border = '1px solid rgba(34,160,107,0.20)';
  }

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;';
  const label = document.createElement('div');
  label.style.cssText = 'flex:1;';
  const labelTitle = document.createElement('div');
  labelTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--hero-text-primary);';
  labelTitle.textContent = statusText;
  const labelDetail = document.createElement('div');
  labelDetail.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);margin-top:2px;';
  labelDetail.textContent = detailText;
  label.appendChild(labelTitle);
  label.appendChild(labelDetail);
  header.appendChild(dot);
  header.appendChild(label);
  card.appendChild(header);

  if (status === 'inactive' || status === 'never-logged-in' || status === 'notice-expired') {
    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top:12px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    if (status === 'inactive' || status === 'never-logged-in') {
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'width:100%;font-size:13px;';
      btn.textContent = 'Enviar aviso previo';
      btn.title = hasPersonal
        ? 'Envía aviso al correo personal (registrado en Google Workspace o en Firestore).'
        : 'No hay correo personal registrado. Al hacer click se te pedirá uno para enviar el aviso.';
      btn.addEventListener('click', () => enviarAvisoInactividad(email, nombre));
    } else {
      btn.className = 'btn';
      btn.style.cssText = 'width:100%;font-size:13px;background:rgba(214,69,69,0.10);border:1px solid var(--hero-danger);color:var(--hero-danger);';
      btn.textContent = 'Suspender + notificar';
      btn.title = 'Suspende la cuenta en Workspace y notifica al correo personal.';
      btn.addEventListener('click', () => suspenderPorInactividad(email, nombre));
    }
    actions.appendChild(btn);
    card.appendChild(actions);
  }

  content.appendChild(card);
  box.style.display = 'block';
}

// Envía el aviso previo de suspensión por inactividad al correo personal del
// agente, marca `preSuspensionNoticeSentAt` en Firestore y refresca el modal.
// El botón solo debería llegar aquí si hay personalEmail — pero re-chequeamos
// por defensa en profundidad.
async function enviarAvisoInactividad(email, nombre) {
  var wsData = _wsUsersMap[(email || '').toLowerCase()] || await getWorkspaceUser(email) || {};
  var u = (allUsers || []).find(function(x) { return (x.email || '').toLowerCase() === (email || '').toLowerCase(); });
  // Cascada de fuentes del correo personal:
  //   1. recoveryEmail configurado en Google Workspace por el propio usuario
  //   2. personalEmail guardado en Firestore (backfill previo o alta reciente)
  //   3. Prompt on-the-fly al operador de IT
  var personalEmail = ((u && u.recoveryEmail) || wsData.personalEmail || '').trim();
  var fromRecovery = false;
  if (!personalEmail) {
    var input = window.prompt(
      'No hay correo personal registrado para ' + nombre + '.\n\n'
      + 'Escribe el correo personal donde enviar el aviso previo (@gmail.com, @yahoo, etc.):',
      ''
    );
    personalEmail = (input || '').trim();
    if (!personalEmail) {
      showToast('Aviso cancelado — no hay correo destino');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      alert('El correo no parece válido.');
      return;
    }
  } else if (u && u.recoveryEmail && !(wsData && wsData.personalEmail)) {
    fromRecovery = true;
  }

  var now = new Date();
  var deadline = new Date(now.getTime() + PRE_SUSPENSION_GRACE_DAYS * 86400000);
  var fmtDeadline = deadline.toLocaleDateString('es-ES', {
    timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric'
  });

  var ok = await heroConfirm({
    title: '¿Enviar aviso previo?',
    body: 'Se enviará un correo a ' + personalEmail + ' avisando a ' + nombre
        + ' que su cuenta corporativa será suspendida en 15 días (antes del '
        + fmtDeadline + ') si no detectamos actividad. La cuenta sigue activa mientras tanto.',
    confirmText: 'Enviar aviso',
  });
  if (!ok) return;

  addLog('Enviando aviso previo de inactividad a ' + personalEmail + '...', 'info');

  try {
    await sendOnboardingViaResend({
      from: 'Equipo de Hero Insurance USA <it@heroinsuranceusa.com>',
      to: personalEmail,
      subject: '[Hero Insurance] Tu cuenta corporativa está en riesgo de suspensión',
      html: buildEmailPreSuspension(nombre, email, fmtDeadline),
      text: 'Hola ' + nombre + ', notamos que tu cuenta corporativa ' + email
          + ' no registra inicios de sesión en los últimos 3 meses. En 15 días '
          + 'la suspenderemos si no detectamos actividad (antes del ' + fmtDeadline
          + '). Si aún la necesitas, inicia sesión antes de esa fecha o responde '
          + 'este correo. Escríbenos a it@heroinsuranceusa.com si necesitas ayuda.',
    });

    // Al persistir: si el email vino del prompt o del recoveryEmail y no
    // había registro en Firestore, guardarlo también para uso futuro.
    var saveData = {
      preSuspensionNoticeSentAt: now.toISOString(),
      preSuspensionDeadline: deadline.toISOString(),
      preSuspensionNoticeSentBy: 'it-console',
    };
    if (!(wsData && wsData.personalEmail)) {
      saveData.personalEmail = personalEmail;
      saveData.personalEmailSource = fromRecovery ? 'workspace-recovery' : 'it-prompt';
    }
    await saveWorkspaceUser(email, saveData);
    // Refresca el cache local para que el modal y los chips reflejen el nuevo estado
    // sin necesidad de otro fetch de Firestore.
    _wsUsersMap[(email || '').toLowerCase()] = Object.assign({}, wsData, saveData);

    auditLog('usuario', 'Aviso previo de inactividad enviado', email + ' → ' + personalEmail);
    addLog('Aviso previo enviado a ' + personalEmail, 'success');
    showToast('Aviso previo enviado. Plazo hasta ' + fmtDeadline);

    // Repinta el bloque del modal (Inactivo → Aviso enviado) y refresca chips.
    renderActivityStatusBlock(email, nombre);
    _renderInactiveAgentsChips();
  } catch (err) {
    addLog('Error enviando aviso previo: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

// Suspende la cuenta en Workspace + envía notificación al correo personal con
// el motivo "inactivity-noticed". Reusa /user-action y notificarSuspension del
// flujo estándar para no duplicar lógica (ambos ya guardan Firestore, envían
// email, hacen audit).
async function suspenderPorInactividad(email, nombre) {
  var wsData = _wsUsersMap[(email || '').toLowerCase()] || await getWorkspaceUser(email) || {};
  var noticeSentAt = wsData.preSuspensionNoticeSentAt
    ? new Date(wsData.preSuspensionNoticeSentAt).toLocaleDateString('en-US', {
        month:'2-digit', day:'2-digit', year:'numeric'
      })
    : null;

  var ok = await heroConfirm({
    title: '¿Suspender la cuenta por inactividad?',
    body: 'Se suspenderá la cuenta ' + email + ' en Workspace y se enviará '
        + 'notificación al correo personal informando la suspensión y el nuevo '
        + 'plazo de 15 días antes de la eliminación permanente.'
        + (noticeSentAt ? ' El aviso previo se envió el ' + noticeSentAt + '.' : ''),
    confirmText: 'Suspender + notificar',
    destructive: true,
  });
  if (!ok) return;

  addLog('Suspendiendo cuenta ' + email + ' por inactividad...', 'info');

  try {
    // (1) Suspender en Workspace via el endpoint existente
    var resp = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action: 'suspend' })
    });
    var result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error');
    addLog('Cuenta suspendida en Workspace', 'success');

    // (2) Notificar al personal + marcar scheduledDeletionAt (+15d) reusando
    // el helper existente. Motivo específico para diferenciar en el audit-log.
    var motivo = SUSPENSION_REASONS.find(function(r) { return r.key === 'inactivity-noticed'; })
              || SUSPENSION_REASONS.find(function(r) { return r.key === '3m'; });
    await notificarSuspension(email, nombre, motivo);

    auditLog('usuario', 'Cuenta suspendida por inactividad (con aviso previo)', email);
    showToast('Cuenta suspendida: ' + nombre);
    closeUserModal();
    loadUsers();
  } catch (err) {
    addLog('Error suspendiendo por inactividad: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

// ── Gestión de usuarios Workspace ────────────────────────────
let currentUserEmail = null;

function openUserModal(email, nombre) {
  currentUserEmail = email;
  document.getElementById('um-email').textContent = email;
  document.getElementById('um-nombre').textContent = nombre;
  document.getElementById('um-new-password').value = '';
  document.getElementById('user-modal').style.display = 'block';
  renderActivityStatusBlock(email, nombre);
}

// Envía el email de bienvenida oficial al Hub. Se dispara desde el modal de
// Usuarios cuando HR ya firmó los consents del empleado nuevo. Va al correo
// corporativo (@hero) que ya está activo tras el onboarding de Workspace.
async function enviarBienvenidaHub() {
  if (!currentUserEmail) return;
  const email  = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;

  const ok = await heroConfirm({
    title: '¿Enviar bienvenida al Hub?',
    body: 'Se enviará un correo a ' + email + ' dándole la bienvenida oficial al equipo e invitándolo a explorar el Hero Hub. Úsalo cuando HR ya haya firmado los consents.',
    confirmText: 'Enviar bienvenida',
  });
  if (!ok) return;

  addLog('Enviando bienvenida al Hub a ' + email + '...', 'info');

  try {
    await sendViaResend({
      to: email,
      subject: 'Bienvenido al Hero Hub — Hero Insurance USA',
      html: buildEmailBienvenidaHub(nombre, email),
      text: 'Bienvenido al equipo, ' + nombre + '. Accede al Hero Hub en https://hub.heroinsuranceusa.com',
    });
    addLog('Bienvenida al Hub enviada a ' + email, 'success');
    auditLog('usuario', 'Bienvenida al Hub enviada a ' + nombre, email);
    showToast('Bienvenida al Hub enviada');
    closeUserModal();
  } catch (err) {
    addLog('Error enviando bienvenida al Hub: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
  currentUserEmail = null;
}

function generateUserPassword() {
  const pwd = _generateStrongPassword();
  document.getElementById('um-new-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(() => {});
  showToast('Contraseña generada y copiada al portapapeles');
}

// Navega a una página técnica (onboarding, offboarding, reset) con el usuario
// del modal de Usuarios preseleccionado. Cada página lo consume en su autoLoad.
function goToFlowFor(flow) {
  if (!currentUserEmail) return;
  const email  = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;
  window._preselectedUser = { email, nombre };
  closeUserModal();
  showPage(flow);
}

function _consumePreselectedUser(target) {
  const u = window._preselectedUser;
  if (!u) return;
  window._preselectedUser = null;
  if (target === 'offboarding') {
    if (typeof selectOffboardingUser === 'function') selectOffboardingUser(u.email, u.nombre);
  } else if (target === 'reset') {
    if (typeof selectResetUser === 'function') selectResetUser(u.email, u.nombre, 'activo');
  } else if (target === 'onboarding') {
    const nameInput  = document.getElementById('onb-nombre');
    const emailInput = document.getElementById('onb-email-user');
    if (nameInput)  nameInput.value  = u.nombre || '';
    if (emailInput) emailInput.value = (u.email || '').split('@')[0];
    if (typeof onbPreview === 'function') onbPreview();
  }
}

async function userAction(action) {
  if (!currentUserEmail) return;
  const email  = currentUserEmail;
  const nombre = document.getElementById('um-nombre').textContent;

  const labels = { reset: 'resetear contraseña', suspend: 'suspender', restore: 'restaurar', delete: 'eliminar' };
  const newPassword = action === 'reset' ? document.getElementById('um-new-password').value.trim() : null;

  if (action === 'reset' && !newPassword) {
    showToast('Ingresa o genera una contraseña temporal primero'); return;
  }

  // Borrar cuenta es irreversible — confirmación fuerte que obliga a tipear el email.
  if (action === 'delete') {
    const ok = await heroConfirm({
      title: '¿Eliminar la cuenta de Workspace?',
      body: 'Vas a eliminar de forma permanente la cuenta de ' + nombre + ' (' + email + '). Esta acción no se puede deshacer.',
      confirmText: 'Eliminar definitivamente',
      destructive: true,
      mustType: email,
    });
    if (!ok) return;
  }

  // Suspender: pedir motivo ANTES de tocar Workspace. Si cancela el modal
  // del motivo, cancelamos toda la acción (no suspendemos "sin motivo").
  // Pre-selecciona motivo basado en ultimoLogin del usuario si tenemos ese dato.
  var motivoSuspend = null;
  if (action === 'suspend') {
    var userRecord = (window.allUsers || allUsers || []).find(function(u) { return u.email === email; });
    var hint = suggestSuspensionReasonKey(userRecord);
    motivoSuspend = await askSuspensionReason(nombre, email, hint);
    if (!motivoSuspend) return; // canceló → no suspende
  }

  // Restaurar: confirm simple. No requiere motivo (buena noticia) ni
  // type-to-confirm (no destructivo). Se enviará email al usuario avisando.
  if (action === 'restore') {
    const okRestore = await heroConfirm({
      title: '¿Reactivar la cuenta?',
      body: 'La cuenta de ' + nombre + ' (' + email + ') volverá a estar activa. Si tenemos su correo personal registrado, se le enviará un aviso.',
      confirmText: 'Reactivar',
    });
    if (!okRestore) return;
  }

  addLog('Ejecutando ' + labels[action] + ' para ' + email + '...', 'info');

  try {
    const resp = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action, newPassword })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error');

    const msgs = {
      reset:   'Contraseña reseteada para ' + nombre,
      suspend: 'Cuenta suspendida: ' + nombre,
      restore: 'Cuenta restaurada: ' + nombre,
      delete:  'Cuenta eliminada: ' + nombre,
    };
    addLog(msgs[action], 'success');
    auditLog('usuario', msgs[action], email);

    // #1 — Enviar email de notificación al usuario cuando se resetea su contraseña
    if (action === 'reset' && newPassword) {
      try {
        await sendViaResend({
          to: email,
          subject: 'Restablecimiento de contraseña - Hero Insurance USA',
          html: buildEmailReset(nombre, email, newPassword),
          text: 'Hola ' + nombre + ', tu contraseña ha sido restablecida. Correo: ' + email + ' / Nueva contraseña temporal: ' + newPassword,
        });
        addLog('Email de reset enviado a ' + email, 'success');
      } catch(emailErr) {
        addLog('Contraseña reseteada pero email falló: ' + emailErr.message, 'warn');
      }
    }

    // #2 — Al suspender: buscar personalEmail en Firestore, promptear si no
    // existe, mandar email de aviso + guardar scheduledDeletionAt (15 dias).
    // El motivo ya fue elegido arriba (askSuspensionReason).
    if (action === 'suspend') {
      await notificarSuspension(email, nombre, motivoSuspend);
    }

    // #3 — Al restaurar: limpiar scheduledDeletionAt del Firestore para
    // sacar la cuenta del contador "próximas eliminaciones" del dashboard,
    // y notificar al correo personal para cerrar el loop del email de suspensión.
    if (action === 'restore') {
      saveWorkspaceUser(email, {
        reactivatedAt: new Date().toISOString(),
        scheduledDeletionAt: null,
        suspendedAt: null,
      });
      await notificarReactivacion(email, nombre);
    }

    showToast(msgs[action]);
    closeUserModal();
    loadUsers();
  } catch (err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
}

// ── Selector de motivo de suspensión ─────────────────────────
// Modal con radio buttons de motivos predefinidos + opción "Otro" con
// textarea. Retorna Promise<{motivo:string} | null> donde null = canceló.
// Pre-selección inteligente: si el user nunca hizo login o hace >3/6 meses
// que no entra, pre-selecciona el motivo correspondiente. Ahorra clicks.
//
// El param `preselectHint` es el key del motivo a pre-marcar (o null).
// Valores válidos: 'never', '3m', '6m', 'contrato', 'renuncia', 'admin', 'otro'.
var SUSPENSION_REASONS = [
  { key: 'never',    label: 'Cuenta inactiva — nunca ha iniciado sesión',           text: 'porque la cuenta nunca fue utilizada (no se registró ningún inicio de sesión).' },
  { key: '3m',       label: 'Cuenta inactiva — sin login en los últimos 3 meses',   text: 'por falta de uso: no se ha detectado actividad en los últimos 3 meses.' },
  { key: '6m',       label: 'Cuenta inactiva — sin login en los últimos 6 meses',   text: 'por falta de uso prolongado: no se ha detectado actividad en los últimos 6 meses.' },
  // Motivo del flujo formal de agentes inactivos (aviso previo → 15d → suspender).
  { key: 'inactivity-noticed', label: 'Inactividad prolongada tras aviso previo sin respuesta', text: 'por inactividad prolongada tras el aviso previo enviado sin recibir respuesta.' },
  { key: 'contrato', label: 'Fin de contrato',                                       text: 'porque tu contrato con Hero Insurance USA finalizó.' },
  { key: 'renuncia', label: 'Renuncia',                                              text: 'como parte del proceso de desvinculación por renuncia.' },
  { key: 'admin',    label: 'Solicitud de la administración',                        text: 'por decisión de la administración.' },
  { key: 'otro',     label: 'Otro (especificar)',                                    text: null }
];

function askSuspensionReason(nombre, emailCorp, preselectHint) {
  return new Promise(function(resolve) {
    var modal = document.getElementById('suspension-reason-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'suspension-reason-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'display:block;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:1000;overflow-y:auto;padding:24px;';

    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid var(--hero-border);border-radius:14px;max-width:520px;margin:40px auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18);';

    var h = document.createElement('div');
    h.style.cssText = 'font-size:16px;font-weight:700;color:var(--hero-text-primary);margin-bottom:6px;';
    h.textContent = '¿Suspender cuenta de ' + nombre + '?';
    card.appendChild(h);

    var subh = document.createElement('div');
    subh.style.cssText = 'font-size:12px;color:var(--hero-text-muted);margin-bottom:16px;line-height:1.5;';
    subh.textContent = 'Selecciona el motivo. El usuario lo recibirá en el email de aviso.';
    card.appendChild(subh);

    var chosenKey = preselectHint || 'admin';
    var radios = [];

    SUSPENSION_REASONS.forEach(function(r) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--hero-border-card);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:all .12s;';
      lbl.dataset.key = r.key;

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'susp-reason';
      input.value = r.key;
      input.style.cssText = 'margin-top:2px;flex-shrink:0;accent-color:var(--hero-primary);';
      if (r.key === chosenKey) input.checked = true;
      radios.push(input);

      var text = document.createElement('span');
      text.style.cssText = 'font-size:13px;color:var(--hero-text-primary);line-height:1.4;';
      text.textContent = r.label;

      lbl.appendChild(input);
      lbl.appendChild(text);
      card.appendChild(lbl);

      lbl.addEventListener('click', function() {
        chosenKey = r.key;
        radios.forEach(function(ri) { ri.checked = (ri.value === r.key); });
        highlightSelected();
        toggleOtroField();
      });
    });

    var otroWrap = document.createElement('div');
    otroWrap.style.cssText = 'margin-top:8px;display:none;';
    var otroLbl = document.createElement('label');
    otroLbl.style.cssText = 'display:block;font-size:11px;color:var(--hero-text-muted);margin-bottom:4px;';
    otroLbl.textContent = 'Motivo personalizado (aparece tal cual en el email):';
    otroWrap.appendChild(otroLbl);
    var otroInput = document.createElement('textarea');
    otroInput.className = 'form-input';
    otroInput.rows = 3;
    otroInput.placeholder = 'ej. Retiro voluntario en periodo de prueba';
    otroInput.style.cssText = 'width:100%;font-family:inherit;font-size:13px;';
    otroWrap.appendChild(otroInput);
    card.appendChild(otroWrap);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px;';

    var btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-secondary';
    btnCancel.textContent = 'Cancelar';
    btnCancel.style.cssText = 'font-size:13px;';

    var btnOk = document.createElement('button');
    btnOk.className = 'btn btn-primary';
    btnOk.textContent = 'Suspender';
    btnOk.style.cssText = 'font-size:13px;background:linear-gradient(135deg,#c0392b,#a52917);';

    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);
    card.appendChild(actions);

    modal.appendChild(card);
    document.body.appendChild(modal);

    function highlightSelected() {
      Array.from(card.querySelectorAll('label[data-key]')).forEach(function(lbl) {
        var isChecked = lbl.dataset.key === chosenKey;
        lbl.style.borderColor = isChecked ? 'var(--hero-primary)' : 'var(--hero-border-card)';
        lbl.style.background = isChecked ? 'rgba(6,163,182,0.06)' : 'transparent';
      });
    }
    function toggleOtroField() {
      var isOtro = chosenKey === 'otro';
      otroWrap.style.display = isOtro ? 'block' : 'none';
      if (isOtro) setTimeout(function() { otroInput.focus(); }, 50);
    }

    highlightSelected();
    toggleOtroField();
    otroInput.addEventListener('input', function() {
      btnOk.disabled = chosenKey === 'otro' && !otroInput.value.trim();
    });
    if (chosenKey === 'otro') btnOk.disabled = true;

    function close(result) {
      modal.remove();
      resolve(result);
    }

    btnCancel.addEventListener('click', function() { close(null); });
    btnOk.addEventListener('click', function() {
      var r = SUSPENSION_REASONS.find(function(x) { return x.key === chosenKey; });
      var text = (r && r.text) || otroInput.value.trim();
      if (!text) return;
      close({ key: chosenKey, text: text, label: r ? r.label : 'Otro' });
    });

    // ESC cancela
    var onKey = function(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(null); }
    };
    document.addEventListener('keydown', onKey);
  });
}

// Sugerencia de motivo pre-seleccionado según la última fecha de login.
// El usuario aparece en la lista con `ultimoLogin` (ISO o vacío/'1970-...').
function suggestSuspensionReasonKey(user) {
  if (!user) return 'admin';
  var login = user.ultimoLogin;
  if (!login || login === '1970-01-01T00:00:00.000Z') return 'never';
  var days = (Date.now() - new Date(login).getTime()) / 86400000;
  if (days >= 180) return '6m';
  if (days >= 90) return '3m';
  return 'admin';
}

// ── Notificación al personal al suspender cuenta ─────────────
// Se llama SIEMPRE después de suspender exitosamente en Workspace.
// Recibe el motivo (elegido en askSuspensionReason antes de suspender).
// Flujo:
//   1. Busca personalEmail en Firestore shared/workspaceUsers/byEmail/{email}.
//   2. Si no lo tiene → prompt para escribirlo (dejar vacío para saltear).
//   3. Guarda suspendedAt + scheduledDeletionAt (+15 días) + motivo en Firestore
//      para que el chip de dashboard "próximas eliminaciones" lo detecte.
//   4. Si hay personalEmail → manda buildEmailSuspension al correo personal
//      con el motivo específico.
//   5. Nunca throws — errores se registran en addLog pero el suspend
//      principal ya fue exitoso, no queremos romper el flujo del modal.
async function notificarSuspension(emailCorp, nombre, motivo) {
  try {
    var registro = await getWorkspaceUser(emailCorp);
    // Cascada: personalEmail de Firestore → recoveryEmail de Workspace → prompt
    var personalEmail = (registro && registro.personalEmail) || '';
    if (!personalEmail) {
      var uWs = (allUsers || []).find(function(x) { return (x.email || '').toLowerCase() === (emailCorp || '').toLowerCase(); });
      if (uWs && uWs.recoveryEmail) personalEmail = uWs.recoveryEmail;
    }

    // Si no lo tenemos guardado, pedirlo. Vacío = saltear la notificación.
    if (!personalEmail) {
      var input = window.prompt(
        'No tenemos el correo personal de ' + nombre + '.\n\n'
        + 'Escríbelo para notificarle la suspensión (o deja vacío para saltear).\n'
        + 'Se guardará para futuras acciones sobre esta cuenta.',
        ''
      );
      personalEmail = (input || '').trim();
    }

    // Calcula fecha de eliminación programada (suspend + SUSPENSION_TO_DELETION_DAYS).
    var now = new Date();
    var scheduledDeletion = new Date(now);
    scheduledDeletion.setDate(scheduledDeletion.getDate() + SUSPENSION_TO_DELETION_DAYS);

    // Guarda el estado de suspensión en Firestore. Incluye personalEmail si
    // vino nuevo del prompt (permite backfill on-demand) y motivo/motivoKey
    // para trazabilidad de por qué se suspendió cada cuenta.
    var updateData = {
      suspendedAt: now.toISOString(),
      suspendedBy: 'it-console',
      scheduledDeletionAt: scheduledDeletion.toISOString(),
      reactivatedAt: null,
      suspendedReason: (motivo && motivo.text) || null,
      suspendedReasonKey: (motivo && motivo.key) || null,
    };
    if (personalEmail) updateData.personalEmail = personalEmail;
    saveWorkspaceUser(emailCorp, updateData);

    if (!personalEmail) {
      addLog('Cuenta suspendida sin correo personal registrado — no se notificó al usuario', 'warn');
      return;
    }

    // Manda email al personal. Usa el endpoint /email/onboarding que ya
    // acepta destinos externos (@gmail, @yahoo, etc.).
    var fechaLabel = scheduledDeletion.toLocaleDateString('es-ES', {
      timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric'
    });
    var motivoText = (motivo && motivo.text) || 'por decisión de la administración';
    try {
      await sendOnboardingViaResend({
        to: personalEmail,
        subject: 'Tu cuenta ' + emailCorp + ' fue suspendida — Hero Insurance USA',
        html: buildEmailSuspension(nombre, emailCorp, fechaLabel, motivoText),
        text: 'Hola ' + nombre + ', tu cuenta corporativa ' + emailCorp + ' fue suspendida ' + motivoText + ' '
            + 'Si no solicitas reactivación en los próximos 15 días (antes del ' + fechaLabel + '), '
            + 'la cuenta será eliminada permanentemente. '
            + 'Para solicitar reactivación escribe a it@heroinsuranceusa.com.',
      });
      addLog('Email de suspensión enviado a ' + personalEmail + ' (motivo: ' + (motivo && motivo.key || 'admin') + ')', 'success');
      auditLog('usuario', 'Aviso de suspensión enviado al personal · motivo: ' + (motivo && motivo.label || 'admin'), emailCorp + ' → ' + personalEmail);
    } catch (emailErr) {
      addLog('Cuenta suspendida pero aviso al personal falló: ' + emailErr.message, 'warn');
    }
  } catch (e) {
    console.warn('[notificarSuspension] error inesperado:', e && e.message);
  }
}

// ── Notificación al personal al reactivar cuenta ─────────────
// Cierra el loop que abrió el email de suspensión (donde prometimos que
// si el usuario solicitaba reactivación, podría volver). Se llama después
// de restaurar exitosamente en Workspace.
// Flujo:
//   1. Busca personalEmail en Firestore (guardado al crear o al suspender).
//   2. Si no lo tiene → warn silencioso. El restore ya sucedió, no
//      interrumpimos con prompts para casos donde IT reactiva y no espera
//      email (ej. reactivación técnica sin usuario detrás).
//   3. Si hay → manda buildEmailReactivation al correo personal.
async function notificarReactivacion(emailCorp, nombre) {
  try {
    var registro = await getWorkspaceUser(emailCorp);
    var personalEmail = (registro && registro.personalEmail) || '';
    if (!personalEmail) {
      addLog('Cuenta reactivada sin correo personal registrado — no se notificó al usuario', 'warn');
      return;
    }
    try {
      await sendOnboardingViaResend({
        to: personalEmail,
        subject: 'Tu cuenta ' + emailCorp + ' fue reactivada — Hero Insurance USA',
        html: buildEmailReactivation(nombre, emailCorp),
        text: 'Hola ' + nombre + ', tu cuenta corporativa ' + emailCorp + ' fue reactivada. '
            + 'Ya puedes iniciar sesión con normalidad en mail.google.com. '
            + 'Si tienes cualquier problema, escribe a it@heroinsuranceusa.com.',
      });
      addLog('Email de reactivación enviado a ' + personalEmail, 'success');
      auditLog('usuario', 'Aviso de reactivación enviado al personal', emailCorp + ' → ' + personalEmail);
    } catch (emailErr) {
      addLog('Cuenta reactivada pero aviso al personal falló: ' + emailErr.message, 'warn');
    }
  } catch (e) {
    console.warn('[notificarReactivacion] error inesperado:', e && e.message);
  }
}

// ── Módulo Auditoría ──────────────────────────────────────────
let allAuditEntradas = [];

const AUDIT_TIPO_COLOR = {
  email:   'var(--hero-primary)',
  reset:   'var(--hero-warning)',
  usuario: 'var(--hero-primary-dark)',
  ticket:  'var(--hero-success)',
};
const AUDIT_TIPO_ICON = {
  email: '<iconify-icon icon="tabler:mail"></iconify-icon>',
  reset: '<iconify-icon icon="tabler:key"></iconify-icon>',
  usuario: '<iconify-icon icon="tabler:user"></iconify-icon>',
  ticket: '<iconify-icon icon="tabler:ticket"></iconify-icon>',
};

async function loadAudit() {
  const btn = document.getElementById('btn-load-audit');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>';
  renderSkeleton(document.getElementById('audit-body'), { rows: 6 });
  try {
    const tipo = document.getElementById('audit-filter-tipo').value;
    const q    = document.getElementById('audit-search').value.trim();
    let endpoint = WORKER_URL + '/audit?limit=500';
    if (tipo) endpoint += '&tipo=' + tipo;
    if (q)    endpoint += '&q=' + encodeURIComponent(q);

    const resp = await authFetch(endpoint);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allAuditEntradas = data.entradas || [];
    renderAudit(allAuditEntradas, data.total);
    setLastUpdated('audit-last-updated');
  } catch(err) {
    renderError(document.getElementById('audit-body'), err, loadAudit);
  }
  btn.disabled = false;
  btn.innerHTML = '↺ Actualizar';
}

function searchAudit() {
  clearTimeout(window._auditSearchTimeout);
  window._auditSearchTimeout = setTimeout(loadAudit, 400);
}

function renderAudit(entradas, total) {
  const count = document.getElementById('audit-count');
  count.textContent = entradas.length + (total > entradas.length ? ' de ' + total : '') + ' entrada' + (entradas.length !== 1 ? 's' : '');

  const body = document.getElementById('audit-body');
  if (!entradas.length) {
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:mailbox"></iconify-icon></div><div class="log-empty-text">Sin entradas con estos filtros</div></div>';
    return;
  }

  body.innerHTML = entradas.map(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const color = AUDIT_TIPO_COLOR[e.tipo] || 'var(--hero-text-body)';
    const icon  = AUDIT_TIPO_ICON[e.tipo] || '●';
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--hero-border-card);">'
      + '<span style="font-size:14px;flex-shrink:0;margin-top:2px;">' + icon + '</span>'
      + '<div style="flex:1;min-width:0;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span style="font-size:13px;color:var(--hero-text-primary);font-weight:500;">' + escHtml(e.descripcion) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);flex-shrink:0;">' + fecha + ' ET</span>'
      + '</div>'
      + (e.detalle ? '<div style="font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);margin-top:3px;">' + escHtml(e.detalle) + '</div>' : '')
      + '<span style="font-family:var(--mono);font-size:10px;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';margin-top:4px;display:inline-block;">' + escHtml(e.tipo) + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

// Anti CSV-injection: si una celda empieza con = + - @ \t o \r, Excel/Sheets
// la trata como fórmula al abrir. Prefijamos con apostrofe (queda invisible
// al usuario) para que el contenido se vea como texto literal.
function csvCell(v) {
  const s = String(v == null ? '' : v);
  const needsEscape = /^[=+\-@\t\r]/.test(s);
  return '"' + (needsEscape ? "'" : '') + s.replace(/"/g, '""') + '"';
}

// Convierte una fila (array) en línea CSV escapando cada celda con csvCell.
function csvRow(arr) { return arr.map(csvCell).join(',') + '\n'; }

// Descarga un CSV con BOM UTF-8 (necesario para que Excel Windows interprete
// bien los caracteres acentuados como á, ñ, ó). Sheets también lo acepta sin
// problema. Devuelve la URL revocable para que el caller pueda cleanup.
function downloadCsv(csv, filename) {
  const BOM = String.fromCharCode(0xFEFF);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAuditCSV() {
  if (!allAuditEntradas.length) { showToast('Carga el historial primero'); return; }

  // Aplicar los filtros visibles (tipo + búsqueda) al export para que coincida
  // con lo que el usuario ve en pantalla.
  const tipo = (document.getElementById('audit-filter-tipo') || {}).value || '';
  const q    = ((document.getElementById('audit-search') || {}).value || '').toLowerCase();
  let entradas = allAuditEntradas;
  if (tipo) entradas = entradas.filter(e => e.tipo === tipo);
  if (q)    entradas = entradas.filter(e =>
    (e.descripcion || '').toLowerCase().includes(q) ||
    (e.detalle     || '').toLowerCase().includes(q) ||
    (e.usuario     || '').toLowerCase().includes(q)
  );

  let csv = csvRow(['Fecha ET', 'Tipo', 'Descripcion', 'Detalle', 'Usuario']);
  entradas.forEach(e => {
    const fecha = new Date(e.fecha).toLocaleString('es-MX', { timeZone: 'America/New_York' });
    csv += csvRow([fecha, e.tipo, e.descripcion, e.detalle || '', e.usuario || '']);
  });
  csv += csvRow(['Total', entradas.length]);

  const suffix = tipo ? '-' + tipo : '';
  downloadCsv(csv, 'hero-auditoria-' + new Date().toISOString().slice(0, 10) + suffix + '.csv');
  showToast('CSV exportado (' + entradas.length + ' entradas)');
}

// ── Módulo "Home" — cola priorizada + lanzador ────────────────
// Vista consolidada: tickets prioritarios abiertos + solicitudes que esperan
// a IT. Una sola página para que Fernando entre y sepa qué hacer primero.
async function loadHome() {
  // Saludo dinámico según la hora ET
  const hET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hET, 10);
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const auth = (() => { try { return JSON.parse(sessionStorage.getItem('hero_auth') || '{}'); } catch { return {}; } })();
  const nombre = (auth.nombre || '').split(' ')[0] || 'Fernando';
  const saludoEl = document.getElementById('home-saludo');
  if (saludoEl) saludoEl.textContent = saludo + ', ' + nombre;

  // Skeletons en las 2 secciones mientras carga
  renderSkeleton(document.getElementById('md-tickets'), { type: 'card', rows: 2 });
  renderSkeleton(document.getElementById('md-sols'),    { type: 'card', rows: 2 });

  let tickets = [], sols = [];
  try {
    const [t, s] = await Promise.all([
      authFetch(WORKER_URL + '/ticket'),
      authFetch(WORKER_URL + '/alta-agente'),
    ]);
    if (t.ok) tickets = (await t.json()).tickets || [];
    if (s.ok) sols    = (await s.json()).solicitudes || [];
  } catch (e) {
    addLog('Home: error cargando datos: ' + e.message, 'warn');
  }

  // 1. Tickets abiertos — todos, ordenados por prioridad (Urgente primero)
  // y luego por fecha (más viejos primero dentro de la misma prioridad).
  const PRIO_WEIGHT = { Urgente: 3, Alta: 2, Media: 1, Baja: 0 };
  const ticketsPri = tickets
    .filter(t => t.estado === 'abierto')
    .sort((a, b) => {
      const dw = (PRIO_WEIGHT[b.prioridad] || 0) - (PRIO_WEIGHT[a.prioridad] || 0);
      return dw !== 0 ? dw : new Date(a.fecha) - new Date(b.fecha);
    });

  // 2. Solicitudes que esperan a IT — pendiente o autorizada (autorizada =
  //    alguien aprobó pero IT aún no creó/eliminó la cuenta)
  const solsAccion = sols
    .filter(s => s.estado === 'pendiente' || s.estado === 'autorizada')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  // Stats
  const setStat = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setStat('home-stat-tickets', ticketsPri.length);
  setStat('home-stat-sols',    solsAccion.length);

  // Render cada sección (con empty state propio)
  _renderHomeTickets(ticketsPri);
  _renderHomeSols(solsAccion);

  // Alerta de cuentas suspendidas próximas a eliminar (background — no bloquea
  // el render del home si Firestore tarda o falla).
  _renderPendingDeletionsChip();
  _renderInactiveAgentsChips();
  // Bootstrap: si entramos al Home antes de haber visitado Usuarios en esta
  // sesión, allUsers está vacío y los chips del flujo de inactividad no
  // pueden contar nada. Dispara loadUsers en background — al terminar llama
  // a _renderInactiveAgentsChips y los chips aparecen sin intervención.
  if (!allUsers || !allUsers.length) {
    loadUsers();
  }
}

// Chip de alerta en el dashboard: cuentas suspendidas cuyo scheduledDeletionAt
// ya llegó (o pasó) y NO fueron reactivadas ni eliminadas. Se prometió al
// usuario que su cuenta se eliminaria a los 15 días si no solicitaba
// reactivación; este chip le recuerda a IT que ese plazo se cumplió.
async function _renderPendingDeletionsChip() {
  var alert = document.getElementById('home-alert-eliminaciones');
  if (!alert) return;
  try {
    var users = await listWorkspaceUsers();
    var now = Date.now();
    var pending = users.filter(function(u) {
      if (!u.scheduledDeletionAt) return false;
      if (u.reactivatedAt) return false;
      if (u.deletedAt) return false;
      return new Date(u.scheduledDeletionAt).getTime() <= now;
    });
    if (!pending.length) {
      alert.style.display = 'none';
      return;
    }
    document.getElementById('home-alert-count').textContent = pending.length;
    var plural = pending.length === 1 ? '' : 's';
    document.getElementById('home-alert-plural').textContent = plural;
    document.getElementById('home-alert-plural2').textContent = plural;
    document.getElementById('home-alert-plural3').textContent = pending.length === 1 ? '' : 'n';
    alert.style.display = 'flex';
  } catch (e) {
    console.warn('[pending-deletions] error:', e && e.message);
  }
}

function _renderHomeTickets(items) {
  const el = document.getElementById('md-tickets');
  if (!items.length) {
    renderEmpty(el, { icon: '<iconify-icon icon="tabler:circle-check" style="color:var(--hero-success);"></iconify-icon>', message: 'Sin tickets abiertos. Buen trabajo.' });
    return;
  }
  el.innerHTML = items.map(t => {
    const prioColor = (PRIORIDAD_COLOR && PRIORIDAD_COLOR[t.prioridad]) || { color: 'var(--hero-warning)', bg: 'rgba(232,163,23,0.12)' };
    const elapsed = getElapsedTime(t.fecha);
    const elColor = getElapsedColor(t.fecha, t.estado);
    return '<div class="action-card" style="cursor:pointer;padding:14px;" onclick="showPage(\'tickets\');setTimeout(() => openTicketModal(\'' + escJs(t.id) + '\'), 200)">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);margin-bottom:2px;">' + escHtml(t.ticketId || '') + '</div>'
      +     '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(t.asunto) + '</div>'
      +     '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">' + escHtml(t.nombre || '') + ' · ' + escHtml(t.categoria || '') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:12px;background:' + prioColor.bg + ';color:' + prioColor.color + ';">' + escHtml(t.prioridad) + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + elColor + ';">⏱ ' + elapsed + '</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function _renderHomeSols(items) {
  const el = document.getElementById('md-sols');
  if (!items.length) {
    renderEmpty(el, { icon: '<iconify-icon icon="tabler:circle-check" style="color:var(--hero-success);"></iconify-icon>', message: 'No hay solicitudes esperando acción.' });
    return;
  }
  el.innerHTML = items.map(s => {
    const isBaja = s.tipoSolicitud === 'baja';
    const tipoLabel = isBaja ? 'BAJA' : 'ALTA';
    const tipoColor = isBaja ? 'var(--hero-danger)' : 'var(--hero-primary-text)';
    const tipoBg    = isBaja ? 'rgba(214,69,69,0.10)' : 'rgba(6,163,182,0.10)';
    const titulo    = isBaja ? (s.nombre || '') : ((s.nombre || '') + ' ' + (s.apellido || '')).trim();
    const estadoBadge = s.estado === 'autorizada'
      ? '<iconify-icon icon="tabler:check"></iconify-icon> Autorizada'
      : '<iconify-icon icon="tabler:hourglass"></iconify-icon> Pendiente';
    const estadoColor = s.estado === 'autorizada' ? 'var(--hero-primary-text)' : 'var(--hero-warning)';
    const elapsed = getElapsedTime(s.fecha);
    return '<div class="action-card" style="cursor:pointer;padding:14px;" onclick="showPage(\'solicitudes\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + tipoBg + ';color:' + tipoColor + ';letter-spacing:1px;">' + tipoLabel + '</span>'
      +     '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);margin-top:4px;">' + escHtml(titulo) + '</div>'
      +     '<div style="font-size:11px;color:var(--hero-text-muted);margin-top:2px;">por ' + escHtml(s.solicitanteNombre || '?') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + estadoColor + ';">' + estadoBadge + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);">⏱ ' + elapsed + '</span>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

// ── Módulo Tickets de Soporte ─────────────────────────────────
let allTickets = [];
let currentTicketId = null;
let ticketView = 'kanban';

const PRIORIDAD_COLOR = {
  Baja:    { color: '#22a06b', bg: 'rgba(34,160,107,0.12)' },
  Media:   { color: '#e8a317', bg: 'rgba(232,163,23,0.12)'  },
  Alta:    { color: '#e8a317', bg: 'rgba(232,163,23,0.12)'  },
  Urgente: { color: '#d64545', bg: 'rgba(214,69,69,0.12)'   },
};

// Descarga un adjunto (Fase 3). El endpoint /ticket/attachment/:key requiere
// gate HMAC — un <a href> no puede llevarlo. Fetch + blob + open new tab.
async function verAdjunto(key, filename) {
  try {
    const resp = await authFetch(WORKER_URL + '/ticket/attachment/' + encodeURIComponent(key));
    if (!resp.ok) throw new Error('No se pudo obtener el adjunto (' + resp.status + ')');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      // Popup bloqueado — forzamos descarga con anchor invisible.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'adjunto';
      a.click();
    }
    // Libera el objectURL después de un rato para que el navegador no acumule.
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
  } catch (err) {
    showToast('Error abriendo adjunto: ' + err.message);
    addLog('Error adjunto: ' + err.message, 'error');
  }
}

// Impacto (Fase 4): color y label para la tarjeta Kanban. Los tickets viejos
// no tienen `impacto` — el render lo omite si undefined.
const IMPACTO_COLOR = {
  bloqueante: { color: '#d64545', bg: 'rgba(214,69,69,0.12)' },
  parcial:    { color: '#e07b00', bg: 'rgba(224,123,0,0.12)' },
  molestia:   { color: '#22a06b', bg: 'rgba(34,160,107,0.12)' },
};
const IMPACTO_LABEL = {
  bloqueante: 'Bloqueante',
  parcial:    'Parcial',
  molestia:   'Molestia',
};

const QUICK_REPLIES = {
  revisando: 'Hola, hemos recibido tu ticket y estamos revisando el problema. Te contactaremos pronto con una solución.',
  info:      'Hola, para poder ayudarte necesitamos información adicional. ¿Podrías indicarnos...?',
  resuelto:  'Hola, hemos resuelto el problema reportado. Por favor verifica que todo funcione correctamente. Si el problema persiste, no dudes en contactarnos.',
  remoto:    'Hola, para resolver este problema necesitamos conectarnos remotamente a tu equipo via Zoho Assist. ¿Cuándo tienes disponibilidad?',
};

// Plantillas de casos recurrentes. Cada una carga una respuesta lista para
// enviar al usuario + muestra un checklist de diagnóstico (sólo informativo,
// no se envía) para que Fernando no se olvide de los pasos típicos.
const TICKET_TEMPLATES = [
  {
    id: 'vpn', icon: '<iconify-icon icon="tabler:shield-lock"></iconify-icon>', nombre: 'VPN no conecta',
    respuesta: 'Hola, recibimos tu reporte sobre la VPN.\n\nProbemos lo siguiente en orden:\n1. Desconecta el cliente VPN completamente.\n2. Reinicia tu router (60 segundos sin corriente).\n3. Vuelve a conectar la VPN.\n\nSi sigue sin funcionar, dinos el mensaje exacto que te aparece al intentar conectar (una captura sería ideal).',
    checklist: [
      'Verificar credenciales del usuario',
      'Revisar estado del servidor VPN (down? rebooting?)',
      'Confirmar que no hay bloqueo geo/IP por país',
      'Probar desde otra red (hotspot móvil) para descartar el ISP',
    ],
  },
  {
    id: 'outlook', icon: '<iconify-icon icon="tabler:mail"></iconify-icon>', nombre: 'Outlook lento o no abre',
    respuesta: 'Hola, recibimos tu reporte de Outlook.\n\nPor favor probá esto en orden:\n1. Cerrá Outlook completamente.\n2. Abrelo manteniendo presionada la tecla Ctrl (modo seguro).\n3. Si abre rápido en modo seguro, hay un complemento que lo ralentiza.\n\nContame cómo te fue y, si seguís con problemas, agendamos un soporte remoto.',
    checklist: [
      '¿Funciona en modo seguro?',
      'Tamaño del PST/OST (si pasa 20 GB pesa)',
      'Add-ins instalados (deshabilitar uno por uno)',
      'Caché de auto-complete corrupta (limpiar con archivo .NK2 o cmd:/cleanautocompletecache)',
    ],
  },
  {
    id: 'pwd', icon: '<iconify-icon icon="tabler:key"></iconify-icon>', nombre: 'Contraseña olvidada',
    respuesta: 'Hola, recibimos tu solicitud de reset de contraseña.\n\nEn unos minutos te envío una contraseña temporal a este mismo correo. Al ingresar con ella el sistema te va a pedir que la cambies por una nueva tuya.\n\nNo la compartas con nadie ni la guardes en texto plano.',
    checklist: [
      'Confirmar identidad del usuario (foto + correo conocido)',
      'Generar nueva pwd desde Reset Password',
      'Forzar cambio en próximo login (default ON)',
      'Registrar la acción en Auditoría (se hace solo al usar el módulo)',
    ],
  },
  {
    id: 'wifi', icon: '<iconify-icon icon="tabler:wifi"></iconify-icon>', nombre: 'Wifi débil o inestable',
    respuesta: 'Hola, recibimos tu reporte de problemas con el Wifi.\n\nPara diagnosticarlo necesito un par de datos:\n1. ¿En qué piso/oficina estás?\n2. ¿El problema es solo en tu equipo o también pasa con el celular en la misma red?\n3. ¿Hay momentos del día puntuales donde es peor?\n\nCon esa info vemos si es el equipo, el AP o la red en general.',
    checklist: [
      'Speedtest en cable vs wifi (descarta el ISP)',
      'Signal strength y canal del AP más cercano',
      'Probar con cable ethernet directo',
      'Considerar reubicación del AP si el área tiene mucho concreto',
    ],
  },
  {
    id: 'printer', icon: '<iconify-icon icon="tabler:printer"></iconify-icon>', nombre: 'Impresora no funciona',
    respuesta: 'Hola, recibimos tu reporte de la impresora.\n\nProbemos esto:\n1. Confirmá que la impresora esté encendida y conectada a la red.\n2. Revisá que no haya papel atascado ni tóner agotado.\n3. Avisame qué impresora es (modelo) y qué mensaje te aparece — con eso reinicio el spooler desde mi equipo.',
    checklist: [
      'Modelo + ubicación de la impresora',
      'Estado de la cola de impresión (vaciar si está colgada)',
      'Reinstalar driver si el ping al IP de la impresora no responde',
      'Verificar contadores de tóner/tinta',
    ],
  },
  {
    id: 'lentitud', icon: '<iconify-icon icon="tabler:hourglass-low"></iconify-icon>', nombre: 'Equipo lento en general',
    respuesta: 'Hola, recibimos tu reporte de lentitud.\n\nVamos a hacer un primer diagnóstico:\n1. Reiniciá el equipo (no apagar/encender, sino Reiniciar desde el menú).\n2. Después del reinicio, esperá 5 minutos sin tocar nada y proba de nuevo.\n3. Si sigue lento, agendá un soporte remoto y revisamos juntos.',
    checklist: [
      'Memoria RAM ocupada (Task Manager → Memoria)',
      'Disco al 100% (revisar antivirus o búsqueda de Windows indexando)',
      'Procesos consumidores: Chrome/Teams/Antivirus',
      'Espacio en C: (<10% libre = lento)',
      'Considerar limpieza de archivos temporales + reinicio',
    ],
  },
  {
    id: 'office', icon: '<iconify-icon icon="tabler:file-text"></iconify-icon>', nombre: 'Office no activa / sale "Producto sin licencia"',
    respuesta: 'Hola, recibimos tu reporte de activación de Office.\n\nLo más rápido es:\n1. Cerrá todas las apps de Office.\n2. Abrí Word.\n3. Archivo → Cuenta → "Iniciar sesión" con tu correo @heroinsuranceusa.com\n4. Si ya estás logueado, click en "Actualizar licencia".\n\nSi sigue sin activar, agendamos remoto.',
    checklist: [
      'Confirmar que la cuenta de Workspace tenga licencia Office asignada',
      'Verificar que el equipo no esté con otra cuenta vieja loggeada',
      'Limpiar credenciales en Administrador de Credenciales de Windows',
      'Último recurso: desinstalar + reinstalar Office desde portal',
    ],
  },
];

function toggleTicketTemplates() {
  const panel = document.getElementById('ticket-templates-panel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.innerHTML = '<div style="font-size:10px;color:var(--hero-text-muted);margin-bottom:8px;letter-spacing:1px;text-transform:uppercase;">Elige una plantilla — carga respuesta + checklist</div>'
    + TICKET_TEMPLATES.map(t =>
        '<button onclick="loadTicketTemplate(\'' + escJs(t.id) + '\')" class="btn btn-secondary" style="font-size:11px;padding:5px 10px;margin:2px;">'
        + t.icon + ' ' + escHtml(t.nombre)
        + '</button>'
      ).join('');
  panel.style.display = 'block';
}

function loadTicketTemplate(id) {
  const t = TICKET_TEMPLATES.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-respuesta').value = t.respuesta;
  const cl = document.getElementById('ticket-checklist');
  cl.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--hero-primary-text);margin-bottom:6px;">Checklist de diagnóstico · ' + escHtml(t.nombre) + '</div>'
    + '<ul style="margin:0;padding-left:18px;font-size:12px;color:var(--hero-text-body);line-height:1.7;">'
    + t.checklist.map(c => '<li>' + escHtml(c) + '</li>').join('')
    + '</ul>';
  cl.style.display = 'block';
  document.getElementById('ticket-templates-panel').style.display = 'none';
  showToast('Plantilla "' + t.nombre + '" cargada');
}

function setTicketView(view) {
  ticketView = view;
  persistState('ticket_view', view);
  document.getElementById('tickets-kanban').style.display = view === 'kanban' ? 'grid' : 'none';
  document.getElementById('tickets-list').style.display   = view === 'list'   ? 'block' : 'none';
  document.getElementById('btn-view-kanban').style.background = view === 'kanban' ? 'var(--hero-primary-hover)' : 'transparent';
  document.getElementById('btn-view-kanban').style.color      = view === 'kanban' ? '#fff' : 'var(--hero-text-muted)';
  document.getElementById('btn-view-list').style.background   = view === 'list'   ? 'var(--hero-primary-hover)' : 'transparent';
  document.getElementById('btn-view-list').style.color        = view === 'list'   ? '#fff' : 'var(--hero-text-muted)';
  filterTickets();
}

// Tabs mobile en kanban: muestra sólo la columna activa cuando width < 900px.
// En desktop no afecta nada (las 3 columnas se ven siempre).
function setKanbanTab(estado) {
  document.querySelectorAll('#tickets-kanban .kanban-col').forEach(col => {
    col.classList.toggle('mobile-active', col.dataset.estado === estado);
  });
}

function getElapsedTime(fechaStr) {
  const diff = Date.now() - new Date(fechaStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0)  return d + 'd';
  if (h > 0)  return h + 'h';
  return Math.floor(diff / 60000) + 'm';
}

function getElapsedColor(fechaStr, estado) {
  if (estado === 'resuelto') return 'var(--hero-success)';
  const h = (Date.now() - new Date(fechaStr).getTime()) / 3600000;
  if (h > 24) return 'var(--hero-danger)';
  if (h > 8)  return '#e8a317';
  return 'var(--hero-text-muted)';
}

async function loadTickets() {
  // Restaurar preferencias UI guardadas (vista kanban/lista, filtros prioridad/categoría)
  const prioSel = document.getElementById('ticket-filter-prioridad');
  const catSel  = document.getElementById('ticket-filter-categoria');
  if (prioSel) prioSel.value = restoreState('ticket_filter_prioridad', '');
  if (catSel)  catSel.value  = restoreState('ticket_filter_categoria', '');
  const savedView = restoreState('ticket_view', 'kanban');
  if (savedView !== ticketView) setTicketView(savedView);

  // Skeleton mientras carga — el render real lo reemplaza al llegar la respuesta
  if (ticketView === 'kanban') {
    ['cards-abierto', 'cards-en-progreso', 'cards-resuelto'].forEach(id =>
      renderSkeleton(document.getElementById(id), { type: 'card', rows: 2 })
    );
  } else {
    renderSkeleton(document.getElementById('tickets-list'), { rows: 5 });
  }

  const btn = document.getElementById('btn-load-tickets');
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }
  try {
    const resp = await authFetch(WORKER_URL + '/ticket');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allTickets = data.tickets || [];
    filterTickets();
    setLastUpdated('tickets-last-updated');
    addLog('Tickets cargados: ' + allTickets.length, 'info');
  } catch(err) {
    addLog('Error cargando tickets: ' + err.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Actualizar'; }
}

function filterTickets() {
  const prioridad  = document.getElementById('ticket-filter-prioridad')?.value || '';
  const categoria  = document.getElementById('ticket-filter-categoria')?.value  || '';
  const q          = document.getElementById('ticket-search')?.value.toLowerCase() || '';
  // Persistimos las selects (no la búsqueda — esa es per-sesión).
  persistState('ticket_filter_prioridad', prioridad);
  persistState('ticket_filter_categoria', categoria);
  let filtered = allTickets;
  if (prioridad) filtered = filtered.filter(t => t.prioridad === prioridad);
  if (categoria) filtered = filtered.filter(t => t.categoria === categoria);
  if (q)         filtered = filtered.filter(t =>
    (t.asunto||'').toLowerCase().includes(q) || (t.nombre||'').toLowerCase().includes(q)
  );
  const count = document.getElementById('tickets-count');
  if (count) count.textContent = filtered.length + ' ticket' + (filtered.length !== 1 ? 's' : '');

  if (ticketView === 'kanban') renderKanban(filtered);
  else renderTicketList(filtered);
}

function renderKanban(tickets) {
  const cols = { 'abierto': [], 'en progreso': [], 'resuelto': [] };
  tickets.forEach(t => { if (cols[t.estado] !== undefined) cols[t.estado].push(t); });

  Object.entries(cols).forEach(([estado, items]) => {
    const key = estado.replace(' ', '-');
    const countEl = document.getElementById('count-' + key);
    const cardsEl = document.getElementById('cards-' + key);
    if (countEl) countEl.textContent = items.length;
    if (!cardsEl) return;
    if (!items.length) {
      cardsEl.innerHTML = '<div style="text-align:center;padding:20px;font-size:11px;color:var(--hero-text-muted);opacity:0.6;">Sin tickets</div>';
      return;
    }
    cardsEl.innerHTML = items.map(t => {
      const pc = PRIORIDAD_COLOR[t.prioridad] || PRIORIDAD_COLOR.Media;
      const elapsed = getElapsedTime(t.fecha);
      const elColor = getElapsedColor(t.fecha, t.estado);
      // Impacto y equipo son campos nuevos (Fase 4). Tickets viejos no los tienen.
      const ic = IMPACTO_COLOR[t.impacto] || null;
      const impactoLabel = IMPACTO_LABEL[t.impacto] || '';
      const equipoTxt = t.equipo ? escHtml(t.equipo) : '';
      const impactoBadge = ic
        ? '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + ic.bg + ';color:' + ic.color + ';font-weight:600;">' + escHtml(impactoLabel) + '</span>'
        : '';
      const metaImpacto = (impactoBadge || equipoTxt)
        ? '<div class="kanban-card-meta" style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
          + impactoBadge
          + (equipoTxt ? '<span style="font-size:11px;color:var(--hero-text-muted);">' + equipoTxt + '</span>' : '')
          + '</div>'
        : '';
      // Badge de adjuntos (Fase 3 — preparado, se activa cuando t.adjuntos exista)
      const nAdj = Array.isArray(t.adjuntos) ? t.adjuntos.length : 0;
      const adjBadge = nAdj > 0
        ? '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:rgba(107,122,144,0.15);color:var(--hero-text-muted);font-weight:600;" title="' + nAdj + ' adjunto' + (nAdj === 1 ? '' : 's') + '">📎 ' + nAdj + '</span>'
        : '';
      return '<div class="kanban-card" style="--card-pcolor:' + pc.color + ';" onclick="openTicketModal(\'' + t.id + '\')">'
        + '<div class="kanban-card-title">' + escHtml(t.asunto) + '</div>'
        + '<div class="kanban-card-meta">' + escHtml(t.nombre) + ' · ' + escHtml(t.categoria) + '</div>'
        + metaImpacto
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:8px;">'
        + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + escHtml(t.prioridad) + '</span>'
        + '<div style="display:flex;align-items:center;gap:6px;">'
        + adjBadge
        + '<span class="kanban-card-time" style="color:' + elColor + ';">⏱ ' + elapsed + '</span>'
        + '</div>'
        + '</div></div>';
    }).join('');
  });
}

function renderTicketList(tickets) {
  const container = document.getElementById('tickets-list');
  if (!tickets.length) {
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:mailbox"></iconify-icon></div><div style="font-size:12px;color:var(--hero-text-muted);">Sin tickets</div></div>';
    return;
  }
  const estadoColor = { 'abierto': '#d64545', 'en progreso': '#e8a317', 'resuelto': '#22a06b' };
  container.innerHTML = tickets.map(t => {
    const pc = PRIORIDAD_COLOR[t.prioridad] || PRIORIDAD_COLOR.Media;
    const elapsed = getElapsedTime(t.fecha);
    const elColor = getElapsedColor(t.fecha, t.estado);
    return '<div class="action-card" style="margin-bottom:10px;cursor:pointer;--card-color:' + (estadoColor[t.estado]||'var(--hero-border)') + ';" onclick="openTicketModal(\'' + t.id + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">' + escHtml(t.ticketId) + '</span>'
      + '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:' + pc.bg + ';color:' + pc.color + ';font-weight:600;">' + escHtml(t.prioridad) + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:10px;color:' + elColor + ';font-family:var(--mono);">⏱ ' + elapsed + '</span>'
      + '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.05);color:' + (estadoColor[t.estado]||'#444') + ';">' + escHtml(t.estado) + '</span>'
      + '</div></div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + escHtml(t.asunto) + '</div>'
      + '<div style="font-size:12px;color:var(--hero-text-muted);">' + escHtml(t.nombre) + ' · ' + escHtml(t.categoria) + '</div>'
      + '</div>';
  }).join('');
}

function openTicketModal(id) {
  const t = allTickets.find(x => x.id === id);
  if (!t) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-id').textContent = t.ticketId;
  document.getElementById('modal-asunto').textContent    = t.asunto;
  document.getElementById('modal-nombre').textContent    = t.nombre;
  document.getElementById('modal-email').textContent     = t.email;
  document.getElementById('modal-categoria').textContent = 'Categoría: ' + t.categoria;
  document.getElementById('modal-equipo').textContent = 'Equipo: ' + (t.equipo || '—');

  // Prioridad como badge read-only — el server la calcula desde impacto+categoría.
  // IT reevalúa el impacto abajo, y el server recalcula la prioridad al guardar.
  const prioBadge = document.getElementById('modal-prioridad-badge');
  const pc = PRIORIDAD_COLOR[t.prioridad] || PRIORIDAD_COLOR.Media;
  prioBadge.textContent = 'Prioridad: ' + (t.prioridad || '—');
  prioBadge.style.background = pc.bg;
  prioBadge.style.color = pc.color;

  // Impacto como badge (visual) — también editable abajo en el bloque de acciones.
  const impBadge = document.getElementById('modal-impacto-badge');
  const ic = IMPACTO_COLOR[t.impacto] || { color: 'var(--hero-text-muted)', bg: 'rgba(120,120,120,0.10)' };
  const impLabelText = IMPACTO_LABEL[t.impacto] || '—';
  impBadge.textContent = 'Impacto: ' + impLabelText;
  impBadge.style.background = ic.bg;
  impBadge.style.color = ic.color;
  // Adjuntos (Fase 3 — sección oculta si no hay). Preparado para cuando el
  // backend empiece a poblar t.adjuntos como [{key, filename, size, mime}].
  const adjBox = document.getElementById('modal-adjuntos-box');
  const adjList = document.getElementById('modal-adjuntos-list');
  if (adjBox && adjList) {
    while (adjList.firstChild) adjList.removeChild(adjList.firstChild);
    const adj = Array.isArray(t.adjuntos) ? t.adjuntos : [];
    if (adj.length > 0) {
      adj.forEach(function(a) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--hero-bg);border:1px solid var(--hero-border);border-radius:6px;';
        const name = document.createElement('span');
        name.style.cssText = 'font-size:12px;color:var(--hero-text-body);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        name.textContent = a.filename || a.key || '(adjunto)';
        // Botón que hace fetch autenticado (el endpoint requiere gate HMAC —
        // un <a href> plano no lleva Authorization). Abre el resultado en una
        // pestaña nueva vía blob URL, se autoborra a los 60s.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Ver ↗';
        btn.style.cssText = 'background:transparent;border:none;font-size:11px;color:var(--hero-primary);cursor:pointer;font-weight:600;flex-shrink:0;';
        btn.addEventListener('click', function() { verAdjunto(a.key, a.filename); });
        row.appendChild(name);
        row.appendChild(btn);
        adjList.appendChild(row);
      });
      adjBox.style.display = 'block';
    } else {
      adjBox.style.display = 'none';
    }
  }
  const fecha = new Date(t.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('modal-fecha').textContent = fecha + ' ET';
  const elEl = document.getElementById('modal-elapsed');
  elEl.textContent = '⏱ Abierto hace ' + getElapsedTime(t.fecha);
  elEl.style.color = getElapsedColor(t.fecha, t.estado);
  document.getElementById('modal-descripcion').textContent = t.descripcion;
  document.getElementById('modal-estado').value    = t.estado;
  document.getElementById('modal-respuesta').value = '';
  // Notificar al usuario: default ON. Se puede destildar para correcciones
  // silenciosas (ej. reabrir un ticket cerrado por error sin re-molestar).
  const notifyEl = document.getElementById('modal-notify');
  if (notifyEl) notifyEl.checked = true;
  // Reset paneles de plantilla al abrir cada ticket
  const tplPanel = document.getElementById('ticket-templates-panel');
  if (tplPanel) tplPanel.style.display = 'none';
  const tplCheck = document.getElementById('ticket-checklist');
  if (tplCheck) tplCheck.style.display = 'none';

  // Historial
  const hist = t.historial || [];
  const histBox = document.getElementById('modal-historial-box');
  if (hist.length) {
    histBox.style.display = 'block';
    document.getElementById('modal-historial').innerHTML = hist.map(h => {
      const f = new Date(h.fecha).toLocaleString('es-MX', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      if (h.tipo === 'estado')    return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);"><iconify-icon icon="tabler:clipboard-list"></iconify-icon> Estado: <strong>' + h.de + '</strong> → <strong>' + h.a + '</strong> · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      if (h.tipo === 'impacto') {
        const deImp = IMPACTO_LABEL[h.de] || h.de || '—';
        const aImp  = IMPACTO_LABEL[h.a]  || h.a  || '—';
        const prio  = h.prioridadDe && h.prioridadA && h.prioridadDe !== h.prioridadA
          ? ' · Prioridad: <strong>' + h.prioridadDe + '</strong> → <strong>' + h.prioridadA + '</strong>'
          : '';
        return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);"><iconify-icon icon="tabler:arrows-transfer-up"></iconify-icon> Impacto: <strong>' + deImp + '</strong> → <strong>' + aImp + '</strong>' + prio + ' · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      }
      if (h.tipo === 'respuesta') return '<div style="font-size:12px;color:var(--hero-text-muted);padding:4px 0;border-bottom:1px solid var(--hero-border);"><iconify-icon icon="tabler:message-circle"></iconify-icon> Respuesta enviada · <span style="font-family:var(--mono);font-size:10px;">' + f + '</span></div>';
      return '';
    }).join('');
  } else {
    histBox.style.display = 'none';
  }

  document.getElementById('ticket-modal').style.display = 'block';
}

function closeTicketModal() {
  document.getElementById('ticket-modal').style.display = 'none';
  currentTicketId = null;
}

function setQuickReply(key) {
  const ta = document.getElementById('modal-respuesta');
  ta.value = QUICK_REPLIES[key] || '';
  ta.focus();
  // Auto-cambia el estado del dropdown según la intención del quick reply.
  // Revisando → en progreso. Resuelto → resuelto. Los otros no tocan estado.
  const estadoEl = document.getElementById('modal-estado');
  if (estadoEl) {
    if (key === 'revisando') estadoEl.value = 'en progreso';
    else if (key === 'resuelto') estadoEl.value = 'resuelto';
  }
}

async function guardarTicket() {
  if (!currentTicketId) return;
  const btn = document.getElementById('btn-guardar-ticket');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';
  try {
    const estado    = document.getElementById('modal-estado').value;
    const respuesta = document.getElementById('modal-respuesta').value.trim();
    const notificar = document.getElementById('modal-notify').checked;
    const resp = await authFetch(WORKER_URL + '/ticket/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentTicketId, estado, respuesta: respuesta || null, notificar })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error');
    const t = allTickets.find(x => x.id === currentTicketId);
    auditLog('ticket', 'Ticket ' + (t ? t.ticketId : '') + ' actualizado → ' + estado, respuesta ? 'Respuesta enviada' : null);
    showToast(respuesta ? 'Respuesta enviada al usuario' : 'Ticket actualizado');
    closeTicketModal();
    loadTickets();
  } catch(err) {
    addLog('Error: ' + err.message, 'error');
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar y notificar usuario';
}

// ── Módulo Solicitudes ────────────────────────────────────────
let allSolicitudes = [];
let solFilter = 'all';
let solModalData = null;

function setSolFilter(filter) {
  solFilter = filter;
  persistState('sol_filter', filter);
  document.querySelectorAll('.sol-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  renderSolicitudes();
}

async function loadSolicitudes() {
  // Restaurar filtro guardado (Todas / Pendientes / Procesadas)
  const savedFilter = restoreState('sol_filter', 'all');
  if (savedFilter !== solFilter) {
    solFilter = savedFilter;
    document.querySelectorAll('.sol-filter-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.filter === solFilter);
    });
  }
  renderSkeleton(document.getElementById('sol-list'), { type: 'card', rows: 3 });
  const btn = document.getElementById('btn-load-sol');
  if (btn) { btn.disabled = true; btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring>'; }
  try {
    const resp = await authFetch(WORKER_URL + '/alta-agente');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allSolicitudes = data.solicitudes || [];
    updateSolStats();
    renderSolicitudes();
  } catch(err) {
    document.getElementById('sol-list').innerHTML =
      '<div class="info-box" style="text-align:center;padding:32px;border-color:rgba(214,69,69,0.3);">'
      + '<div style="color:var(--hero-danger);font-size:12px;">Error: ' + err.message + '</div></div>';
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '↺ Actualizar'; }
}

function updateSolStats() {
  const total   = allSolicitudes.length;
  const pending = allSolicitudes.filter(s => s.estado === 'pendiente').length;
  const auth    = allSolicitudes.filter(s => s.estado === 'autorizada').length;
  // El contador "done" del Console agrupa autorizadas+procesadas como "no pendientes"
  // (los autorizadores ya autorizaron — el procesamiento por IT puede seguir abierto).
  const done    = total - pending;
  const elT = document.getElementById('sol-stat-total');
  const elP = document.getElementById('sol-stat-pending');
  const elA = document.getElementById('sol-stat-auth');
  const elD = document.getElementById('sol-stat-done');
  if (elT) elT.textContent = total;
  if (elP) elP.textContent = pending;
  if (elA) elA.textContent = auth;
  if (elD) elD.textContent = done;
}

function renderSolicitudes() {
  const q = (document.getElementById('sol-search')?.value || '').toLowerCase();
  let filtered = allSolicitudes;
  if (solFilter !== 'all') filtered = filtered.filter(s => s.estado === solFilter);
  if (q) filtered = filtered.filter(s =>
    (s.nombre||'').toLowerCase().includes(q) ||
    (s.apellido||'').toLowerCase().includes(q) ||
    (s.correo||'').toLowerCase().includes(q) ||
    (s.correoPersonal||'').toLowerCase().includes(q) ||
    (s.correoEliminar||'').toLowerCase().includes(q) ||
    (s.solicitanteNombre||'').toLowerCase().includes(q)
  );

  const countEl = document.getElementById('sol-count');
  if (countEl) countEl.textContent = filtered.length + ' resultado' + (filtered.length !== 1 ? 's' : '');

  const container = document.getElementById('sol-list');
  if (!filtered.length) {
    container.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;">'
      + '<div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:mailbox"></iconify-icon></div>'
      + '<div style="font-size:12px;color:var(--hero-text-muted);">Sin solicitudes con estos filtros</div></div>';
    return;
  }

  container.innerHTML = filtered.map(s => {
    const fecha = new Date(s.fecha).toLocaleString('es-MX', {
      timeZone:'America/New_York', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const isPending    = s.estado === 'pendiente';
    const isAuthorized = s.estado === 'autorizada';
    const isOpen       = isPending || isAuthorized; // estados accionables por IT
    let estadoColor, estadoBg;
    if (isPending)         { estadoColor = 'var(--hero-warning)'; estadoBg = 'rgba(232,163,23,0.1)'; }
    else if (isAuthorized) { estadoColor = 'var(--hero-primary)'; estadoBg = 'rgba(6,163,182,0.12)'; }
    else                   { estadoColor = 'var(--hero-success)'; estadoBg = 'rgba(34,160,107,0.1)'; }

    const elapsed = getElapsedTime(s.fecha);
    const elColor = getElapsedColor(s.fecha, isOpen ? 'abierto' : 'resuelto');

    // Schema unificado: por defecto trata las solicitudes viejas como ALTA de agente.
    const isBaja        = s.tipoSolicitud === 'baja';
    const tipoPersona   = s.tipoPersona === 'empleado' ? 'empleado' : 'agente';
    const tipoLabel     = isBaja ? 'BAJA' : 'ALTA';
    const tipoColor     = isBaja ? 'var(--hero-danger)' : 'var(--hero-primary)';
    const tipoBg        = isBaja ? 'rgba(214,69,69,0.1)' : 'rgba(6,163,182,0.1)';
    let cardColor;
    if (isPending)         cardColor = isBaja ? 'var(--hero-danger)' : 'var(--hero-warning)';
    else if (isAuthorized) cardColor = 'var(--hero-primary)';
    else                   cardColor = 'var(--hero-success)';
    const personaColor  = tipoPersona === 'empleado' ? '#8b5cf6' : '#06a3b6';
    const personaBg     = tipoPersona === 'empleado' ? 'rgba(139,92,246,0.1)' : 'rgba(6,163,182,0.1)';

    // Bloque "Autorizada por X el Y" cuando aplica
    const autorizadaHtml = (isAuthorized || s.autorizadaPor)
      ? '<div style="background:rgba(6,163,182,0.06);border-left:3px solid var(--hero-primary);padding:8px 12px;border-radius:6px;margin:0 0 10px;font-size:12px;color:var(--hero-text-body);">'
        + '<span style="color:var(--hero-primary);font-weight:600;"><iconify-icon icon="tabler:check"></iconify-icon> Autorizada</span>'
        + (s.autorizadaPor ? ' por <strong>' + escHtml(s.autorizadaPor) + '</strong>' : '')
        + (s.autorizadaFecha
            ? ' · <span style="color:var(--hero-text-muted);">' + new Date(s.autorizadaFecha).toLocaleString('es-MX', { timeZone:'America/New_York', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) + ' ET</span>'
            : '')
        + '</div>'
      : '';

    const titulo = isBaja ? (s.nombre || '') : ((s.nombre || '') + ' ' + (s.apellido || ''));
    const correoMostrar = isBaja
      ? (s.correoEliminar || '')
      : (s.correoPersonal || s.correo || '');
    const correoLabel = isBaja ? 'Correo a eliminar' : 'Correo personal';

    // Datos de empleado (cargo/área) si aplica
    const cargoAreaHtml = (tipoPersona === 'empleado' && (s.cargo || s.area))
      ? '<div style="display:flex;gap:14px;font-size:12px;color:var(--hero-text-muted);margin-bottom:6px;">'
        + (s.cargo ? '<span><strong style="color:var(--hero-text-body);">Cargo:</strong> ' + escHtml(s.cargo) + '</span>' : '')
        + (s.area  ? '<span><strong style="color:var(--hero-text-body);">Área:</strong> '   + escHtml(s.area)  + '</span>' : '')
        + '</div>'
      : '';

    // Bloque específico por tipo
    const detalleBloque = isBaja
      ? '<div style="background:rgba(214,69,69,0.06);border-left:3px solid var(--hero-danger);padding:10px 12px;border-radius:6px;margin:8px 0 12px;">'
        + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:var(--hero-danger);text-transform:uppercase;margin-bottom:4px;">Motivo</div>'
        + '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;">' + escHtml(s.motivo || '—') + '</div>'
        + (s.detalle ? '<div style="font-size:12px;color:var(--hero-text-muted);margin-top:6px;"><strong>Detalle:</strong> ' + escHtml(s.detalle) + '</div>' : '')
        + '</div>'
      : '<div style="display:flex;gap:16px;font-size:12px;color:var(--hero-text-muted);margin-bottom:14px;">'
        + (s.telefono       ? '<span><iconify-icon icon="tabler:phone"></iconify-icon> ' + escHtml(s.telefono) + '</span>' : '')
        + (s.fechaRequerida ? '<span><iconify-icon icon="tabler:calendar"></iconify-icon> Requerida: ' + escHtml(s.fechaRequerida) + '</span>' : '')
        + '</div>';

    // Botonera: distinta según tipo
    const escAttr = v => String(v == null ? '' : v).replace(/'/g, '\\\'').replace(/"/g, '&quot;');
    const safeSolEmail  = escAttr(s.solicitanteEmail);
    const safeSolNombre = escAttr(s.solicitanteNombre);
    const safeTitulo    = escAttr(titulo);
    const safeCorreoEl  = escAttr(s.correoEliminar);

    let acciones = '';
    if (isOpen) {
      // Botón "Reenviar autorizadores": solo si pendiente (no si ya autorizada).
      // Regenera links HMAC con nuevo exp de 7 días. Ver Fase D en Worker.
      const reenviarBtn = isPending
        ? '<button class="btn btn-secondary" onclick="reenviarAutorizadores(\'' + s.id + '\',\'' + (isBaja ? 'baja' : 'alta') + '\',\'' + safeTitulo + '\')" style="font-size:12px;" title="Reenviar el email de autorización con links nuevos"><iconify-icon icon="tabler:mail-forward"></iconify-icon> Reenviar</button>'
        : '';
      const tipoRechazo = isBaja ? 'baja' : 'alta';
      const btnRechazar = '<button class="btn btn-secondary" onclick="rechazarSolicitud(\'' + s.id + '\',\'' + safeSolEmail + '\',\'' + safeSolNombre + '\',\'' + safeTitulo + '\',\'' + tipoRechazo + '\')" style="font-size:12px;"><iconify-icon icon="tabler:x"></iconify-icon> Rechazar</button>';

      if (isPending) {
        // Solicitud aún NO autorizada. IT solo puede reenviar el email o rechazar.
        // Los botones destructivos/creación (Crear usuario, Suspender, Marcar
        // procesada) se ocultan hasta que al menos un autorizador haga click.
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
          + '<div style="flex:1;min-width:200px;background:rgba(232,163,23,0.08);border:1px solid rgba(232,163,23,0.3);border-radius:8px;padding:8px 12px;font-size:12px;color:#8b6b00;line-height:1.4;">'
          +   '<iconify-icon icon="tabler:hourglass"></iconify-icon> Esperando autorización de <strong>al menos un administrador</strong> (Jesús, Anny o Aurys)'
          + '</div>'
          + reenviarBtn
          + btnRechazar
          + '</div>';
      } else if (isBaja) {
        // Autorizada: botones completos.
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn btn-primary" onclick="suspenderDesdeSolicitud(\'' + s.id + '\',\'' + safeCorreoEl + '\',\'' + safeTitulo + '\')" style="font-size:12px;flex:1;background:linear-gradient(135deg,#c0392b,#e67e22);"><iconify-icon icon="tabler:lock"></iconify-icon> Suspender cuenta</button>'
          + btnRechazar
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;"><iconify-icon icon="tabler:check"></iconify-icon> Marcar procesada</button>'
          + '</div>';
      } else {
        // Autorizada: botones completos.
        acciones = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn btn-primary" onclick="openSolModal(\'' + s.id + '\')" style="font-size:12px;flex:1;"><iconify-icon icon="tabler:user-plus"></iconify-icon> Crear usuario</button>'
          + btnRechazar
          + '<button class="btn btn-secondary" onclick="resolverSolicitud(\'' + s.id + '\',\'procesada\')" style="font-size:12px;"><iconify-icon icon="tabler:check"></iconify-icon> Marcar procesada</button>'
          + '</div>';
      }
    }

    return '<div class="action-card" style="margin-bottom:12px;--card-color:' + cardColor + ';">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px;">'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">'
      +       '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + tipoBg + ';color:' + tipoColor + ';letter-spacing:1px;">' + tipoLabel + '</span>'
      +       '<span style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 8px;border-radius:12px;background:' + personaBg + ';color:' + personaColor + ';letter-spacing:1px;">' + tipoPersona.toUpperCase() + '</span>'
      +     '</div>'
      +     '<div style="font-size:15px;font-weight:600;color:var(--hero-text-primary);">' + escHtml(titulo) + '</div>'
      +     (correoMostrar
              ? '<div style="font-family:var(--mono);font-size:11px;color:' + (isBaja ? 'var(--hero-danger)' : 'var(--hero-primary)') + ';margin-top:2px;"><span style="color:var(--hero-text-muted);">' + correoLabel + ':</span> ' + escHtml(correoMostrar) + '</div>'
              : '')
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
      +     '<span style="font-family:var(--mono);font-size:10px;color:' + elColor + ';">⏱ ' + elapsed + '</span>'
      +     '<span style="font-family:var(--mono);font-size:10px;padding:3px 10px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + escHtml(s.estado) + '</span>'
      +   '</div>'
      + '</div>'
      + cargoAreaHtml
      + '<div style="font-size:12px;color:var(--hero-text-body);margin-bottom:6px;">'
      +   '<span style="color:var(--hero-text-muted);">Solicitado por: </span>'
      +   '<strong>' + escHtml(s.solicitanteNombre || 'No especificado') + '</strong>'
      +   (s.solicitanteEmail ? ' <span style="font-family:var(--mono);font-size:11px;color:var(--hero-primary);">(' + escHtml(s.solicitanteEmail) + ')</span>' : '')
      + '</div>'
      + autorizadaHtml
      + detalleBloque
      + '<div style="font-size:11px;color:var(--hero-text-muted);margin-bottom:' + (isOpen ? '14px' : '0') + ';"><iconify-icon icon="tabler:clock"></iconify-icon> ' + fecha + ' ET</div>'
      + acciones
      + '</div>';
  }).join('');
}

async function resolverSolicitud(id, estado, opts = {}) {
  try {
    const body = { id, estado };
    if (opts.motivo) body.motivo = opts.motivo;
    if (opts.skipSolicitanteNotif) body.skipSolicitanteNotif = true;
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('Solicitud marcada como ' + estado);
    auditLog('solicitud', 'Solicitud marcada como ' + estado, id);
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

async function rechazarSolicitud(id, solEmail, solNombre, persona, tipo) {
  const tipoLabel = tipo === 'baja' ? 'baja' : 'alta';
  if (!(await heroConfirm({
    title: '¿Rechazar solicitud?',
    body: 'Vas a rechazar la solicitud de ' + tipoLabel + ' para ' + persona + '. Se notificará al solicitante.',
    confirmText: 'Rechazar', destructive: true,
  }))) return;

  // Motivo opcional — prompt nativo (KISS). Si el usuario cancela, se queda
  // en null y el email al solicitante no incluye la sección "Motivo".
  const motivo = window.prompt('Motivo del rechazo (opcional — se incluirá en el email al solicitante):', '');

  try {
    // Fase C: la notificación al solicitante ahora la manda el Worker desde
    // /alta-agente/resolver (fuente única, con motivo si viene). Ya no hay
    // sendViaResend inline aquí — evitamos duplicar emails y mantenemos el
    // template consistente entre autorizada/procesada/rechazada.
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        estado: 'rechazada',
        motivo: motivo || undefined,
      })
    });
    showToast('Solicitud rechazada' + (solEmail ? ' — solicitante notificado' : ''));
    auditLog('solicitud', 'Solicitud rechazada (' + tipoLabel + '): ' + persona + (motivo ? ' · ' + motivo : ''), solEmail || 'sin email');
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

// ── Reenviar emails a autorizadores (Fase D) ─────────────────
// Regenera los links HMAC con nuevo `exp` (7 días adelante) y manda los
// emails otra vez a los 3 autorizadores. Solo funciona si la solicitud
// sigue en estado 'pendiente' — si ya fue autorizada/procesada/rechazada,
// el Worker devuelve 409.
async function reenviarAutorizadores(id, tipo, persona) {
  const tipoLabel = tipo === 'baja' ? 'baja' : 'alta';
  if (!(await heroConfirm({
    title: '¿Reenviar a autorizadores?',
    body: 'Se enviará el email de autorización otra vez a los 3 autorizadores '
        + '(' + tipoLabel + ' de ' + persona + '). Los links tendrán 7 días de validez desde ahora.',
    confirmText: 'Reenviar',
  }))) return;
  try {
    const resp = await authFetch(WORKER_URL + '/solicitud-cuenta/reenviar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error del servidor');
    showToast('Emails reenviados a ' + (data.autorizadores || 3) + ' autorizadores');
    auditLog('solicitud', 'Reenvío de autorizadores (' + tipoLabel + '): ' + persona, id);
    loadSolicitudes();
  } catch(err) { showToast('Error: ' + err.message); }
}

// ── Suspender cuenta desde solicitud de BAJA ─────────────────
// PROC-IT-001: nunca eliminar — sólo suspender. Eliminación es paso manual posterior.
async function suspenderDesdeSolicitud(id, correoEliminar, persona) {
  if (!correoEliminar) {
    showToast('La solicitud no tiene correo a eliminar');
    return;
  }
  if (!(await heroConfirm({
    title: '¿Suspender cuenta de Workspace?',
    body: 'PROC-IT-001: la cuenta ' + correoEliminar + ' se marcará como suspendida en Google Workspace '
        + '(la eliminación definitiva es un paso manual posterior). La solicitud quedará marcada como procesada.',
    confirmText: 'Suspender', destructive: true, mustType: correoEliminar,
  }))) return;

  // Pide motivo. Pre-selecciona 'contrato' o 'renuncia' si el motivo de la
  // solicitud original coincide con esas palabras clave. Si el usuario cancela,
  // se aborta la suspensión (no queremos suspender sin motivo consistente
  // con lo que le mandaremos al correo personal).
  var sol = (allSolicitudes || []).find(function(x) { return x.id === id; });
  var solMotivo = (sol && sol.motivo || '').toLowerCase();
  var hint = 'admin';
  if (solMotivo.indexOf('renuncia') !== -1) hint = 'renuncia';
  else if (solMotivo.indexOf('contrato') !== -1 || solMotivo.indexOf('fin de') !== -1) hint = 'contrato';
  // También sugiere por login si tenemos el user en la tabla cargada.
  var userRecord = (allUsers || []).find(function(u) { return u.email === correoEliminar; });
  if (userRecord && hint === 'admin') hint = suggestSuspensionReasonKey(userRecord);
  var motivo = await askSuspensionReason(persona, correoEliminar, hint);
  if (!motivo) return;

  try {
    const resp = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correoEliminar, action: 'suspend' })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al suspender');
    await authFetch(WORKER_URL + '/alta-agente/resolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado: 'procesada' })
    });
    showToast('Cuenta suspendida: ' + correoEliminar);
    auditLog('solicitud', 'Cuenta suspendida desde solicitud de baja: ' + persona + ' · motivo: ' + motivo.label, correoEliminar);
    // Notificar al correo personal (mismo flujo que userAction('suspend')).
    await notificarSuspension(correoEliminar, persona, motivo);
    loadSolicitudes();
  } catch(err) {
    showToast('Error: ' + err.message);
    auditLog('solicitud', 'Error al suspender cuenta: ' + err.message, correoEliminar);
  }
}

// ── Modal crear usuario desde solicitud ──────────────────────
function openSolModal(id) {
  const s = allSolicitudes.find(x => x.id === id);
  if (!s) return;
  solModalData = s;
  document.getElementById('sol-modal-nombre').textContent = s.nombre + ' ' + s.apellido;
  document.getElementById('sol-modal-solicitante').textContent = s.solicitanteNombre || 'No especificado';
  document.getElementById('sol-modal-solicitante-email').textContent = s.solicitanteEmail || '';
  document.getElementById('sm-nombre').value   = s.nombre;
  document.getElementById('sm-apellido').value = s.apellido;
  const sugerido = _slugUsername(s.nombre, s.apellido);
  document.getElementById('sm-email-user').value = sugerido;
  document.getElementById('sm-email-preview').textContent = sugerido + '@heroinsuranceusa.com';
  document.getElementById('sm-password').value = _generateStrongPassword();
  document.getElementById('sol-modal').style.display = 'block';
}

function closeSolModal() {
  document.getElementById('sol-modal').style.display = 'none';
  solModalData = null;
}

function previewSolEmail() {
  const user = document.getElementById('sm-email-user').value.trim();
  const prev = document.getElementById('sm-email-preview');
  if (prev) prev.textContent = user ? user + '@heroinsuranceusa.com' : '';
}

function generateSolPassword() {
  const pwd = _generateStrongPassword();
  document.getElementById('sm-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
}

async function crearUsuarioDesdeModal() {
  if (!solModalData) return;
  const nombre   = document.getElementById('sm-nombre').value.trim();
  const apellido = document.getElementById('sm-apellido').value.trim();
  const emailUser= document.getElementById('sm-email-user').value.trim();
  const password = document.getElementById('sm-password').value.trim();

  if (!nombre || !apellido || !emailUser || !password) {
    showToast('Completa todos los campos'); return;
  }

  const email = emailUser + '@heroinsuranceusa.com';
  const btn   = document.getElementById('btn-sm-crear');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Creando...';

  try {
    // Create user in Workspace
    const resp = await authFetch(WORKER_URL + '/create-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre, apellido, email, password,
        solicitanteEmail: solModalData.solicitanteEmail || null,
        solicitanteNombre: solModalData.solicitanteNombre || null,
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al crear usuario');

    // Audit inmediato — la creación del usuario debe quedar registrada en
    // Auditoría aunque el resolverSolicitud o el envío del onboarding fallen
    // más adelante. Si esto no está acá arriba, un throw en el email de
    // onboarding hace que el usuario quede creado en Workspace pero sin
    // registro visible en el panel de Auditoría del Hub.
    addLog('Usuario creado: ' + email, 'success');
    auditLog('usuario', 'Usuario creado desde solicitud: ' + nombre + ' ' + apellido, email);

    // Guardar en Firestore shared/workspaceUsers/byEmail/{email} la info
    // que Workspace no tiene (correo personal) — se usará después al
    // suspender la cuenta para notificar al empleado.
    saveWorkspaceUser(email, {
      email: email,
      nombre: nombre + ' ' + apellido,
      personalEmail: solModalData.correoPersonal || solModalData.correo || '',
      cargo: solModalData.cargo || '',
      area: solModalData.area || '',
      createdAt: new Date().toISOString(),
      createdBy: 'crearUsuarioDesdeModal',
      solicitudId: solModalData.id || null,
    });

    // Mark solicitud as processed.
    // skipSolicitanteNotif: true → el Worker YA notificó al solicitante desde
    // /create-user con el email de "Solicitud procesada" (que incluye el
    // email corporativo creado). No queremos duplicar la notificación desde
    // resolver.
    await resolverSolicitud(solModalData.id, 'procesada', { skipSolicitanteNotif: true });

    // Send onboarding email (al correo personal indicado en la solicitud).
    // Va en su propio try/catch — un fallo del email (Resend caído, rate
    // limit, dominio raro) no debe hacer parecer que la creación del usuario
    // falló ni cortar el flujo de UI.
    let onboardingOk = true;
    let onboardingErr = null;
    const lang = document.getElementById('sm-lang').value;
    const destinoPersonal = solModalData.correoPersonal || solModalData.correo;
    if (destinoPersonal) {
      try {
        await sendOnboardingViaResend({
          to: destinoPersonal,
          subject: onboardingSubject('agente', lang),
          html: buildEmailAgente(nombre + ' ' + apellido, email, password, lang),
          text: onboardingText(nombre, email, lang),
        });
      } catch (mailErr) {
        onboardingOk = false;
        onboardingErr = mailErr.message;
        addLog('Usuario creado pero onboarding falló: ' + mailErr.message, 'warn');
      }
    }

    showToast(onboardingOk
      ? 'Usuario creado y solicitante notificado'
      : 'Usuario creado ✓ · onboarding pendiente (' + onboardingErr + ')');
    closeSolModal();
    loadSolicitudes();
  } catch(err) {
    showToast('Error: ' + err.message);
    addLog('Error: ' + err.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:check"></iconify-icon> Crear usuario y notificar';
}

// ── Módulo Crear Usuario ──────────────────────────────────────
let nuevoUsuario = null;

// Convención de username: primera inicial del nombre + apellido, minúsculas,
// sin acentos, ñ ni caracteres no alfanuméricos (Luis García → lgarcia,
// María Núñez → mnunez, O'Brien → obrien, De la Cruz → delacruz).
function _slugUsername(nombre, apellido) {
  const raw = (String(nombre || '').charAt(0) + String(apellido || '')).toLowerCase();
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Auto-sugerencia del email corporativo mientras se escribe nombre/apellido.
// Se apaga apenas el usuario edita el campo a mano (para no pisar su elección
// si, por ej., ya existe una colisión y quiso mandar 'lgarcia2').
let _emailUserEdited = false;
let _crearUsuarioBooted = false;
let _emailUpdateProgrammatic = false;

function _updateSuggestedEmailUser() {
  if (_emailUserEdited) return;
  const n = document.getElementById('new-nombre').value.trim();
  const a = document.getElementById('new-apellido').value.trim();
  const emailInput = document.getElementById('new-email-user');
  _emailUpdateProgrammatic = true;
  emailInput.value = (n && a) ? _slugUsername(n, a) : '';
  _emailUpdateProgrammatic = false;
  previewEmail();
}

function initCrearUsuario() {
  // Pre-generar contraseña si el campo está vacío (no pisar si Fernando ya
  // escribió una a mano o si volvió a la página sin resetear).
  const pwd = document.getElementById('new-password');
  if (pwd && !pwd.value.trim()) pwd.value = _generateStrongPassword();

  if (_crearUsuarioBooted) return;
  _crearUsuarioBooted = true;

  document.getElementById('new-nombre').addEventListener('input', _updateSuggestedEmailUser);
  document.getElementById('new-apellido').addEventListener('input', _updateSuggestedEmailUser);
  document.getElementById('new-email-user').addEventListener('input', () => {
    if (_emailUpdateProgrammatic) return;
    _emailUserEdited = true;
  });
}

function previewEmail() {
  const user = document.getElementById('new-email-user').value.trim();
  const nombre = document.getElementById('new-nombre').value.trim();
  const apellido = document.getElementById('new-apellido').value.trim();
  const preview = document.getElementById('new-preview');
  if (user || nombre) {
    preview.innerHTML =
      '<span style="color:var(--hero-text-body)">Email: </span><span style="color:var(--hero-primary)">' + (user || '...') + atSign + 'heroinsuranceusa.com</span><br>' +
      '<span style="color:var(--hero-text-body)">Nombre: </span><span style="color:var(--hero-text-primary)">' + (nombre || '—') + ' ' + (apellido || '') + '</span>';
  }
}

function generatePassword() {
  document.getElementById('new-password').value = _generateStrongPassword();
}

async function crearUsuario() {
  const nombre   = document.getElementById('new-nombre').value.trim();
  const apellido = document.getElementById('new-apellido').value.trim();
  const emailUser = document.getElementById('new-email-user').value.trim();
  const password  = document.getElementById('new-password').value.trim();
  const emailPers = document.getElementById('new-email-personal').value.trim();
  const tipo      = document.getElementById('new-tipo').value;
  const lang      = document.getElementById('new-lang-up').value;
  const autoSend  = document.getElementById('new-auto-send').checked;

  if (!nombre || !apellido) { showToast('Falta nombre o apellido'); return; }
  if (!emailUser) { showToast('Falta el usuario del email'); return; }
  if (!password)  { showToast('Falta la contraseña temporal'); return; }

  const emailCorp = emailUser + atSign + 'heroinsuranceusa.com';
  const btn = document.getElementById('btn-crear-usuario');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Creando...';
  addLog('Creando usuario ' + emailCorp + ' en Workspace...', 'info', 'log-new');

  try {
    const resp = await authFetch(WORKER_URL + '/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre, apellido, email: emailCorp, password,
        solicitanteEmail: window._altaSolicitanteEmail || null,
        solicitanteNombre: window._altaSolicitanteNombre || null,
      })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Error al crear usuario');

    nuevoUsuario = { nombre: nombre + ' ' + apellido, email: emailCorp, password, emailPersonal: emailPers };
    addLog('Usuario creado: ' + emailCorp, 'success', 'log-new');
    auditLog('usuario', 'Usuario creado en Workspace: ' + nombre + ' ' + apellido, emailCorp);

    // Guardar personalEmail + metadata en Firestore para usar al suspender.
    // Reusa el email personal ingresado en el modulo — puede ser vacio si
    // el usuario opto por no ingresarlo.
    saveWorkspaceUser(emailCorp, {
      email: emailCorp,
      nombre: nombre + ' ' + apellido,
      personalEmail: emailPers || '',
      cargo: '',
      area: '',
      createdAt: new Date().toISOString(),
      createdBy: 'crearUsuario',
      solicitudId: window._altaId || null,
    });

    // Si viene de una solicitud de alta, marcarla como procesada
    if (window._altaId) {
      await resolverSolicitud(window._altaId, 'procesada');
      window._altaId = null;
    }

    const statusBox = document.getElementById('new-status-box');
    statusBox.style.display = 'block';
    document.getElementById('new-status').innerHTML =
      '<span style="color:var(--hero-success); font-family:var(--mono); font-size:12px;">Usuario creado correctamente</span><br>' +
      '<span style="font-family:var(--mono); font-size:11px; color:var(--hero-text-body);">' + emailCorp + '</span>';

    // Si el usuario optó por auto-send y hay email personal, mandamos el
    // onboarding inmediatamente en lugar de pedirle un segundo click.
    if (autoSend && emailPers) {
      addLog('Enviando onboarding ' + tipo + ' (' + lang + ') a ' + emailPers + '...', 'info', 'log-new');
      try {
        const htmlBody = tipo === 'empleado'
          ? buildEmailEmpleado(nuevoUsuario.nombre, emailCorp, password, lang)
          : buildEmailAgente(nuevoUsuario.nombre, emailCorp, password, lang);
        await sendOnboardingViaResend({
          to: emailPers,
          subject: onboardingSubject(tipo, lang),
          html: htmlBody,
          text: onboardingText(nuevoUsuario.nombre, emailCorp, lang),
        });
        addLog('Onboarding enviado a ' + emailPers, 'success', 'log-new');
        auditLog('onboarding', 'Onboarding ' + tipo + ' enviado a ' + emailPers, emailCorp);
        showToast('Usuario creado y onboarding enviado');
        resetCrearUsuario();
      } catch (mailErr) {
        addLog('Usuario creado pero onboarding falló: ' + mailErr.message, 'warn', 'log-new');
        showToast('Usuario creado, pero el onboarding falló — usa el panel manual abajo');
        // Caer al panel manual para que Fernando pueda reintentar
        document.getElementById('new-onboarding-box').style.display = 'block';
      }
    } else {
      showToast('Usuario creado en Workspace');
      // Sin auto-send (o sin email personal): mostrar el panel manual para
      // que Fernando decida si manda onboarding o no, y de qué tipo.
      if (emailPers) document.getElementById('new-onboarding-box').style.display = 'block';
    }

  } catch (err) {
    addLog('Error: ' + err.message, 'error', 'log-new');
    showToast('Error al crear usuario');
  }

  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:sparkles"></iconify-icon> Crear usuario y enviar onboarding';
}

async function sendOnboardingNuevo(tipo) {
  if (!nuevoUsuario) return;
  const btnId = tipo === 'empleado' ? 'btn-ob-emp' : 'btn-ob-agt';
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Enviando...';

  addLog('Enviando onboarding ' + tipo + ' a ' + nuevoUsuario.emailPersonal, 'info', 'log-new');

  try {
    const lang = document.getElementById('new-lang').value;
    const htmlBody = tipo === 'empleado'
      ? buildEmailEmpleado(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password, lang)
      : buildEmailAgente(nuevoUsuario.nombre, nuevoUsuario.email, nuevoUsuario.password, lang);
    const asunto = onboardingSubject(tipo, lang);

    await sendOnboardingViaResend({ to: nuevoUsuario.emailPersonal, subject: asunto, html: htmlBody,
      text: onboardingText(nuevoUsuario.nombre, nuevoUsuario.email, lang) });

    addLog('Onboarding enviado a ' + nuevoUsuario.emailPersonal, 'success', 'log-new');
    showToast('Email de onboarding enviado');
    document.getElementById('new-onboarding-box').style.display = 'none';
    resetCrearUsuario();

  } catch (err) {
    addLog('Error enviando onboarding: ' + err.message, 'error', 'log-new');
    showToast('Error al enviar onboarding');
  }
  btn.disabled = false;
  btn.innerHTML = tipo === 'empleado'
    ? '<iconify-icon icon="tabler:user"></iconify-icon> Enviar como Empleado'
    : '<iconify-icon icon="tabler:briefcase"></iconify-icon> Enviar como Agente';
}

function skipOnboarding() {
  document.getElementById('new-onboarding-box').style.display = 'none';
  resetCrearUsuario();
  addLog('Onboarding omitido', 'warn', 'log-new');
}

function resetCrearUsuario() {
  ['new-nombre','new-apellido','new-email-user','new-password','new-email-personal'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('new-preview').innerHTML = 'Completa el formulario para ver la vista previa';
  document.getElementById('new-status-box').style.display = 'none';
  nuevoUsuario = null;
  _emailUserEdited = false;
  document.getElementById('new-password').value = _generateStrongPassword();
}

// ── Página Enviar Onboarding (standalone) ────────────────────
// Reenvía el correo de bienvenida empleado/agente SIN crear la cuenta.
// Reusa las plantillas buildEmailEmpleado/buildEmailAgente.
function onbTogglePassword() {
  const on = document.getElementById('onb-incluir-pass').checked;
  document.getElementById('onb-pass-group').style.display = on ? 'block' : 'none';
  onbPreview();
}

function onbGenPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#*$';
  let pwd = upper[Math.floor(Math.random()*upper.length)]
    + lower[Math.floor(Math.random()*lower.length)]
    + digits[Math.floor(Math.random()*digits.length)]
    + special[Math.floor(Math.random()*special.length)];
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random()*all.length)];
  pwd = pwd.split('').sort(() => Math.random()-0.5).join('');
  document.getElementById('onb-password').value = pwd;
  navigator.clipboard?.writeText(pwd).catch(()=>{});
  showToast('Contraseña generada y copiada');
  onbPreview();
}

function onbPreview() {
  const prev = document.getElementById('onb-preview');
  if (!prev) return;
  const nombre   = document.getElementById('onb-nombre').value.trim();
  const tipo     = document.getElementById('onb-tipo').value;
  const lang     = document.getElementById('onb-lang').value;
  const user     = document.getElementById('onb-email-user').value.trim();
  const personal = document.getElementById('onb-email-personal').value.trim();
  const incluir  = document.getElementById('onb-incluir-pass').checked;
  const pass     = document.getElementById('onb-password').value.trim();
  const corp     = user ? user + atSign + 'heroinsuranceusa.com' : '—';
  prev.innerHTML =
      'Tipo: <strong>' + (tipo === 'empleado' ? 'Empleado' : 'Agente') + '</strong><br>'
    + 'Idioma: <strong>' + (lang === 'en' ? 'Inglés' : 'Español') + '</strong><br>'
    + 'Para: <strong>' + (nombre || '—') + '</strong><br>'
    + 'Cuenta: ' + corp + '<br>'
    + 'Enviar a: ' + (personal || '—') + '<br>'
    + 'Contraseña: ' + (incluir ? (pass || '(usa el botón generar)') : 'no se incluye en el correo');
}

async function enviarOnboarding() {
  const nombre   = document.getElementById('onb-nombre').value.trim();
  const tipo     = document.getElementById('onb-tipo').value;
  const user     = document.getElementById('onb-email-user').value.trim();
  const personal = document.getElementById('onb-email-personal').value.trim();
  const incluir  = document.getElementById('onb-incluir-pass').checked;
  const pass     = incluir ? document.getElementById('onb-password').value.trim() : '';

  if (!nombre)   { showToast('Falta el nombre completo'); return; }
  if (!user)     { showToast('Falta el usuario del correo corporativo'); return; }
  if (!personal) { showToast('Falta el correo personal (destino)'); return; }
  if (incluir && !pass) { showToast('Marcaste incluir contraseña pero está vacía'); return; }

  const emailCorp = user + atSign + 'heroinsuranceusa.com';
  const btn = document.getElementById('btn-onb-enviar');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Enviando...';
  addLog('Enviando onboarding ' + tipo + ' a ' + personal + '...', 'info', 'log-onb');

  try {
    const lang = document.getElementById('onb-lang').value;
    const html = tipo === 'empleado'
      ? buildEmailEmpleado(nombre, emailCorp, pass, lang)
      : buildEmailAgente(nombre, emailCorp, pass, lang);
    const asunto = onboardingSubject(tipo, lang);

    await sendOnboardingViaResend({
      to: personal, subject: asunto, html,
      text: onboardingText(nombre, emailCorp, lang),
    });

    addLog('Onboarding enviado a ' + personal, 'success', 'log-onb');
    showToast('Correo de onboarding enviado');
    auditLog('usuario', 'Onboarding (' + tipo + ') enviado a ' + nombre, emailCorp + ' → ' + personal);
  } catch (err) {
    addLog('Error enviando onboarding: ' + err.message, 'error', 'log-onb');
    showToast('Error al enviar: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:send"></iconify-icon> Enviar correo de onboarding';
}

// ── Módulo Usuarios Workspace ─────────────────────────────────
let allUsers = [];

async function loadUsers() {
  const btn = document.getElementById('btn-load-users');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Cargando...';
  document.getElementById('usr-count').textContent = '';
  addLog('Consultando usuarios de Google Workspace...', 'info');

  try {
    const resp = await authFetch(WORKER_URL + '/users');
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Error del Worker');

    allUsers = data.users || [];
    window._workspaceUsers = allUsers; // cache for global search
    addLog('Usuarios cargados: ' + allUsers.length, 'success');
    populateOuFilter(allUsers);
    _usersCurrentPage = 1;

    // Cachea roles del Hub + docs de shared/workspaceUsers ANTES de renderizar,
    // para que el filtro Actividad tenga la data lista si viene pre-seleccionado
    // (ej. click en un chip del Home). Si algo falla, seguimos con render vacío.
    try {
      const [wsUsers] = await Promise.all([listWorkspaceUsers(), getHubUserRoles()]);
      const map = {};
      (wsUsers || []).forEach(w => { map[(w.email || '').toLowerCase()] = w; });
      _wsUsersMap = map;
    } catch (e) {
      console.warn('[loadUsers] cache flujo inactivos falló:', e && e.message);
    }
    // filterUsers respeta el pill actual (Actividad + resto). Si no hay filtro
    // seleccionado, se comporta como renderUsers(allUsers).
    filterUsers();
    _renderInactiveAgentsChips();

  } catch (err) {
    addLog('Error al cargar usuarios: ' + err.message, 'error');
    showToast('Error al cargar usuarios');
    // usr-tbody es un <tbody>: necesitamos un <tr> en lugar del <div> de renderError.
    const tbody = document.getElementById('usr-tbody');
    tbody.innerHTML =
        '<tr><td colspan="8" style="padding:32px;text-align:center;">'
      +   '<div style="font-size:32px;opacity:0.4;margin-bottom:12px;color:var(--hero-warning);"><iconify-icon icon="tabler:alert-triangle"></iconify-icon></div>'
      +   '<div style="font-family:var(--mono);font-size:12px;color:var(--hero-danger);margin-bottom:14px;">' + escHtml(err.message) + '</div>'
      +   '<button class="btn btn-secondary" id="usr-retry" style="font-size:12px;">↺ Reintentar</button>'
      + '</td></tr>';
    const retryBtn = document.getElementById('usr-retry');
    if (retryBtn) retryBtn.addEventListener('click', loadUsers);
  }

  btn.disabled = false;
  btn.innerHTML = '↺ Cargar usuarios';
}

// Iniciales del nombre para el avatar (2 letras).
function userInitials(nombre) {
  if (!nombre) return '?';
  const parts = String(nombre).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Color determinista del avatar basado en un hash simple del nombre —
// misma persona → mismo color siempre, sin coordinar con Firestore.
function userAvatarColor(nombre) {
  const palette = ['#06a3b6', '#0891a3', '#0f8054', '#22a06b', '#7c3aed', '#c026d3', '#d97706', '#dc2626', '#0284c7', '#059669'];
  let hash = 0;
  const s = String(nombre || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

// Etiqueta del rol de Workspace: Super Admin > Delegated Admin > Usuario.
function userRoleLabel(u) {
  if (u.isAdmin) return { key: 'admin',     label: 'Super Admin',     color: '#dc2626', bg: 'rgba(220,38,38,0.10)' };
  if (u.isDelegatedAdmin) return { key: 'delegated', label: 'Delegated Admin', color: '#d97706', bg: 'rgba(217,119,6,0.10)' };
  return { key: 'user', label: 'Usuario', color: 'var(--hero-text-muted)', bg: 'rgba(120,120,120,0.08)' };
}

const USERS_PER_PAGE = 25;
let _usersCurrentPage = 1;
let _usersLastRendered = [];

function renderUsers(users) {
  _usersLastRendered = users || [];
  const tbody = document.getElementById('usr-tbody');
  document.getElementById('usr-count').textContent = users.length + ' usuario' + (users.length !== 1 ? 's' : '');

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:13px;">Sin resultados</td></tr>';
    renderUsersPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(users.length / USERS_PER_PAGE));
  if (_usersCurrentPage > totalPages) _usersCurrentPage = totalPages;
  if (_usersCurrentPage < 1) _usersCurrentPage = 1;
  const start = (_usersCurrentPage - 1) * USERS_PER_PAGE;
  const pageUsers = users.slice(start, start + USERS_PER_PAGE);

  tbody.innerHTML = pageUsers.map((u, i) => {
    const estadoColor = u.estado === 'activo' ? 'var(--hero-success)' : 'var(--hero-danger)';
    const estadoBg    = u.estado === 'activo' ? 'rgba(34,160,107,0.1)' : 'rgba(214,69,69,0.1)';
    const estadoTitle = u.estado === 'activo'
      ? 'Cuenta activa'
      : ('Cuenta suspendida' + (u.suspensionReason ? ' · ' + u.suspensionReason : ''));
    const login       = u.ultimoLogin && u.ultimoLogin !== '1970-01-01T00:00:00.000Z'
      ? new Date(u.ultimoLogin).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' })
      : 'Nunca';
    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
    const ouLabel = !u.orgUnitPath || u.orgUnitPath === '/' ? '—' : u.orgUnitPath.replace(/^\//, '');
    const mfaLabel = u.mfaEnrolled
      ? '<iconify-icon icon="tabler:check"></iconify-icon>'
      : '<iconify-icon icon="tabler:alert-triangle"></iconify-icon>';
    const mfaColor = u.mfaEnrolled ? 'var(--hero-success)' : 'var(--hero-danger)';
    const mfaBg    = u.mfaEnrolled ? 'rgba(34,160,107,0.1)' : 'rgba(214,69,69,0.1)';
    const mfaTitle = u.mfaEnrolled ? '2FA activado' : (u.mfaEnforced ? '2FA obligatorio pero sin enrolar' : '2FA no activado');
    const rol = userRoleLabel(u);
    const initials = userInitials(u.nombre);
    const avColor  = userAvatarColor(u.nombre);
    const aliasCount = Array.isArray(u.aliases) ? u.aliases.length : 0;
    const cargoLine  = u.cargo ? escHtml(u.cargo) : '';
    // Anillo cyan si tiene contraseña temporal — señala altas recientes.
    const avRing = u.changePasswordAtNextLogin
      ? 'box-shadow:0 0 0 2px var(--hero-bg-page),0 0 0 4px var(--hero-primary);'
      : '';
    const avTitle = u.nombre + (u.changePasswordAtNextLogin ? ' · debe cambiar contraseña al iniciar sesión' : '');
    const aliasTitle = aliasCount ? u.aliases.join(', ').replace(/"/g,'&quot;') : '';

    return '<tr style="border-bottom:1px solid var(--hero-border-card);background:' + rowBg + ';">' +
      '<td style="padding:14px 16px;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:' + avColor + ';color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--sans);font-weight:700;font-size:13px;letter-spacing:.3px;' + avRing + '" title="' + escHtml(avTitle) + '">' + escHtml(initials) + '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);line-height:1.25;">' + escHtml(u.nombre || '—') + '</div>' +
            (cargoLine ? '<div style="font-size:12px;color:var(--hero-text-muted);line-height:1.35;">' + cargoLine + '</div>' : '') +
            '<div style="font-family:var(--mono);font-size:12px;color:var(--hero-primary);line-height:1.35;">' + escHtml(u.email) +
              (aliasCount ? ' <span style="color:var(--hero-text-muted);font-size:11px;" title="' + aliasTitle + '">(+' + aliasCount + ' ' + (aliasCount === 1 ? 'alias' : 'aliases') + ')</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td style="padding:14px 16px;font-size:13px;color:var(--hero-text-body);">' + escHtml(u.departamento || '—') + '</td>' +
      '<td style="padding:14px 16px;font-family:var(--mono);font-size:12px;color:var(--hero-text-body);">' + escHtml(ouLabel) + '</td>' +
      '<td style="padding:14px 16px;" title="' + escHtml(estadoTitle) + '">' +
        '<span style="font-family:var(--mono);font-size:11px;padding:3px 8px;border-radius:20px;background:' + estadoBg + ';color:' + estadoColor + ';">' + escHtml(u.estado) + '</span>' +
      '</td>' +
      '<td style="padding:14px 16px;text-align:center;" title="' + mfaTitle + '">' +
        '<span style="font-family:var(--mono);font-size:13px;font-weight:700;padding:3px 8px;border-radius:20px;background:' + mfaBg + ';color:' + mfaColor + ';">' + mfaLabel + '</span>' +
      '</td>' +
      '<td style="padding:14px 16px;">' +
        '<span style="font-family:var(--mono);font-size:11px;padding:3px 8px;border-radius:20px;background:' + rol.bg + ';color:' + rol.color + ';">' + escHtml(rol.label) + '</span>' +
      '</td>' +
      '<td style="padding:14px 16px;font-family:var(--mono);font-size:12px;color:var(--hero-text-body);">' + login + '</td>' +
      '<td style="padding:14px 16px;text-align:center;">' +
        '<div style="display:flex;gap:6px;justify-content:center;">' +
        '<button onclick="copyEmail(\'' + escJs(u.email) + '\')" style="background:transparent;border:1px solid var(--hero-border-card);color:var(--hero-text-body);padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;" title="Copiar email"><iconify-icon icon="tabler:copy"></iconify-icon></button>' +
        '<button onclick="openUserModal(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\')" style="background:rgba(6,163,182,0.1);border:1px solid rgba(6,163,182,0.3);color:var(--hero-primary);padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;" title="Gestionar"><iconify-icon icon="tabler:settings"></iconify-icon></button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');

  renderUsersPagination(users.length);
}

// Paginación construida con DOM API (no innerHTML) para evitar el hook de
// seguridad y no arriesgar XSS con datos externos.
function renderUsersPagination(totalItems) {
  const wrap = document.getElementById('usr-pagination');
  if (!wrap) return;
  while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

  if (totalItems <= 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const totalPages = Math.max(1, Math.ceil(totalItems / USERS_PER_PAGE));
  const start = totalItems === 0 ? 0 : (_usersCurrentPage - 1) * USERS_PER_PAGE + 1;
  const end = Math.min(_usersCurrentPage * USERS_PER_PAGE, totalItems);

  const info = document.createElement('span');
  info.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);';
  info.textContent = 'Mostrando ' + start + '-' + end + ' de ' + totalItems;

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';

  const makeBtn = (label, page, opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const isActive = opts && opts.active;
    const isDisabled = opts && opts.disabled;
    const base = 'min-width:32px;height:32px;padding:0 10px;border-radius:6px;font-family:var(--mono);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
    if (isActive) {
      b.style.cssText = base + 'background:var(--hero-primary);color:#fff;border:1px solid var(--hero-primary);font-weight:600;';
    } else if (isDisabled) {
      b.style.cssText = base + 'background:transparent;color:var(--hero-text-muted);border:1px solid var(--hero-border-card);opacity:0.4;cursor:not-allowed;';
      b.disabled = true;
    } else {
      b.style.cssText = base + 'background:transparent;color:var(--hero-text-body);border:1px solid var(--hero-border-card);';
      b.addEventListener('click', () => goToUsersPage(page));
    }
    return b;
  };

  const makeEllipsis = () => {
    const s = document.createElement('span');
    s.style.cssText = 'padding:0 4px;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;';
    s.textContent = '…';
    return s;
  };

  controls.appendChild(makeBtn('‹ Anterior', _usersCurrentPage - 1, { disabled: _usersCurrentPage <= 1 }));

  // Construye la lista de páginas visibles: 1, ...contexto..., total.
  // Contexto = página actual ± 1.
  const pages = new Set([1, totalPages, _usersCurrentPage, _usersCurrentPage - 1, _usersCurrentPage + 1]);
  const shown = Array.from(pages).filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let prev = 0;
  shown.forEach(p => {
    if (p - prev > 1) controls.appendChild(makeEllipsis());
    controls.appendChild(makeBtn(String(p), p, { active: p === _usersCurrentPage }));
    prev = p;
  });

  controls.appendChild(makeBtn('Siguiente ›', _usersCurrentPage + 1, { disabled: _usersCurrentPage >= totalPages }));

  wrap.appendChild(info);
  wrap.appendChild(controls);
}

function goToUsersPage(page) {
  _usersCurrentPage = page;
  renderUsers(_usersLastRendered);
  document.getElementById('usr-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateOuFilter(users) {
  const sel = document.getElementById('usr-filter-ou');
  if (!sel) return;
  const prev = sel.value;
  const ous = Array.from(new Set(users.map(u => u.orgUnitPath || '/'))).sort();
  sel.innerHTML = '<option value="">OU: Todas</option>' +
    ous.map(ou => {
      const label = ou === '/' ? '/ (raíz)' : ou;
      return '<option value="' + ou.replace(/"/g, '&quot;') + '">' + label + '</option>';
    }).join('');
  if (prev && ous.includes(prev)) sel.value = prev;
}

function filterUsers() {
  const q = document.getElementById('usr-search').value.toLowerCase();
  const ou = document.getElementById('usr-filter-ou')?.value || '';
  const mfa = document.getElementById('usr-filter-mfa')?.value || '';
  const rol = document.getElementById('usr-filter-rol')?.value || '';
  const act = document.getElementById('usr-filter-actividad')?.value || '';
  // Toggle visual .active en pills según si tienen filtro aplicado
  ['usr-filter-ou','usr-filter-mfa','usr-filter-rol','usr-filter-actividad'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!el.value);
  });
  if (!allUsers.length) return;
  const rolesMap = _hubUserRolesCache || {};
  const filtered = allUsers.filter(u => {
    // Búsqueda incluye ahora cargo y departamento — Fernando puede buscar
    // "CEO", "Operaciones" o el nombre indistintamente.
    const matchText = !q
      || (u.nombre || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.cargo || '').toLowerCase().includes(q)
      || (u.departamento || '').toLowerCase().includes(q);
    const matchOu = !ou || (u.orgUnitPath || '/') === ou;
    const matchMfa = !mfa || (mfa === 'si' ? u.mfaEnrolled : !u.mfaEnrolled);
    const matchRol = !rol
      || (rol === 'admin' && u.isAdmin)
      || (rol === 'delegated' && u.isDelegatedAdmin && !u.isAdmin)
      || (rol === 'user' && !u.isAdmin && !u.isDelegatedAdmin);
    // Filtro Actividad: 3 primeras opciones son SOLO agentes activos (flujo
    // pre-suspensión). La 4ª (suspendidos-vencidos) incluye a CUALQUIER usuario
    // suspendido con plazo cumplido — coincide con el conteo del chip amarillo
    // del Home, que también agrega sin distinguir agentes vs staff.
    let matchActividad = true;
    if (act) {
      const wsData = _wsUsersMap[(u.email || '').toLowerCase()];
      if (act === 'suspendidos-vencidos') {
        if (u.estado === 'activo') {
          matchActividad = false;
        } else {
          const sd = wsData && wsData.scheduledDeletionAt
            ? new Date(wsData.scheduledDeletionAt).getTime() : null;
          matchActividad = !!(sd && sd <= Date.now()
            && !wsData.reactivatedAt && !wsData.deletedAt);
        }
      } else if (u.estado !== 'activo' || !isAgente(u, rolesMap)) {
        matchActividad = false;
      } else {
        const status = classifyActivityStatus(u, wsData);
        if (act === 'nunca-login')        matchActividad = (status === 'never-logged-in');
        else if (act === 'inactivos-3m')  matchActividad = (status === 'inactive');
        else if (act === 'aviso-enviado') matchActividad = (status === 'notice-waiting');
        else if (act === 'aviso-vencido') matchActividad = (status === 'notice-expired');
      }
    }
    return matchText && matchOu && matchMfa && matchRol && matchActividad;
  });
  _usersCurrentPage = 1;
  renderUsers(filtered);
}

function copyEmail(email) {
  navigator.clipboard.writeText(email).then(() => {
    showToast('Email copiado: ' + email);
  }).catch(() => {
    showToast('No se pudo copiar');
  });
}

// ── Módulo Dispositivos ───────────────────────────────────────
let allDevices = [];
let currentDeviceId = null;
let currentDevice = null;
let editingDeviceId = null;

const DEV_ESTADO_COLOR = {
  'activo':        'var(--hero-success)',
  'en reparación': 'var(--hero-warning)',
  'dado de baja':  'var(--hero-error)',
};
const DEV_TIPO_ICON = {
  laptop:    '<iconify-icon icon="tabler:device-laptop"></iconify-icon>',
  desktop:   '<iconify-icon icon="tabler:device-desktop"></iconify-icon>',
  'teléfono': '<iconify-icon icon="tabler:device-mobile"></iconify-icon>'
};
const DEV_FALLBACK_ICON = '<iconify-icon icon="tabler:device-desktop"></iconify-icon>';
const INT_TIPO_COLOR = {
  'Instalación de software': 'var(--hero-primary)',
  'Reparación o diagnóstico': 'var(--hero-warning)',
  'Soporte remoto': 'var(--hero-primary-dark)',
};

async function loadDevices(forceFresh = false) {
  // Si ya hay devices en cache (p.ej. porque el módulo Equipo Interno los
  // pobló al entrar primero a Usuarios), evitamos el segundo fetch al Worker.
  // Refrescar → forceFresh=true (botón "Refrescar" y auto-refresh explícitos).
  if (!forceFresh && Array.isArray(allDevices) && allDevices.length) {
    filterDevices();
    setLastUpdated('devices-last-updated');
    return;
  }
  renderSkeleton(document.getElementById('dev-grid'), { type: 'card', rows: 4 });
  try {
    const url = WORKER_URL + '/device?withZoho=1' + (forceFresh ? '&fresh=1' : '');
    const resp = await authFetch(url);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    allDevices = data.devices || [];
    filterDevices();
    setLastUpdated('devices-last-updated');
  } catch(err) {
    renderError(document.getElementById('dev-grid'), err, loadDevices);
  }
}

function filterDevices() {
  const q      = document.getElementById('dev-search').value.toLowerCase();
  const conn   = document.getElementById('dev-filter-conn').value;
  const estado = document.getElementById('dev-filter-estado').value;
  const tipo   = document.getElementById('dev-filter-tipo').value;
  let filtered = allDevices;
  if (conn)   filtered = filtered.filter(d => (d.zohoStatus || '').toLowerCase() === conn);
  if (estado) filtered = filtered.filter(d => d.estado === estado);
  if (tipo)   filtered = filtered.filter(d => d.tipo === tipo);
  if (q)      filtered = filtered.filter(d =>
    d.nombre.toLowerCase().includes(q) || (d.usuario || '').toLowerCase().includes(q)
  );
  renderDeviceGrid(filtered);
}

function renderDeviceGrid(devices) {
  const total   = devices.length;
  const onlines = devices.filter(d => d.zohoStatus === 'online').length;
  document.getElementById('dev-count').textContent =
    total + ' dispositivo' + (total !== 1 ? 's' : '') +
    ' · ' + onlines + ' online';
  const grid = document.getElementById('dev-grid');
  if (!devices.length) {
    grid.innerHTML = '<div class="info-box" style="text-align:center;padding:40px;grid-column:1/-1;"><div style="font-size:32px;opacity:0.3;margin-bottom:12px;"><iconify-icon icon="tabler:device-desktop"></iconify-icon></div><div style="font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);">Sin dispositivos con estos filtros</div></div>';
    return;
  }
  grid.innerHTML = devices.map(d => {
    const eColor   = DEV_ESTADO_COLOR[d.estado] || 'var(--hero-text-body)';
    const icon     = DEV_TIPO_ICON[d.tipo] || DEV_FALLBACK_ICON;
    const intCount = (d.intervenciones || []).length;
    const isOnline = (d.zohoStatus || '').toLowerCase() === 'online';
    const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
    const dotGlow  = isOnline ? '0 0 6px var(--hero-success)' : 'none';
    const soDisplay = d.so || d.zohoLiveOs || 'SO no especificado';
    const lc = deviceLifecycle(d);
    return '<div class="action-card" style="cursor:pointer;--card-color:' + (isOnline ? 'var(--hero-success)' : 'var(--hero-border-card)') + ';" onclick="openDeviceDetail(\'' + escJs(d.id) + '\')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
      +   '<div style="display:flex;align-items:center;gap:8px;">'
      +     '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';flex-shrink:0;" title="' + (isOnline ? 'Online' : 'Offline') + '"></div>'
      +     '<span style="font-size:22px;">' + icon + '</span>'
      +   '</div>'
      +   '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + eColor + ';">' + escHtml(d.estado) + '</span>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--hero-text-primary);margin-bottom:3px;">' + escHtml(d.nombre) + '</div>'
      + (d.usuario
          ? '<div style="font-size:12px;color:var(--hero-primary);margin-bottom:8px;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="event.stopPropagation();openInternalMemberByOwnerName(\'' + escJs(d.usuario) + '\')" title="Ver ficha de esta persona"><iconify-icon icon="tabler:user" style="font-size:11px;"></iconify-icon> ' + escHtml(d.usuario) + '</div>'
          : '<div style="font-size:12px;color:var(--hero-text-muted);margin-bottom:8px;font-style:italic;">Sin usuario asignado</div>')
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--hero-text-muted);">'
      +   '<span>' + escHtml(soDisplay) + '</span>'
      +   '<span style="margin-left:auto;">' + intCount + ' interv.</span>'
      + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">'
      + (d.gcpw ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:var(--hero-primary-light);color:var(--hero-primary-text);">GCPW</span>' : '')
      + '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.05);color:var(--hero-text-muted);">' + escHtml(d.tipo) + '</span>'
      + (lc.renovarSoon
          ? '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:' + lc.badgeBg + ';color:' + lc.badgeColor + ';">' + lc.badgeText + '</span>'
          : '')
      + '</div>'
      + (isOnline && d.zohoId
          ? '<button onclick="event.stopPropagation();startZohoSession(\'' + escJs(d.zohoId) + '\',\'' + escJs(d.nombre) + '\')" class="btn btn-primary" style="width:100%;font-size:12px;margin-top:10px;"><iconify-icon icon="tabler:screen-share"></iconify-icon> Conectar (Zoho)</button>'
          : '')
      + '</div>';
  }).join('');
}

// Calcula info de lifecycle de un dispositivo basado en fechaCompra +
// vidaUtilAnios. Devuelve siempre el mismo shape para que callers no tengan
// que chequear undefined a mano.
function deviceLifecycle(d) {
  if (!d.fechaCompra || !d.vidaUtilAnios) {
    return { hasData: false, renovarSoon: false };
  }
  const compra = new Date(d.fechaCompra);
  const renovar = new Date(compra);
  renovar.setFullYear(renovar.getFullYear() + Number(d.vidaUtilAnios));
  const daysToRenew = Math.ceil((renovar.getTime() - Date.now()) / 86400000);
  const monthsToRenew = Math.round(daysToRenew / 30);
  const renovarSoon = daysToRenew <= 180; // 6 meses
  const overdue     = daysToRenew < 0;
  const badgeColor  = overdue ? '#fff'                : (daysToRenew <= 60 ? '#fff' : 'var(--hero-warning)');
  const badgeBg     = overdue ? 'var(--hero-danger)'  : (daysToRenew <= 60 ? 'var(--hero-warning)' : 'rgba(232,163,23,0.15)');
  const badgeText   = overdue
    ? 'RENOVAR (vencido)'
    : daysToRenew <= 30 ? 'Renovar en ' + daysToRenew + 'd'
    : 'Renovar en ' + monthsToRenew + ' mes' + (monthsToRenew !== 1 ? 'es' : '');
  return {
    hasData: true, renovarSoon, overdue,
    daysToRenew, monthsToRenew, renovar,
    badgeColor, badgeBg, badgeText,
  };
}

async function openDeviceDetail(id) {
  const device = allDevices.find(d => d.id === id);
  if (!device) return;
  currentDeviceId = id;
  currentDevice = device;

  document.getElementById('dev-list-view').style.display = 'none';
  document.getElementById('dev-detail-view').style.display = 'block';

  // Botón "Volver a {persona}" — solo si el user llegó desde la ficha del
  // Equipo Interno (js/it-team-panel.js setea window._returnToInternalMember).
  const returnCtx = window._returnToInternalMember;
  const returnBtn = document.getElementById('dev-return-to-member-btn');
  const returnLbl = document.getElementById('dev-return-to-member-label');
  if (returnBtn && returnLbl) {
    if (returnCtx && returnCtx.name) {
      returnLbl.textContent = 'Volver a ' + returnCtx.name;
      returnBtn.style.display = '';
    } else {
      returnBtn.style.display = 'none';
      returnLbl.textContent = '';
    }
  }
  const isOnline = (device.zohoStatus || '').toLowerCase() === 'online';
  const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
  const dotGlow  = isOnline ? '0 0 6px var(--hero-success)' : 'none';
  document.getElementById('dev-detail-title').innerHTML =
      '<div style="display:inline-flex;align-items:center;gap:10px;">'
    +   '<div style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';box-shadow:' + dotGlow + ';"></div>'
    +   '<span>' + (DEV_TIPO_ICON[device.tipo] || DEV_FALLBACK_ICON) + '  ' + escHtml(device.nombre) + '</span>'
    +   '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(0,0,0,0.06);color:' + dotColor + ';">' + (isOnline ? 'online' : 'offline') + '</span>'
    + '</div>';

  // Info — row() inyecta su segundo argumento como HTML, así que valores
  // venidos del backend deben ir pre-escapados con escHtml.
  const eColor = DEV_ESTADO_COLOR[device.estado] || 'var(--hero-text-body)';
  const lc = deviceLifecycle(device);
  const lifecycleRows = lc.hasData
    ? row('Comprado', escHtml(new Date(device.fechaCompra).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' })))
    + row('Vida útil', escHtml(device.vidaUtilAnios + ' año' + (device.vidaUtilAnios !== 1 ? 's' : '')))
    + row('Renovar antes de', '<span style="color:' + (lc.overdue ? 'var(--hero-danger)' : (lc.renovarSoon ? 'var(--hero-warning)' : 'var(--hero-text-primary)')) + ';font-weight:' + (lc.renovarSoon ? '600' : '400') + ';">'
        + escHtml(lc.renovar.toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }))
        + ' <span style="font-size:11px;color:var(--hero-text-muted);">(' + escHtml(lc.badgeText) + ')</span></span>')
    + (device.costoOriginal ? row('Costo original', '$' + Number(device.costoOriginal).toFixed(2) + ' USD') : '')
    : row('Lifecycle', '<span style="color:var(--hero-text-muted);font-size:11px;">Sin datos de compra · click editar para agregar fecha y vida útil</span>');

  // Filas live de Zoho (no editables; vienen de la API)
  const liveRows = device.zohoId
    ? row('Estado conexión', '<span style="color:' + dotColor + ';"><iconify-icon icon="tabler:circle-filled"></iconify-icon> ' + (isOnline ? 'Online' : 'Offline') + '</span>')
      + (device.zohoLiveOs ? row('SO detectado', escHtml(device.zohoLiveOs)) : '')
      + (device.zohoIp     ? row('IP',            '<span style="font-family:var(--mono);">' + escHtml(device.zohoIp) + '</span>') : '')
      + (device.zohoGroup  ? row('Grupo Zoho',    escHtml(device.zohoGroup)) : '')
    : '';

  document.getElementById('dev-detail-info').innerHTML =
    '<div style="display:grid;gap:6px;">'
    + liveRows
    + row('Usuario', escHtml(device.usuario || '—') + (device.usuario ? ' <button onclick="openInternalMemberByOwnerName(\'' + escJs(device.usuario) + '\')" class="btn btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:8px;vertical-align:middle;" title="Ver ficha de esta persona"><iconify-icon icon="tabler:user"></iconify-icon> Ver ficha</button>' : ''))
    + row('Tipo', escHtml(device.tipo))
    + row('SO (registrado)', escHtml(device.so || '—'))
    + row('GCPW', device.gcpw ? '<span style="color:var(--hero-primary);"><iconify-icon icon="tabler:check"></iconify-icon> Activado</span>' : '<span style="color:var(--hero-text-muted);"><iconify-icon icon="tabler:x"></iconify-icon> No activado</span>')
    + row('Estado IT', '<span style="color:' + eColor + ';">' + escHtml(device.estado) + '</span>')
    + lifecycleRows
    + '</div>'
    + (isOnline && device.zohoId
        ? '<button onclick="startZohoSession(\'' + escJs(device.zohoId) + '\',\'' + escJs(device.nombre) + '\')" class="btn btn-primary" style="width:100%;margin-top:14px;"><iconify-icon icon="tabler:screen-share"></iconify-icon> Iniciar sesión remota (Zoho)</button>'
        : '');

  // Apps
  const apps = device.apps || [];
  document.getElementById('dev-detail-apps').innerHTML = apps.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + apps.map(a =>
        '<span style="font-size:12px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--hero-border-card);border-radius:6px;color:var(--hero-text-body);">' + escHtml(a) + '</span>'
      ).join('') + '</div>'
    : '<span style="color:var(--hero-text-muted);font-size:12px;">Sin aplicaciones registradas</span>';

  renderHistorial(device.intervenciones || []);
}

function row(label, val) {
  return '<div style="display:flex;gap:8px;align-items:baseline;">'
    + '<span style="font-size:11px;color:var(--hero-text-muted);min-width:130px;">' + label + '</span>'
    + '<span style="font-size:13px;color:var(--hero-text-primary);">' + val + '</span>'
    + '</div>';
}

function renderHistorial(intervenciones) {
  const el = document.getElementById('dev-historial');
  if (!intervenciones.length) {
    el.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:clipboard-list"></iconify-icon></div><div class="log-empty-text">Sin intervenciones registradas</div></div>';
    return;
  }
  el.innerHTML = intervenciones.map(i => {
    const fecha = new Date(i.fecha).toLocaleString('es-MX', {
      timeZone:'America/New_York', month:'short', day:'numeric',
      year:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const color = INT_TIPO_COLOR[i.tipo] || 'var(--hero-text-body)';
    return '<div style="padding:12px 0;border-bottom:1px solid var(--hero-border-card);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
      + '<span style="font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.06);color:' + color + ';">' + escHtml(i.tipo) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);">' + fecha + ' ET</span>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--hero-text-primary);font-weight:500;margin-bottom:2px;">' + escHtml(i.descripcion) + '</div>'
      + (i.notas ? '<div style="font-size:12px;color:var(--hero-text-body);line-height:1.5;">' + escHtml(i.notas) + '</div>' : '')
      + '</div>';
  }).join('');
}

function closeDeviceDetail() {
  document.getElementById('dev-detail-view').style.display = 'none';
  document.getElementById('dev-list-view').style.display = 'block';
  currentDeviceId = null;
  currentDevice = null;
  // Al cerrar con "← Volver" normal, descartamos el contexto de retorno
  // para no mostrar el botón fantasma si el user reabre otra ficha después.
  window._returnToInternalMember = null;
  const rb = document.getElementById('dev-return-to-member-btn');
  if (rb) rb.style.display = 'none';
}

async function registrarIntervencion() {
  if (!currentDeviceId) return;
  const tipo        = document.getElementById('int-tipo').value;
  const descripcion = document.getElementById('int-descripcion').value.trim();
  const notas       = document.getElementById('int-notas').value.trim();
  if (!descripcion) { showToast('Escribe una descripción de la intervención'); return; }

  const btn = document.getElementById('btn-int');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';

  try {
    const resp = await authFetch(WORKER_URL + '/device/intervencion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentDeviceId, tipo, descripcion, notas })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    // Update local device
    currentDevice.intervenciones = currentDevice.intervenciones || [];
    currentDevice.intervenciones.unshift(data.intervencion);
    renderHistorial(currentDevice.intervenciones);

    // Update allDevices
    const idx = allDevices.findIndex(d => d.id === currentDeviceId);
    if (idx >= 0) allDevices[idx] = currentDevice;

    document.getElementById('int-descripcion').value = '';
    document.getElementById('int-notas').value = '';
    showToast('Intervención registrada');
    auditLog('dispositivo', tipo + ' en ' + currentDevice.nombre, descripcion);
  } catch(err) {
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:check"></iconify-icon> Registrar intervención';
}

// ── Formulario nuevo/editar ───────────────────────────────────
function showDeviceForm(device = null) {
  editingDeviceId = device ? device.id : null;
  document.getElementById('dev-modal-title').textContent = device ? 'Editar dispositivo' : 'Nuevo dispositivo';
  document.getElementById('dev-f-nombre').value  = device ? device.nombre  : '';
  document.getElementById('dev-f-tipo').value    = device ? device.tipo    : 'laptop';
  document.getElementById('dev-f-usuario').value = device ? device.usuario : '';
  document.getElementById('dev-f-so').value      = device ? device.so      : '';
  document.getElementById('dev-f-estado').value  = device ? device.estado  : 'activo';
  document.getElementById('dev-f-gcpw').checked  = device ? device.gcpw    : false;
  document.getElementById('dev-f-apps').value    = device ? (device.apps || []).join('\n') : '';
  document.getElementById('dev-f-fecha-compra').value = device ? (device.fechaCompra || '') : '';
  document.getElementById('dev-f-vida-util').value    = device && device.vidaUtilAnios != null ? device.vidaUtilAnios : 4;
  document.getElementById('dev-f-costo').value        = device && device.costoOriginal != null ? device.costoOriginal : '';
  document.getElementById('dev-modal').style.display = 'block';
}

function showEditDevice() {
  if (currentDevice) showDeviceForm(currentDevice);
}

function closeDeviceModal() {
  document.getElementById('dev-modal').style.display = 'none';
  editingDeviceId = null;
}

async function saveDevice() {
  const nombre  = document.getElementById('dev-f-nombre').value.trim();
  const tipo    = document.getElementById('dev-f-tipo').value;
  const usuario = document.getElementById('dev-f-usuario').value.trim();
  const so      = document.getElementById('dev-f-so').value.trim();
  const estado  = document.getElementById('dev-f-estado').value;
  const gcpw    = document.getElementById('dev-f-gcpw').checked;
  const appsRaw = document.getElementById('dev-f-apps').value;
  const apps    = appsRaw.split('\n').map(a => a.trim()).filter(Boolean);
  const fechaCompra   = document.getElementById('dev-f-fecha-compra').value || null;
  const vidaUtilRaw   = document.getElementById('dev-f-vida-util').value;
  const vidaUtilAnios = vidaUtilRaw ? Math.max(1, Math.min(15, parseInt(vidaUtilRaw, 10) || 4)) : null;
  const costoRaw      = document.getElementById('dev-f-costo').value;
  const costoOriginal = costoRaw ? Number(costoRaw) : null;

  if (!nombre) { showToast('El nombre del dispositivo es obligatorio'); return; }

  const btn = document.getElementById('btn-dev-save');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';

  try {
    const endpoint = editingDeviceId ? '/device/update' : '/device';
    const body = editingDeviceId
      ? { id: editingDeviceId, nombre, tipo, usuario, so, gcpw, apps, estado, fechaCompra, vidaUtilAnios, costoOriginal }
      : { nombre, tipo, usuario, so, gcpw, apps, estado, fechaCompra, vidaUtilAnios, costoOriginal };

    const resp = await authFetch(WORKER_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    showToast(editingDeviceId ? 'Dispositivo actualizado' : 'Dispositivo agregado');
    auditLog('dispositivo', (editingDeviceId ? 'Dispositivo actualizado: ' : 'Dispositivo agregado: ') + nombre, tipo + ' · ' + usuario);
    closeDeviceModal();
    // forzar fresh para reflejar la edición sin esperar el cache de 60s
    await loadDevices(true);

    // If editing, refresh detail view
    if (editingDeviceId && currentDeviceId === editingDeviceId) {
      const updated = allDevices.find(d => d.id === editingDeviceId);
      if (updated) { currentDevice = updated; openDeviceDetail(editingDeviceId); }
    }
  } catch(err) {
    showToast('Error: ' + err.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar dispositivo';
}

// ── Exportar reporte CSV ──────────────────────────────────────
function exportDeviceReport() {
  if (!currentDevice) return;
  const d = currentDevice;
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('es-MX', { timeZone: 'America/New_York', year:'numeric', month:'short', day:'numeric' }) : '';
  const fmtDateTime = ts => ts ? new Date(ts).toLocaleString('es-MX', { timeZone: 'America/New_York' }) : '';

  // Sección 1: Info del equipo
  let csv = csvRow(['REPORTE DE DISPOSITIVO']);
  csv += csvRow(['Generado', fmtDateTime(Date.now()) + ' ET']);
  csv += csvRow([]);
  csv += csvRow(['Campo', 'Valor']);
  csv += csvRow(['ID',                  d.id || '']);
  csv += csvRow(['Nombre / Hostname',   d.nombre || '']);
  csv += csvRow(['Tipo',                d.tipo || '']);
  csv += csvRow(['Usuario asignado',    d.usuario || '']);
  csv += csvRow(['SO (registrado)',     d.so || '']);
  csv += csvRow(['GCPW',                d.gcpw ? 'Activado' : 'No activado']);
  csv += csvRow(['Estado IT',           d.estado || '']);
  csv += csvRow(['Fecha de registro',   fmtDate(d.fecha)]);

  // Lifecycle (si hay datos)
  if (d.fechaCompra || d.vidaUtilAnios != null || d.costoOriginal != null) {
    csv += csvRow([]);
    csv += csvRow(['LIFECYCLE / RENOVACIÓN']);
    csv += csvRow(['Fecha de compra',     fmtDate(d.fechaCompra)]);
    csv += csvRow(['Vida útil (años)',    d.vidaUtilAnios != null ? d.vidaUtilAnios : '']);
    csv += csvRow(['Costo original (USD)', d.costoOriginal != null ? Number(d.costoOriginal).toFixed(2) : '']);
    // Renovación calculada
    if (d.fechaCompra && d.vidaUtilAnios) {
      const renovar = new Date(d.fechaCompra);
      renovar.setFullYear(renovar.getFullYear() + Number(d.vidaUtilAnios));
      const days = Math.ceil((renovar.getTime() - Date.now()) / 86400000);
      csv += csvRow(['Fecha de renovación', fmtDate(renovar.toISOString())]);
      csv += csvRow(['Días restantes',      days]);
    }
  }

  // Zoho live data (si está vinculado)
  if (d.zohoId) {
    csv += csvRow([]);
    csv += csvRow(['ESTADO ZOHO ASSIST (live)']);
    csv += csvRow(['Zoho ID',         d.zohoId]);
    csv += csvRow(['Conexión',        (d.zohoStatus || 'offline').toUpperCase()]);
    csv += csvRow(['SO detectado',    d.zohoLiveOs || '']);
    csv += csvRow(['IP',              d.zohoIp || '']);
    csv += csvRow(['Grupo Zoho',      d.zohoGroup || '']);
  }

  // Apps instaladas
  csv += csvRow([]);
  csv += csvRow(['APLICACIONES INSTALADAS']);
  const apps = d.apps || [];
  if (apps.length) {
    apps.forEach(a => { csv += csvRow([a]); });
    csv += csvRow(['Total', apps.length]);
  } else {
    csv += csvRow(['(sin aplicaciones registradas)']);
  }

  // Intervenciones
  csv += csvRow([]);
  csv += csvRow(['HISTORIAL DE INTERVENCIONES']);
  const ints = d.intervenciones || [];
  if (ints.length) {
    csv += csvRow(['Fecha ET', 'Tipo', 'Descripción', 'Notas']);
    ints.forEach(i => {
      csv += csvRow([fmtDateTime(i.fecha), i.tipo, i.descripcion, i.notas || '']);
    });
    csv += csvRow(['Total intervenciones', ints.length]);
  } else {
    csv += csvRow(['(sin intervenciones registradas)']);
  }

  const safeName = (d.nombre || 'dispositivo').replace(/[^a-zA-Z0-9\-]/g, '-').replace(/-+/g, '-');
  downloadCsv(csv, 'reporte-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  showToast('Reporte exportado');
}

// ── Sesión remota Zoho ────────────────────────────────────────
// Llama al Worker → API oficial de Zoho v2 → devuelve technician_uri.
// Abre la pestaña inmediatamente al click (evita bloqueo de popup) y la
// redirige cuando llega la URL real desde el backend.
async function startZohoSession(computerId, name) {
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    try {
      popup.document.write(
        '<title>Iniciando sesión Zoho...</title>'
        + '<div style="font-family:Trebuchet MS,Arial,sans-serif;text-align:center;padding:60px 20px;color:#444;">'
        +   '<div style="font-size:18px;font-weight:600;color:#06a3b6;margin-bottom:10px;">Iniciando sesión Zoho Assist</div>'
        +   '<div style="font-size:13px;color:#777;">Conectando con <strong>' + name.replace(/[<>]/g,'') + '</strong>...</div>'
        + '</div>'
      );
    } catch(_) {}
  }
  addLog('Iniciando sesión Zoho para ' + name + '...', 'info');
  showToast('Conectando con ' + name + '...');
  try {
    const resp = await authFetch(WORKER_URL + '/zoho/session/' + encodeURIComponent(computerId));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al iniciar sesión');
    if (!data.sessionUrl) throw new Error('Zoho no devolvió URL de sesión');
    if (popup) popup.location.href = data.sessionUrl;
    else window.open(data.sessionUrl, '_blank');
    auditLog('zoho', 'Sesion remota iniciada: ' + name, computerId);
    addLog('Sesión Zoho lista', 'info');
  } catch(err) {
    if (popup) try { popup.close(); } catch(_) {}
    showToast('Error Zoho: ' + err.message);
    addLog('Error sesión Zoho: ' + err.message, 'error');
  }
}
// ── Render session logs on demand ───────────────────────────
function renderSessionLogs() {
  const body = document.getElementById('log-body');
  if (!body) return;
  if (!sessionLogs.length) {
    body.innerHTML = '<div class="log-empty"><div class="log-empty-icon"><iconify-icon icon="tabler:clipboard-list"></iconify-icon></div><div class="log-empty-text">Sin actividad en esta sesión</div></div>';
    return;
  }
  body.innerHTML = sessionLogs.map(l =>
    '<div class="log-line"><span class="log-time">' + l.time + '</span>' +
    '<span class="log-msg ' + l.type + '">' + l.message + '</span></div>'
  ).join('');
  body.scrollTop = body.scrollHeight;
}

// ── A11y: foco y teclado para modales ────────────────────────
// Detecta automáticamente cuando un [role="dialog"][aria-modal="true"]
// cambia entre display:none y display:block via MutationObserver. Al abrir:
// guarda lastFocus, mueve foco al primer focusable y atrapa Tab. Al cerrar:
// restaura lastFocus. ESC global cierra cualquier dialog visible llamando
// a data-close-fn. Esto evita refactorizar cada función openXxx existente.
function _isModalVisible(modal) {
  const display = modal.style.display || getComputedStyle(modal).display;
  return display !== 'none';
}
function _getFocusables(container) {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(sel))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}
function _setupModalA11y(modal) {
  let lastFocus = null;
  let trapHandler = null;
  let wasVisible = _isModalVisible(modal);

  const onVisible = () => {
    lastFocus = document.activeElement;
    const focusables = _getFocusables(modal);
    if (focusables.length) setTimeout(() => { try { focusables[0].focus(); } catch (_) {} }, 0);
    trapHandler = (e) => {
      if (e.key !== 'Tab') return;
      const f = _getFocusables(modal);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    modal.addEventListener('keydown', trapHandler);
  };
  const onHidden = () => {
    if (trapHandler) { modal.removeEventListener('keydown', trapHandler); trapHandler = null; }
    if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  };

  new MutationObserver(() => {
    const visible = _isModalVisible(modal);
    if (visible && !wasVisible) onVisible();
    else if (!visible && wasVisible) onHidden();
    wasVisible = visible;
  }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
}
function installModalA11y() {
  document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(_setupModalA11y);
  // ESC re-querea cada vez para capturar modales agregados dinámicamente
  // (ej: heroConfirm que se crea on-demand).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    const visible = Array.from(modals).find(_isModalVisible);
    if (!visible) return;
    const fnName = visible.getAttribute('data-close-fn');
    if (fnName && typeof window[fnName] === 'function') window[fnName]();
    else visible.style.display = 'none';
  });
}

// ── Atajos de teclado ─────────────────────────────────────────
// "/" foco al buscador, "?" muestra cheatsheet, "g X" navega entre páginas.
// Se desactivan cuando hay foco en un input editable o un modal abierto,
// para no interferir con el usuario tipeando.
function _shortcutsHelp() {
  let modal = document.getElementById('shortcuts-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shortcuts-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Atajos de teclado');
    modal.setAttribute('data-close-fn', '__shortcutsClose');
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(26,39,51,0.5);z-index:200;overflow-y:auto;padding:24px;';
    modal.innerHTML =
        '<div style="background:#fff;border:1px solid var(--hero-border);border-radius:14px;max-width:440px;margin:60px auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18);">'
      +   '<div style="font-size:16px;font-weight:700;color:var(--hero-text-primary);margin-bottom:14px;">⌨️ Atajos de teclado</div>'
      +   '<div style="display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:13px;align-items:center;">'
      +     '<kbd>/</kbd><span>Buscador global</span>'
      +     '<kbd>g h</kbd><span>Home</span>'
      +     '<kbd>g s</kbd><span>Solicitudes</span>'
      +     '<kbd>g u</kbd><span>Usuarios</span>'
      +     '<kbd>g t</kbd><span>Soporte · Tickets</span>'
      +     '<kbd>g k</kbd><span>Soporte · Toolbox</span>'
      +     '<kbd>g d</kbd><span>Soporte · Dispositivos</span>'
      +     '<kbd>g a</kbd><span>Auditoría</span>'
      +     '<kbd>g r</kbd><span>Reset contraseña</span>'
      +     '<kbd>Esc</kbd><span>Cerrar modal</span>'
      +     '<kbd>?</kbd><span>Mostrar este panel</span>'
      +   '</div>'
      +   '<div style="display:flex;justify-content:flex-end;margin-top:18px;">'
      +     '<button id="shortcuts-close" class="btn btn-secondary" style="font-size:13px;">Cerrar</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modal);
    const style = document.createElement('style');
    style.textContent = '#shortcuts-modal kbd { font-family: var(--mono); background: var(--hero-bg-page); border: 1px solid var(--hero-border-card); border-radius: 4px; padding: 2px 8px; font-size: 11px; color: var(--hero-text-primary); display: inline-block; min-width: 30px; text-align: center; }';
    document.head.appendChild(style);
    if (typeof _setupModalA11y === 'function') _setupModalA11y(modal);
    const close = () => { modal.style.display = 'none'; };
    window.__shortcutsClose = close;
    modal.querySelector('#shortcuts-close').onclick = close;
  }
  modal.style.display = 'block';
}

function installKeyboardShortcuts() {
  let lastG = 0;
  document.addEventListener('keydown', (e) => {
    // No interferir si está escribiendo en un input editable
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    // No interferir si hay un dialog abierto (Esc lo maneja installModalA11y)
    const modalOpen = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(_isModalVisible);
    if (modalOpen) return;
    // "?" sin modificadores → cheatsheet
    if (e.key === '?') { e.preventDefault(); _shortcutsHelp(); return; }
    // "/" sin modificadores → buscador
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openGlobalSearch(); return; }
    // "g" inicia combo
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      lastG = Date.now();
      return;
    }
    if (lastG && Date.now() - lastG < 800) {
      // g m mantiene Home por memoria muscular (era 'Mi día'). g d ahora es
      // Dispositivos (sub-tab de Soporte). Home usa g h.
      const map = { h:'dashboard', m:'dashboard', t:'tickets', s:'solicitudes', u:'usuarios', a:'auditoria', r:'reset', k:'toolbox', d:'dispositivos' };
      if (map[e.key]) {
        e.preventDefault();
        showPage(map[e.key]);
        lastG = 0;
      }
    }
  });
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
  installModalA11y();
  installKeyboardShortcuts();
  if (checkExistingSession()) {
    addLog('Hero IT Console iniciado. Sesión restaurada.', 'info');
    addLog('Sistema listo. Worker conectado a Resend.', 'success');
  } else {
    addLog('Hero IT Console cargando... autenticando desde Hero Hub.', 'info');
    bootstrapFromHub();
  }
})();

// ── Módulo Offboarding ────────────────────────────────────────
const OB_STEPS = [
  { id: 'suspend',    label: 'Suspender cuenta de Google Workspace',       icon: '<iconify-icon icon="tabler:lock"></iconify-icon>', auto: true  },
  { id: 'sessions',  label: 'Revocar todas las sesiones activas',           icon: '<iconify-icon icon="tabler:ban"></iconify-icon>', auto: false },
  { id: 'groups',    label: 'Remover de Google Groups y carpetas Drive',    icon: '<iconify-icon icon="tabler:folder"></iconify-icon>', auto: false },
  { id: 'shared',    label: 'Cambiar contraseñas de cuentas compartidas',   icon: '<iconify-icon icon="tabler:key"></iconify-icon>', auto: false },
  { id: 'zoho',      label: 'Revocar acceso a Zoho Assist',                icon: '<iconify-icon icon="tabler:screen-share"></iconify-icon>', auto: false },
  { id: 'external',  label: 'Revocar accesos a sistemas externos (carriers, ClickUp, etc.)', icon: '<iconify-icon icon="tabler:world"></iconify-icon>', auto: false },
  { id: 'equipment', label: 'Gestionar devolución de equipos',              icon: '<iconify-icon icon="tabler:device-desktop"></iconify-icon>', auto: false },
  { id: 'record',    label: 'Registrar baja en sistema de RR.HH.',          icon: '<iconify-icon icon="tabler:clipboard-list"></iconify-icon>', auto: false },
];

let obSelectedUser = null;
let obStepStatus   = {};

function renderOffboardingSteps() {
  OB_STEPS.forEach(s => { if (!obStepStatus[s.id]) obStepStatus[s.id] = 'pending'; });
  const container = document.getElementById('ob-steps');
  if (!container) return;
  container.innerHTML = OB_STEPS.map(s => {
    const st    = obStepStatus[s.id];
    const isDone = st === 'done';
    const bgColor = isDone ? 'var(--hero-success-bg)' : 'var(--hero-bg)';
    const border  = isDone ? 'rgba(34,160,107,0.3)' : 'var(--hero-border)';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:' + bgColor + ';border:1px solid ' + border + ';border-radius:var(--hero-radius-sm);transition:all 0.2s;">'
      + '<span style="font-size:16px;flex-shrink:0;">' + s.icon + '</span>'
      + '<div style="flex:1;">'
      + '<div style="font-size:13px;font-weight:' + (isDone ? '600' : '400') + ';color:' + (isDone ? 'var(--hero-success)' : 'var(--hero-text-primary)') + ';text-decoration:' + (isDone ? 'line-through' : 'none') + ';">' + s.label + '</div>'
      + (s.auto ? '<div style="font-size:10px;color:var(--hero-primary);margin-top:2px;">Automático via API</div>' : '')
      + '</div>'
      + '<button onclick="toggleObStep(\'' + s.id + '\')" style="background:' + (isDone ? 'var(--hero-success)' : 'transparent') + ';border:1px solid ' + (isDone ? 'var(--hero-success)' : 'var(--hero-border)') + ';color:' + (isDone ? '#fff' : 'var(--hero-text-muted)') + ';width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0;">'
      + (isDone ? '<iconify-icon icon="tabler:check"></iconify-icon>' : '') + '</button>'
      + '</div>';
  }).join('');
  // Update progress
  const done = Object.values(obStepStatus).filter(v => v === 'done').length;
  const el = document.getElementById('ob-progress-label');
  if (el) el.textContent = done + ' / ' + OB_STEPS.length + ' completados';
}

function toggleObStep(id) {
  obStepStatus[id] = obStepStatus[id] === 'done' ? 'pending' : 'done';
  renderOffboardingSteps();
}

function filterOffboardingUsers() {
  const q = document.getElementById('ob-search').value.toLowerCase();
  const suggestions = document.getElementById('ob-user-suggestions');
  if (!q || q.length < 2 || !window._workspaceUsers) { suggestions.style.display = 'none'; return; }
  const matches = window._workspaceUsers.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!matches.length) { suggestions.style.display = 'none'; return; }
  suggestions.style.display = 'block';
  suggestions.innerHTML = matches.map(u =>
    '<div onclick="selectOffboardingUser(\'' + escJs(u.email) + '\',\'' + escJs(u.nombre) + '\')" style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--hero-border);" onmouseover="this.style.background=\'var(--hero-bg)\'" onmouseout="this.style.background=\'\'">'
    + '<div style="font-weight:600;color:var(--hero-text-primary);">' + escHtml(u.nombre) + '</div>'
    + '<div style="font-size:11px;color:var(--hero-text-muted);">' + escHtml(u.email) + '</div></div>'
  ).join('');
}

function selectOffboardingUser(email, nombre) {
  obSelectedUser = { email, nombre };
  document.getElementById('ob-search').value = nombre;
  document.getElementById('ob-user-suggestions').style.display = 'none';
  document.getElementById('ob-user-name').textContent = nombre;
  document.getElementById('ob-user-email').textContent = email;
  document.getElementById('ob-selected-user').style.display = 'block';
  obStepStatus = {};
  renderOffboardingSteps();
}

function clearOffboardingUser() {
  obSelectedUser = null;
  obStepStatus   = {};
  document.getElementById('ob-search').value = '';
  document.getElementById('ob-selected-user').style.display = 'none';
  renderOffboardingSteps();
}

function resetOffboarding() {
  clearOffboardingUser();
  document.getElementById('ob-notas').value = '';
}

async function executeOffboarding() {
  if (!obSelectedUser) { showToast('Selecciona un usuario primero'); return; }
  const notas = document.getElementById('ob-notas').value.trim();
  const tipo  = document.getElementById('ob-tipo').value;
  const btn   = document.getElementById('btn-ob-execute');
  const done  = Object.values(obStepStatus).filter(v => v === 'done').length;

  if (!(await heroConfirm({
    title: '¿Ejecutar offboarding?',
    body: obSelectedUser.nombre + ' (' + obSelectedUser.email + '). Esto suspenderá su cuenta de Google Workspace y quedará registrado en Auditoría.',
    confirmText: 'Ejecutar offboarding', destructive: true, mustType: obSelectedUser.email,
  }))) return;

  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Ejecutando...';

  // Step 1: Auto-suspend Workspace account
  try {
    const r = await authFetch(WORKER_URL + '/user-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: obSelectedUser.email, action: 'suspend' })
    });
    if (r.ok) {
      obStepStatus['suspend'] = 'done';
      addLog('Cuenta suspendida: ' + obSelectedUser.email, 'success');
    }
  } catch(e) { addLog('Error al suspender cuenta: ' + e.message, 'error'); }

  renderOffboardingSteps();

  // Register in audit
  const detail = 'Tipo: ' + tipo + ' | Pasos completados: ' + (done + 1) + '/' + OB_STEPS.length + (notas ? ' | ' + notas : '');
  auditLog('offboarding', 'Offboarding ejecutado: ' + obSelectedUser.nombre, detail);
  addLog('Offboarding registrado en auditoría', 'success');
  showToast('Offboarding ejecutado. Cuenta suspendida.');

  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:door-exit"></iconify-icon> Ejecutar offboarding';
}

// ── Módulo Toolbox ────────────────────────────────────────────
// Caja de herramientas: scripts (con etiqueta de lenguaje), comandos one-liner,
// tips cortos y procesos paso-a-paso. Usa el mismo endpoint /kb y prefijo KV
// 'kb_' para no romper las entradas que ya existen (las que vienen sin 'tipo'
// se renderizan como 'proceso' por backward compat).
let allToolbox = [];
let editingToolboxId = null;
let _toolboxOrigenTicket = null;
let _toolboxTypeFilter = '';   // '' = todos | 'script' | 'comando' | 'tip' | 'proceso'
let _toolboxFormType = 'proceso';

const TOOLBOX_TYPE_META = {
  script:  { label: 'Script',  icon: 'tabler:terminal-2',   badge: 'tbx-type-script'  },
  comando: { label: 'Comando', icon: 'tabler:command',      badge: 'tbx-type-comando' },
  tip:     { label: 'Tip',     icon: 'tabler:bulb',         badge: 'tbx-type-tip'     },
  proceso: { label: 'Proceso', icon: 'tabler:list-numbers', badge: 'tbx-type-proceso' },
};
const TOOLBOX_LANG_LABEL = {
  powershell: 'PowerShell',
  bash:       'Bash',
  cmd:        'CMD',
  sql:        'SQL',
  python:     'Python',
  javascript: 'JavaScript',
  otro:       'Code',
};

// Backward compat: entries viejas sin 'tipo' → proceso
function _tbxType(a) {
  const t = a.tipo;
  return TOOLBOX_TYPE_META[t] ? t : 'proceso';
}

async function loadToolbox() {
  renderSkeleton(document.getElementById('tbx-grid'), { type: 'card', rows: 3 });
  try {
    const r = await authFetch(WORKER_URL + '/kb');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error');
    allToolbox = d.articulos || [];
    filterToolbox();
  } catch (e) {
    renderError(document.getElementById('tbx-grid'), e, loadToolbox);
  }
}

function _updateToolboxCounts() {
  const c = { '': allToolbox.length, script:0, comando:0, tip:0, proceso:0 };
  allToolbox.forEach(a => { c[_tbxType(a)]++; });
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('tbx-count-all', c['']);
  set('tbx-count-script', c.script);
  set('tbx-count-comando', c.comando);
  set('tbx-count-tip', c.tip);
  set('tbx-count-proceso', c.proceso);
}

function setToolboxType(tipo) {
  _toolboxTypeFilter = tipo;
  document.querySelectorAll('#tbx-type-chips .tbx-chip').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-type') === tipo);
  });
  filterToolbox();
}

function filterToolbox() {
  _updateToolboxCounts();
  const q = (document.getElementById('tbx-search').value || '').toLowerCase();
  let list = allToolbox;
  if (_toolboxTypeFilter) {
    list = list.filter(a => _tbxType(a) === _toolboxTypeFilter);
  }
  if (q) {
    list = list.filter(a => {
      const blob = (a.titulo + ' ' + (a.contenido || '') + ' ' + (a.tags || []).join(' ')).toLowerCase();
      return blob.includes(q);
    });
  }
  document.getElementById('tbx-count').textContent = list.length + ' entrada' + (list.length !== 1 ? 's' : '');
  renderToolbox(list);
}

function renderToolbox(items) {
  const grid = document.getElementById('tbx-grid');
  if (!items.length) {
    renderEmpty(grid, {
      icon: '<iconify-icon icon="tabler:tools"></iconify-icon>',
      message: allToolbox.length ? 'Sin resultados con ese filtro.' : 'Aún no hay entradas. Guardá tu primer script, tip o proceso para tenerlo a mano.',
      ctaText: allToolbox.length ? '' : '<iconify-icon icon="tabler:plus"></iconify-icon> Crear primera entrada',
      ctaFn: allToolbox.length ? null : () => showToolboxForm(),
    });
    return;
  }
  grid.innerHTML = items.map(a => {
    const tipo = _tbxType(a);
    const meta = TOOLBOX_TYPE_META[tipo];
    const fecha = a.fecha ? new Date(a.fecha).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }) : '';
    const tagsHtml = (a.tags || []).slice(0, 4).map(t => '<span class="tbx-tag">' + escHtml(t) + '</span>').join(' ');
    const langHtml = (tipo === 'script' && a.lenguaje)
      ? '<span class="tbx-lang-badge">' + escHtml(TOOLBOX_LANG_LABEL[a.lenguaje] || a.lenguaje) + '</span>'
      : '';
    const contenido = a.contenido || '';
    // El contenido se inyecta como textContent en el render para evitar XSS
    // y para que los saltos de línea queden tal cual (white-space:pre-wrap).
    const useCodeBlock = (tipo === 'script' || tipo === 'comando');
    const blockClass = useCodeBlock
      ? (tipo === 'comando' ? 'tbx-code tbx-code-comando' : 'tbx-code')
      : 'tbx-text';
    return ''
      + '<div class="tbx-card" data-tbx-id="' + escHtml(a.id) + '">'
      +   '<div class="tbx-card-head">'
      +     '<span class="tbx-type-badge ' + meta.badge + '"><iconify-icon icon="' + meta.icon + '"></iconify-icon> ' + meta.label + '</span>'
      +     langHtml
      +     '<div class="tbx-card-title" onclick="openToolboxEntry(\'' + escJs(a.id) + '\')">' + escHtml(a.titulo) + '</div>'
      +   '</div>'
      +   (tagsHtml ? '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + tagsHtml + '</div>' : '')
      +   '<div class="' + blockClass + '" data-tbx-content="' + escHtml(a.id) + '">'
      +     '<button class="tbx-copy-btn" onclick="copyToolboxEntry(\'' + escJs(a.id) + '\', this)" title="Copiar al portapapeles"><iconify-icon icon="tabler:copy"></iconify-icon> Copiar</button>'
      +   '</div>'
      +   '<div class="tbx-card-foot">'
      +     (fecha ? '<iconify-icon icon="tabler:calendar"></iconify-icon> ' + escHtml(fecha) : '')
      +     (a.ticketOrigen ? ' · <iconify-icon icon="tabler:ticket"></iconify-icon> ' + escHtml(a.ticketOrigen) : '')
      +     '<button onclick="openToolboxEntry(\'' + escJs(a.id) + '\')" style="margin-left:auto;background:transparent;border:none;color:var(--hero-text-muted);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:4px;" title="Editar"><iconify-icon icon="tabler:edit"></iconify-icon> Editar</button>'
      +   '</div>'
      + '</div>';
  }).join('');
  // Inyectar contenido como texto plano (XSS-safe) preservando saltos de línea
  items.forEach(a => {
    const el = grid.querySelector('[data-tbx-content="' + CSS.escape(a.id) + '"]');
    if (!el) return;
    const btn = el.querySelector('.tbx-copy-btn');
    const txt = document.createTextNode(a.contenido || '');
    el.insertBefore(txt, btn);
  });
}

function openToolboxEntry(id) {
  const a = allToolbox.find(x => x.id === id);
  if (!a) return;
  showToolboxForm(a);
}

// Cambia el tipo seleccionado en el modal y ajusta el form (lenguaje + input vs textarea)
function setFormType(tipo) {
  if (!TOOLBOX_TYPE_META[tipo]) tipo = 'proceso';
  _toolboxFormType = tipo;
  document.querySelectorAll('#tbx-f-tipo-chips .tbx-type-pick').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-type') === tipo);
  });
  const langWrap = document.getElementById('tbx-f-lang-wrap');
  const labelEl  = document.getElementById('tbx-f-contenido-label');
  const txt      = document.getElementById('tbx-f-contenido');
  const cmd      = document.getElementById('tbx-f-comando');
  if (tipo === 'script') {
    langWrap.style.display = '';
    labelEl.textContent = 'Script *';
    cmd.style.display = 'none';
    txt.style.display = '';
    txt.placeholder = '# Pegá tu script acá\nGet-Process | Where-Object { $_.CPU -gt 100 }';
    txt.rows = 14;
  } else if (tipo === 'comando') {
    langWrap.style.display = 'none';
    labelEl.textContent = 'Comando *';
    txt.style.display = 'none';
    cmd.style.display = '';
  } else if (tipo === 'tip') {
    langWrap.style.display = 'none';
    labelEl.textContent = 'Tip *';
    cmd.style.display = 'none';
    txt.style.display = '';
    txt.placeholder = 'ej: En Outlook, F9 fuerza envío/recibo de todas las cuentas configuradas.';
    txt.rows = 5;
  } else {
    langWrap.style.display = 'none';
    labelEl.textContent = 'Pasos / Procedimiento *';
    cmd.style.display = 'none';
    txt.style.display = '';
    txt.placeholder = '1. Hacer X\n2. Verificar Y\n3. Si Y falla, hacer Z';
    txt.rows = 12;
  }
}

function showToolboxForm(entrada) {
  editingToolboxId = entrada ? entrada.id : null;
  document.getElementById('tbx-modal-title').textContent = entrada ? 'Editar entrada' : 'Nueva entrada';
  const tipo = entrada ? _tbxType(entrada) : 'script';
  setFormType(tipo);
  document.getElementById('tbx-f-titulo').value = entrada ? entrada.titulo : '';
  document.getElementById('tbx-f-tags').value   = entrada ? (entrada.tags || []).join(', ') : '';
  document.getElementById('tbx-f-lang').value   = (entrada && entrada.lenguaje) ? entrada.lenguaje : 'powershell';
  // Comando va en input de una sola línea; el resto en textarea
  if (tipo === 'comando') {
    document.getElementById('tbx-f-comando').value = entrada ? entrada.contenido : '';
    document.getElementById('tbx-f-contenido').value = '';
  } else {
    document.getElementById('tbx-f-contenido').value = entrada ? entrada.contenido : '';
    document.getElementById('tbx-f-comando').value = '';
  }
  document.getElementById('btn-tbx-del').style.display = entrada ? 'inline-block' : 'none';
  const origenEl = document.getElementById('tbx-f-origen');
  if (entrada && entrada.ticketOrigen) {
    origenEl.style.display = 'block';
    origenEl.textContent = 'Generada desde ticket ' + entrada.ticketOrigen;
  } else if (_toolboxOrigenTicket) {
    origenEl.style.display = 'block';
    origenEl.textContent = 'Se vinculará al ticket ' + _toolboxOrigenTicket;
  } else {
    origenEl.style.display = 'none';
  }
  document.getElementById('tbx-modal').style.display = 'block';
}

function closeToolboxModal() {
  document.getElementById('tbx-modal').style.display = 'none';
  editingToolboxId = null;
  _toolboxOrigenTicket = null;
}

async function saveToolbox() {
  const tipo      = _toolboxFormType;
  const titulo    = document.getElementById('tbx-f-titulo').value.trim();
  const contenido = (tipo === 'comando'
    ? document.getElementById('tbx-f-comando').value
    : document.getElementById('tbx-f-contenido').value).trim();
  const tags      = document.getElementById('tbx-f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const lenguaje  = tipo === 'script' ? document.getElementById('tbx-f-lang').value : null;
  if (!titulo) { showToast('Falta el título'); return; }
  if (!contenido) { showToast('Falta el contenido'); return; }
  const btn = document.getElementById('btn-tbx-save');
  btn.disabled = true;
  btn.innerHTML = '<l-ring size="14" stroke="2" speed="0.7" color="#06a3b6"></l-ring> Guardando...';
  try {
    if (editingToolboxId) {
      const r = await authFetch(WORKER_URL + '/kb/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingToolboxId, titulo, contenido, tags, tipo, lenguaje }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      // Actualizamos en memoria con la entrada que devolvió el server.
      // Evita el re-fetch que pegaba contra cache_kb_list (KV list es
      // eventually consistent: el PUT recién hecho puede no aparecer
      // todavía y la lista vacía/parcial quedaba cacheada 60s).
      if (d.articulo) {
        const idx = allToolbox.findIndex(x => x.id === editingToolboxId);
        if (idx >= 0) allToolbox[idx] = d.articulo;
      }
      showToast('Entrada actualizada');
      auditLog('toolbox', 'Toolbox actualizado: ' + titulo);
    } else {
      const r = await authFetch(WORKER_URL + '/kb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, contenido, tags, tipo, lenguaje, ticketOrigen: _toolboxOrigenTicket || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      if (d.articulo) allToolbox.unshift(d.articulo);
      showToast('Entrada creada');
      auditLog('toolbox', 'Toolbox creado: ' + titulo, _toolboxOrigenTicket ? 'desde ' + _toolboxOrigenTicket : null);
    }
    closeToolboxModal();
    filterToolbox();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<iconify-icon icon="tabler:device-floppy"></iconify-icon> Guardar';
}

async function deleteToolboxCurrent() {
  if (!editingToolboxId) return;
  const a = allToolbox.find(x => x.id === editingToolboxId);
  if (!(await heroConfirm({
    title: '¿Eliminar entrada?',
    body: 'Vas a eliminar "' + (a ? a.titulo : 'esta entrada') + '". Esta acción no se puede deshacer.',
    confirmText: 'Eliminar', destructive: true,
  }))) return;
  try {
    const r = await authFetch(WORKER_URL + '/kb/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingToolboxId }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    showToast('Entrada eliminada');
    auditLog('toolbox', 'Toolbox eliminado: ' + (a ? a.titulo : editingToolboxId));
    const removedId = editingToolboxId;
    closeToolboxModal();
    allToolbox = allToolbox.filter(x => x.id !== removedId);
    filterToolbox();
  } catch (e) { showToast('Error: ' + e.message); }
}

// Copia el contenido al portapapeles con feedback visual en el botón.
async function copyToolboxEntry(id, btn) {
  const a = allToolbox.find(x => x.id === id);
  if (!a) return;
  try {
    await navigator.clipboard.writeText(a.contenido || '');
    const original = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '<iconify-icon icon="tabler:check"></iconify-icon> Copiado';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = original;
    }, 1400);
  } catch (e) {
    showToast('No se pudo copiar: ' + e.message);
  }
}

// Botón "Guardar en Toolbox" del modal de ticket → pre-llena el form con
// asunto + descripción + respuesta del ticket actual como 'proceso'. Útil
// para capturar la solución de un caso recurrente sin re-escribirla.
function guardarComoToolbox() {
  if (!currentTicketId) return;
  const t = allTickets.find(x => x.id === currentTicketId);
  if (!t) return;
  const respuesta = (document.getElementById('modal-respuesta').value || '').trim();
  const contenidoSugerido =
      'PROBLEMA\n' + (t.descripcion || '') + '\n\n'
    + 'CATEGORÍA: ' + (t.categoria || '—') + '\n'
    + 'PRIORIDAD: ' + (t.prioridad || '—') + '\n\n'
    + 'SOLUCIÓN\n' + (respuesta || '(escribe la solución aquí)');
  _toolboxOrigenTicket = t.ticketId || t.id;
  closeTicketModal();
  showToolboxForm();
  // Forzamos tipo 'proceso' tras el showToolboxForm() que abrió en 'script' por defecto
  setFormType('proceso');
  document.getElementById('tbx-f-titulo').value = (t.asunto || '').slice(0, 120);
  document.getElementById('tbx-f-contenido').value = contenidoSugerido;
  document.getElementById('tbx-f-tags').value = (t.categoria || '').toLowerCase();
}

// ══════════════════════════════════════════════════════════════
// Plantillas de email — página de preview
// ══════════════════════════════════════════════════════════════
// Renderiza los templates de email del IT Console con datos de ejemplo
// dentro de un iframe. Reusa las funciones buildOnboardingEmail,
// buildEmailReset y buildEmailSuspension que ya viven en este archivo.
// Se inicializa una sola vez (guard _plantillasBooted) porque no depende
// de datos remotos.

var _plantillasBooted = false;

var PLANTILLAS_SAMPLE = {
  nombre: 'Juan Perez',
  email: 'jperez@heroinsuranceusa.com',
  password: 'TempPass2026!'
};

var PLANTILLAS_TEMPLATES = {
  'emp-es': {
    label: 'Onboarding empleado ES',
    build: function() { return buildOnboardingEmail(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, PLANTILLAS_SAMPLE.password, 'empleado', 'es'); },
    subject: 'Bienvenido(a) a Hero Insurance USA - Informacion de acceso',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(correo personal del nuevo empleado, ej. juan.perez@gmail.com)',
    trigger: 'IT crea la cuenta en Workspace desde el modulo "Crear Usuario" con tipo=empleado. Se envia inmediatamente al correo personal indicado.',
    endpoint: 'POST /email/onboarding',
    sections: ['Header con logo + role "Empleado"', 'Card credenciales', '4 pasos numerados de inicio de sesion', 'Politicas de seguridad', 'CTA Abrir ticket de soporte']
  },
  'emp-en': {
    label: 'Onboarding empleado EN',
    build: function() { return buildOnboardingEmail(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, PLANTILLAS_SAMPLE.password, 'empleado', 'en'); },
    subject: 'Welcome to Hero Insurance USA - Account access information',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(personal email of the new employee)',
    trigger: 'Same as above with English toggle. Used when the new hire prefers English.',
    endpoint: 'POST /email/onboarding',
    sections: ['Header with logo + role "Employee"', 'Credentials card', '4 numbered login steps', 'Security policies', 'CTA Open support ticket']
  },
  'agt-es': {
    label: 'Onboarding agente ES',
    build: function() { return buildOnboardingEmail(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, PLANTILLAS_SAMPLE.password, 'agente', 'es'); },
    subject: 'Bienvenido(a) a Hero Insurance USA - Acceso de Agente',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(correo personal del nuevo agente)',
    trigger: 'IT procesa una solicitud de ALTA autorizada donde tipoPersona=agente. Version reducida sin pasos ni politicas.',
    endpoint: 'POST /email/onboarding',
    sections: ['Header con logo + role "Agente"', 'Card credenciales', 'CTA Abrir ticket de soporte (directo)']
  },
  'agt-en': {
    label: 'Onboarding agente EN',
    build: function() { return buildOnboardingEmail(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, PLANTILLAS_SAMPLE.password, 'agente', 'en'); },
    subject: 'Welcome to Hero Insurance USA - Agent access',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(personal email of the new agent)',
    trigger: 'Same as above with English toggle.',
    endpoint: 'POST /email/onboarding',
    sections: ['Header with logo + role "Agent"', 'Credentials card', 'CTA Open support ticket']
  },
  'reset': {
    label: 'Reset de contrasena',
    build: function() { return buildEmailReset(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, PLANTILLAS_SAMPLE.password); },
    subject: 'Restablecimiento de contrasena - Hero Insurance USA',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: 'La cuenta corporativa afectada',
    trigger: 'IT resetea la contrasena desde el modal de usuario del IT Console. Se envia al mismo correo corporativo reseteado.',
    endpoint: 'POST /email',
    sections: ['Header con logo', 'Aviso de seguridad amarillo', 'Card credenciales', 'CTA Contactar soporte', 'Timestamp']
  },
  'suspension': {
    label: 'Suspension de cuenta',
    build: function() {
      var fecha = new Date(Date.now() + 7 * 86400000).toLocaleDateString('es-ES', {
        timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric'
      });
      // Motivo de ejemplo — el motivo real lo elige Fernando en askSuspensionReason
      // al momento de suspender. Aquí mostramos el caso más común para el preview.
      var motivoEjemplo = 'por falta de uso: no se ha detectado actividad en los últimos 3 meses.';
      return buildEmailSuspension(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email, fecha, motivoEjemplo);
    },
    subject: 'Tu cuenta jperez@heroinsuranceusa.com fue suspendida — Hero Insurance USA',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(correo personal registrado en shared/workspaceUsers)',
    trigger: 'IT suspende una cuenta desde el modal de Usuarios o desde una solicitud de baja. Antes de suspender se abre un modal para elegir el motivo (con pre-selección inteligente según el último login). El motivo elegido aparece tal cual en el email al usuario.',
    endpoint: 'POST /email/onboarding (mismo endpoint que onboarding porque acepta destinos externos)',
    sections: ['Header rojo con badge SUSPENDIDA', 'Bloque de motivo específico (elegido en el modal)', 'Explicación breve', 'Advertencia amarilla del plazo de 15 días', 'CTA Solicitar reactivación (mailto)', 'Contacto directo']
  },
  'reactivacion': {
    label: 'Reactivacion de cuenta',
    build: function() { return buildEmailReactivation(PLANTILLAS_SAMPLE.nombre, PLANTILLAS_SAMPLE.email); },
    subject: 'Tu cuenta jperez@heroinsuranceusa.com fue reactivada — Hero Insurance USA',
    from: 'Fernando Romero <it@heroinsuranceusa.com>',
    to: '(correo personal registrado en shared/workspaceUsers)',
    trigger: 'IT reactiva una cuenta previamente suspendida (userAction restore). Cierra el loop del email de suspensión que prometía la posibilidad de reactivación.',
    endpoint: 'POST /email/onboarding',
    sections: ['Header verde con badge REACTIVADA', 'Confirmación amistosa', 'CTA Iniciar sesión (mail.google.com)', 'Bloque de ayuda con contacto IT']
  }
};

var _plantillasCurrentKey = 'emp-es';

function loadPlantillas() {
  if (_plantillasBooted) {
    // Solo re-render por si cambio algo, pero mantenemos la tab activa.
    _plantillasRenderPreview(_plantillasCurrentKey);
    return;
  }
  _plantillasBooted = true;

  var tabsWrap = document.getElementById('plt-tabs');
  if (!tabsWrap) return;
  while (tabsWrap.firstChild) tabsWrap.removeChild(tabsWrap.firstChild);

  Object.keys(PLANTILLAS_TEMPLATES).forEach(function(key) {
    var t = PLANTILLAS_TEMPLATES[key];
    var btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.dataset.key = key;
    btn.style.cssText = 'font-size:12px;padding:8px 14px;';
    btn.textContent = t.label;
    btn.addEventListener('click', function() { _plantillasRenderPreview(key); });
    tabsWrap.appendChild(btn);
  });

  document.getElementById('plt-btn-open').addEventListener('click', function() {
    var html = PLANTILLAS_TEMPLATES[_plantillasCurrentKey].build();
    var blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  document.getElementById('plt-btn-copy').addEventListener('click', function() {
    var html = PLANTILLAS_TEMPLATES[_plantillasCurrentKey].build();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(function() { showToast('HTML copiado'); });
    } else {
      showToast('Clipboard no disponible en este navegador');
    }
  });

  _plantillasRenderPreview('emp-es');
}

function _plantillasRenderPreview(key) {
  var tmpl = PLANTILLAS_TEMPLATES[key];
  if (!tmpl) return;
  _plantillasCurrentKey = key;

  var label = document.getElementById('plt-current-label');
  if (label) label.textContent = tmpl.label;

  var frame = document.getElementById('plt-frame');
  if (frame) frame.srcdoc = tmpl.build();

  document.querySelectorAll('#plt-tabs button').forEach(function(b) {
    var active = b.dataset.key === key;
    b.className = active ? 'btn btn-primary' : 'btn btn-secondary';
  });

  _plantillasRenderInfo(tmpl);
}

function _plantillasRenderInfo(tmpl) {
  var panel = document.getElementById('plt-info');
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  function addTitle(text) {
    var h = document.createElement('div');
    h.style.cssText = 'font-size:10px;font-weight:800;color:var(--hero-primary);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;';
    h.textContent = text;
    panel.appendChild(h);
  }
  function addField(label, value, mono) {
    var dt = document.createElement('div');
    dt.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--hero-text-muted);text-transform:uppercase;margin-top:10px;margin-bottom:3px;';
    dt.textContent = label;
    var dd = document.createElement('div');
    dd.style.cssText = 'font-size:12px;color:var(--hero-text-primary);' + (mono ? 'font-family:var(--mono);color:var(--hero-primary);word-break:break-all;' : '');
    dd.textContent = value;
    panel.appendChild(dt);
    panel.appendChild(dd);
  }
  function addSeparator() {
    var s = document.createElement('div');
    s.style.cssText = 'height:1px;background:var(--hero-border-card);margin:14px 0;';
    panel.appendChild(s);
  }

  addTitle('Detalles');
  addField('Asunto', tmpl.subject, false);
  addField('De', tmpl.from, true);
  addField('Para', tmpl.to, true);
  addField('Endpoint', tmpl.endpoint, true);

  addSeparator();
  addTitle('Cuando se dispara');
  var p = document.createElement('p');
  p.style.cssText = 'font-size:12px;color:var(--hero-text-body);line-height:1.55;margin:0;';
  p.textContent = tmpl.trigger;
  panel.appendChild(p);

  addSeparator();
  addTitle('Secciones');
  var ol = document.createElement('ol');
  ol.style.cssText = 'padding-left:18px;color:var(--hero-text-muted);margin:0;';
  tmpl.sections.forEach(function(s) {
    var li = document.createElement('li');
    li.style.cssText = 'font-size:11px;margin-bottom:4px;';
    li.textContent = s;
    ol.appendChild(li);
  });
  panel.appendChild(ol);

  addSeparator();
  addTitle('Datos de ejemplo');
  addField('Nombre', PLANTILLAS_SAMPLE.nombre, false);
  addField('Email corporativo', PLANTILLAS_SAMPLE.email, true);
  addField('Contrasena temporal', PLANTILLAS_SAMPLE.password, true);
}

// ══════════════════════════════════════════════════════════════
// Backfill del personalEmail para cuentas existentes
// ══════════════════════════════════════════════════════════════
// Utilidad one-shot (y reutilizable): lista todos los usuarios de
// Workspace, cruza con shared/workspaceUsers/byEmail de Firestore, y
// permite completar el personalEmail que falta. Dirty tracking + batch
// save — solo escribe los que cambiaron. Ver conversación de v2.21.5:
// las cuentas existentes en Workspace no tienen doc en Firestore, así que
// al primer suspend caen al prompt manual; este backfill adelanta ese trabajo.

var _backfillState = {
  rows: [],   // { email, nombre, original, current, existedBefore }
  loaded: false,
};

async function openBackfillModal() {
  var modal = document.getElementById('backfill-modal');
  if (!modal) return;
  modal.style.display = 'block';

  // Necesitamos la lista de Workspace users primero. Si allUsers está vacío
  // (Fernando nunca cargó la tabla), traerlos ahora.
  if (!allUsers || !allUsers.length) {
    document.getElementById('bf-list').textContent = 'Cargando usuarios de Workspace...';
    try {
      const resp = await authFetch(WORKER_URL + '/users');
      if (resp.ok) {
        const data = await resp.json();
        allUsers = data.users || [];
      }
    } catch (e) {
      addLog('Backfill: error cargando /users: ' + e.message, 'warn');
    }
  }

  // Cruce con Firestore — en paralelo para ~20 usuarios está bien.
  var list = document.getElementById('bf-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  var loading = document.createElement('div');
  loading.style.cssText = 'padding:24px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;';
  loading.textContent = 'Consultando Firestore…';
  list.appendChild(loading);

  var records = await Promise.all(
    allUsers.map(function(u) { return getWorkspaceUser(u.email); })
  );

  _backfillState.rows = allUsers.map(function(u, i) {
    var rec = records[i] || {};
    return {
      email: u.email,
      nombre: u.nombre || '',
      original: rec.personalEmail || '',
      current:  rec.personalEmail || '',
      existedBefore: !!(rec && rec.personalEmail),
    };
  });
  _backfillState.loaded = true;
  renderBackfillList();
}

function closeBackfillModal() {
  var modal = document.getElementById('backfill-modal');
  if (modal) modal.style.display = 'none';
}

function renderBackfillList() {
  var list = document.getElementById('bf-list');
  var counts = document.getElementById('bf-counts');
  var filter = (document.getElementById('bf-filter').value) || 'missing';
  if (!list) return;

  while (list.firstChild) list.removeChild(list.firstChild);

  var rows = _backfillState.rows;
  var conCorreo = rows.filter(function(r) { return r.original.trim(); }).length;
  var sinCorreo = rows.length - conCorreo;
  counts.textContent = sinCorreo + ' sin · ' + conCorreo + ' con · ' + rows.length + ' total';

  var visible = filter === 'all' ? rows : rows.filter(function(r) { return !r.original.trim(); });

  if (!visible.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'padding:40px 24px;text-align:center;color:var(--hero-text-muted);font-family:var(--mono);font-size:12px;';
    empty.textContent = filter === 'missing'
      ? 'Todas las cuentas tienen correo personal registrado ✓'
      : 'Sin resultados';
    list.appendChild(empty);
    updateBackfillButton();
    return;
  }

  visible.forEach(function(row) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:12px 24px;border-bottom:1px solid var(--hero-border-card);display:flex;gap:12px;align-items:center;';

    var avatar = document.createElement('div');
    avatar.style.cssText = 'flex-shrink:0;width:32px;height:32px;border-radius:50%;background:' + userAvatarColor(row.nombre) + ';color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--sans);font-weight:700;font-size:11px;letter-spacing:.3px;';
    avatar.textContent = userInitials(row.nombre);
    wrap.appendChild(avatar);

    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';

    var nombreLine = document.createElement('div');
    nombreLine.style.cssText = 'font-size:13px;font-weight:600;color:var(--hero-text-primary);line-height:1.2;';
    nombreLine.textContent = row.nombre || '—';
    info.appendChild(nombreLine);

    var emailLine = document.createElement('div');
    emailLine.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--hero-primary);line-height:1.2;';
    emailLine.textContent = row.email;
    info.appendChild(emailLine);

    var input = document.createElement('input');
    input.type = 'email';
    input.className = 'form-input';
    input.placeholder = 'correo.personal@gmail.com';
    input.value = row.current;
    input.style.cssText = 'width:100%;font-size:12px;padding:6px 10px;margin-top:4px;';
    input.addEventListener('input', function() {
      row.current = input.value.trim();
      updateBackfillButton();
      // Badge visual de dirty
      badge.style.display = (row.current !== row.original) ? 'inline-flex' : 'none';
    });
    info.appendChild(input);

    wrap.appendChild(info);

    var badge = document.createElement('span');
    badge.style.cssText = 'display:none;font-family:var(--mono);font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(6,163,182,0.10);color:var(--hero-primary);flex-shrink:0;align-self:flex-start;';
    badge.textContent = 'Sin guardar';
    wrap.appendChild(badge);

    list.appendChild(wrap);
  });

  updateBackfillButton();
}

function _backfillDirtyRows() {
  return _backfillState.rows.filter(function(r) {
    return r.current !== r.original && (r.current.trim() || r.original.trim());
  });
}

function updateBackfillButton() {
  var btn = document.getElementById('bf-save-btn');
  if (!btn) return;
  var dirty = _backfillDirtyRows();
  if (!dirty.length) {
    btn.disabled = true;
    btn.textContent = 'Sin cambios';
  } else {
    btn.disabled = false;
    btn.textContent = 'Guardar ' + dirty.length + (dirty.length === 1 ? ' cambio' : ' cambios');
  }
}

async function saveBackfillBatch() {
  var dirty = _backfillDirtyRows();
  if (!dirty.length) return;
  var btn = document.getElementById('bf-save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  var errors = 0;
  for (var i = 0; i < dirty.length; i++) {
    var r = dirty[i];
    try {
      // Si es el primer registro (no existedBefore), llenamos metadata basica.
      // Si ya existia, solo mergea personalEmail.
      var payload = { personalEmail: r.current };
      if (!r.existedBefore) {
        payload.email = r.email;
        payload.nombre = r.nombre;
        payload.createdAt = new Date().toISOString();
        payload.createdBy = 'backfill';
      }
      payload.updatedAt = new Date().toISOString();
      payload.updatedBy = 'backfill';
      await saveWorkspaceUser(r.email, payload);
      r.original = r.current;
      r.existedBefore = true;
    } catch (e) {
      errors++;
      console.warn('[backfill] error guardando ' + r.email + ':', e && e.message);
    }
  }

  addLog('Backfill: ' + (dirty.length - errors) + ' correos guardados' + (errors ? ' · ' + errors + ' fallaron' : ''), errors ? 'warn' : 'success');
  auditLog('usuario', 'Backfill de correos personales: ' + (dirty.length - errors) + ' registros', '');
  showToast(errors
    ? errors + ' errores al guardar. Revisá la consola.'
    : dirty.length + ' correo(s) guardados'
  );
  renderBackfillList();
}
