# Widget de meetings de Google Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al dashboard del Hero Hub un widget que muestra los meetings de Google Calendar del usuario para hoy y mañana, con botón "Unirme" que abre el link del meeting (Meet/Zoom/Teams).

**Architecture:** Firebase Auth pide un scope OAuth extra (`calendar.readonly`) al login y captura el access token. Un módulo dedicado (`js/calendar-widget.js`) consume ese token, hace fetch al Google Calendar API v3, post-procesa (filtra, detecta links, agrupa por día) y renderiza el widget usando el patrón `createElement` + `textContent` del proyecto. Refresh cada 5 min + al recuperar foco de pestaña. Token se refresca silenciosamente cuando expira.

**Tech Stack:** HTML+JS+CSS plano (sin framework). Firebase Auth 10.7.1. Google Calendar API v3. Design tokens del Hero Hub (`--card`, `--r-sm`, `--s-*`, dark mode).

**Spec de referencia:** `docs/superpowers/specs/2026-07-09-calendar-meetings-widget-design.md`

---

## File Structure

| Archivo | Cambio | Responsabilidad |
|---|---|---|
| `js/auth.js` | Modificar | Agregar scope `calendar.readonly`; capturar access token post-login; publicar en `sessionStorage` + custom event |
| `js/calendar-widget.js` | Crear | Módulo del widget: token refresh, fetch, post-process, render, refresh triggers. Todo con `createElement` (no template strings inyectados) |
| `index.html` | Modificar | Cargar el script; markup del widget dentro del contenedor de "Mi Asistencia" (grid 2 col) |
| `css/styles.css` | Modificar | Grid layout 2 columnas para asistencia+meetings; estilos del widget (light + dark); responsive |

### Convención del proyecto sobre tests

Este proyecto **no tiene suite automatizada** (HTML+JS plano hosteado en GitHub Pages). Cada task tiene una sección **Verificación manual** con qué probar en el navegador antes de commitear. Los commits locales pueden hacerse durante la ejecución; el `git push` a `main` (que dispara deploy en vivo) requiere aprobación explícita de Fernando al final.

### Convención de rendering

**Todas las funciones de render usan `document.createElement` + `.textContent` + `.appendChild`**, no template strings inyectados. Este es el patrón que ya usan `js/toast.js` y `js/hero-confirm.js` en el proyecto, y evita cualquier riesgo de XSS al mezclar datos del Calendar API con HTML.

---

## Task 0: Prerrequisito — Configuración manual en Google Cloud Console

**Ejecuta:** Fernando (manual, sin código).

Esta task se hace **antes** del deploy final (Task 8). Puede hacerse en paralelo con las tasks de código.

- [ ] **Step 1: Habilitar Google Calendar API**

Ir a `https://console.cloud.google.com/apis/library` → seleccionar el proyecto del Hero Hub (el mismo de Firebase). Buscar "Google Calendar API" → click "Enable" (si no está ya habilitada).

- [ ] **Step 2: Declarar el scope en el OAuth consent screen**

Ir a `https://console.cloud.google.com/apis/credentials/consent` en el mismo proyecto. Editar el consent screen → paso "Scopes" → click "Add or remove scopes". Agregar el scope `https://www.googleapis.com/auth/calendar.readonly` (aparece bajo "Google Calendar API"). Guardar.

Si el consent screen está en modo "Internal" (users solo del dominio `@heroinsuranceusa.com`), no requiere verificación adicional. Si está en modo "External", Google podría pedir verificación de app (proceso de días).

- [ ] **Step 3: Confirmar**

Verificar que:
- Calendar API aparece en `Enabled APIs & services` con status "Enabled".
- El scope `calendar.readonly` aparece en la lista de scopes del OAuth consent.

Reportar a Claude/engineer cuando esté listo para proceder con Task 8.

---

## Task 1: Modificar `js/auth.js` — scope + captura del access token

**Files:**
- Modify: `js/auth.js`

**Objetivo:** Agregar el scope `calendar.readonly` al `GoogleAuthProvider` del signIn. Capturar el access token del `UserCredential` y publicarlo en `sessionStorage` + custom event.

- [ ] **Step 1: Leer el archivo actual**

Run: `Read js/auth.js` (todo el archivo).

Identificar la línea que crea `new GoogleAuthProvider()` y el `signInWithPopup(auth, provider)` correspondiente.

- [ ] **Step 2: Agregar helper `publishGoogleAccessToken` al inicio del módulo**

Insertar (justo después de los imports, arriba del primer `onAuthStateChanged`):

```js
// ══════════════════════════════════════════════
// Google Calendar access token — publicado en sessionStorage y como event
// para que js/calendar-widget.js pueda consumirlo sin acoplarse a auth.js.
// ══════════════════════════════════════════════
const GCAL_TOKEN_KEY = "hero-gcal-token";
const GCAL_TOKEN_TTL_MS = 55 * 60 * 1000; // 55 min (Google emite ~1h, dejamos margen)

function publishGoogleAccessToken(userCredential, userEmail) {
  try {
    const credential = GoogleAuthProvider.credentialFromResult(userCredential);
    if (!credential || !credential.accessToken) return;
    const payload = {
      accessToken: credential.accessToken,
      expiresAt: Date.now() + GCAL_TOKEN_TTL_MS,
      email: userEmail,
    };
    sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("hero-gcal-token-ready", { detail: payload }));
  } catch (e) {
    console.warn("[auth] No se pudo publicar el token de Google Calendar:", e.message);
  }
}
```

Verificar que `GoogleAuthProvider` ya está importado arriba del archivo. Si no aparece en el import existente, agregarlo.

- [ ] **Step 3: Modificar el `signInWithPopup` para agregar el scope y capturar el credential**

Reemplazar (patrón actual):

```js
const provider = new GoogleAuthProvider();
const result = await signInWithPopup(auth, provider);
```

Por:

```js
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
const result = await signInWithPopup(auth, provider);
publishGoogleAccessToken(result, result.user.email);
```

Si en el archivo hay más de un `signInWithPopup`, aplicar el mismo patrón en todos.

- [ ] **Step 4: Verificación manual**

Abrir el Hub en Live Server local. Cerrar sesión (menú avatar → "Cerrar sesión"). Volver a login con Google.

Verificar:
- El popup de Google ahora incluye una línea sobre "Ver los eventos de todos tus calendarios" (permiso de `calendar.readonly`). **Si aún no se hizo Task 0 en Google Cloud Console**, este permiso podría no aparecer — pausar hasta que Task 0 esté completa.
- Aceptar el consent completa el signIn normalmente.
- Abrir DevTools → Application → Session Storage → verificar clave `hero-gcal-token` con `{ accessToken, expiresAt, email }`.
- En Console, antes de un fresh login: `window.addEventListener("hero-gcal-token-ready", e => console.log("ready:", e.detail))` → el evento se dispara al aceptar.

- [ ] **Step 5: Commit**

```bash
git add js/auth.js
git commit -m "feat(auth): agregar scope calendar.readonly y publicar access token"
```

---

## Task 2: Crear estructura base de `js/calendar-widget.js`

**Files:**
- Create: `js/calendar-widget.js`

**Objetivo:** Crear el módulo con IIFE, constantes, estado, helpers de DOM (usando `createElement`) y los estados vacíos: loading, empty, reconnect, error.

- [ ] **Step 1: Crear el archivo con la estructura base**

Contenido completo del archivo:

```js
/**
 * Hero Hub — Widget de meetings de Google Calendar
 *
 * Consume el access token publicado por js/auth.js (via sessionStorage +
 * evento "hero-gcal-token-ready"), hace fetch a Google Calendar API v3
 * para hoy+mañana, y renderiza el widget en el contenedor #gcal-widget.
 *
 * Todo el render usa createElement + textContent (no template strings HTML).
 *
 * Estados: loading | ready | empty | reconnect | error
 * Refresh: cada 5 min + al recuperar foco de pestaña
 */
(function () {
  // ══════════════════════════════════════════════
  // Configuración
  // ══════════════════════════════════════════════
  const GCAL_TOKEN_KEY = "hero-gcal-token";
  const CONTAINER_ID = "gcal-widget";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const MIN_REFRESH_ON_FOCUS_MS = 60 * 1000;
  const MAX_ITEMS = 6;
  const IN_15_MIN_THRESHOLD_MS = 15 * 60 * 1000;

  // ══════════════════════════════════════════════
  // Estado del módulo
  // ══════════════════════════════════════════════
  let refreshTimer = null;
  let lastFetchAt = 0;
  let cachedEvents = null;

  // ══════════════════════════════════════════════
  // Token helpers
  // ══════════════════════════════════════════════
  function readToken() {
    try {
      const raw = sessionStorage.getItem(GCAL_TOKEN_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function tokenIsValid(t) {
    return t && t.accessToken && t.expiresAt && Date.now() < t.expiresAt;
  }

  // ══════════════════════════════════════════════
  // DOM helpers (createElement + textContent, sin string HTML)
  // ══════════════════════════════════════════════
  function getContainer() {
    return document.getElementById(CONTAINER_ID);
  }

  function clearContainer(c) {
    while (c.firstChild) c.removeChild(c.firstChild);
  }

  function el(tag, opts, ...children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.class) node.className = opts.class;
      if (opts.text) node.textContent = opts.text;
      if (opts.id) node.id = opts.id;
      if (opts.href) node.href = opts.href;
      if (opts.target) node.target = opts.target;
      if (opts.rel) node.rel = opts.rel;
      if (opts.role) node.setAttribute("role", opts.role);
      if (opts.type) node.type = opts.type;
      if (opts.ariaLabel) node.setAttribute("aria-label", opts.ariaLabel);
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function iconEl(name) {
    const i = document.createElement("i");
    i.setAttribute("data-lucide", name);
    return i;
  }

  function headerEl() {
    return el("div", { class: "gcal-header" },
      el("div", { class: "gcal-title" },
        iconEl("calendar-days"),
        el("span", { text: "Próximos meetings" })
      )
    );
  }

  function renderInto(...nodes) {
    const c = getContainer();
    if (!c) return;
    clearContainer(c);
    for (const n of nodes) c.appendChild(n);
    if (window.refreshIcons) window.refreshIcons();
  }

  // ══════════════════════════════════════════════
  // Renderizadores de estados vacíos
  // ══════════════════════════════════════════════
  function renderLoading() {
    const skel = el("div", { class: "gcal-skeleton" },
      el("div", { class: "gcal-skel-row" }),
      el("div", { class: "gcal-skel-row" }),
      el("div", { class: "gcal-skel-row" })
    );
    renderInto(headerEl(), skel);
  }

  function renderEmpty() {
    const empty = el("div", { class: "gcal-empty" },
      el("div", { class: "gcal-empty-icon" }, iconEl("calendar-check")),
      el("div", { class: "gcal-empty-title", text: "Sin meetings próximos ✨" }),
      el("div", { class: "gcal-empty-sub", text: "Disfruta el día libre en tu agenda." })
    );
    renderInto(headerEl(), empty);
  }

  function renderReconnect(reason) {
    const msg = reason === "no-permission"
      ? "El Hub necesita permiso para leer tu Google Calendar."
      : "Necesitas reconectar Google Calendar para ver tus meetings.";
    const btn = el("button", { class: "gcal-reconnect-btn", id: "gcal-reconnect-btn", type: "button" },
      iconEl("refresh-cw"),
      el("span", { text: "Reconectar" })
    );
    btn.addEventListener("click", handleReconnectClick);
    const block = el("div", { class: "gcal-reconnect" },
      el("div", { class: "gcal-reconnect-icon" }, iconEl("alert-triangle")),
      el("div", { class: "gcal-reconnect-msg", text: msg }),
      btn
    );
    renderInto(headerEl(), block);
  }

  function renderError() {
    const btn = el("button", { class: "gcal-retry-btn", id: "gcal-retry-btn", type: "button" },
      iconEl("refresh-cw"),
      el("span", { text: "Reintentar" })
    );
    btn.addEventListener("click", () => refresh({ force: true }));
    const block = el("div", { class: "gcal-error" },
      el("div", { class: "gcal-error-icon" }, iconEl("wifi-off")),
      el("div", { class: "gcal-error-msg", text: "No pudimos cargar tu calendar." }),
      btn
    );
    renderInto(headerEl(), block);
  }

  // ══════════════════════════════════════════════
  // Stubs (implementados en tasks siguientes)
  // ══════════════════════════════════════════════
  async function refresh(_opts) { /* Task 3 */ }
  function handleReconnectClick() { /* Task 4 */ }

  // ══════════════════════════════════════════════
  // Bootstrap (implementado en Task 5)
  // ══════════════════════════════════════════════

  window._gcalWidget = { refresh };
})();
```

- [ ] **Step 2: Verificación manual**

- `Grep` en el proyecto: confirmar que no hay otra definición de `_gcalWidget` ni conflicto.
- Confirmar visualmente que el archivo no tiene errores de sintaxis (paréntesis, llaves balanceadas).

- [ ] **Step 3: Commit**

```bash
git add js/calendar-widget.js
git commit -m "feat(calendar-widget): estructura base y estados vacíos"
```

---

## Task 3: Fetch a Google Calendar API + post-procesamiento

**Files:**
- Modify: `js/calendar-widget.js`

**Objetivo:** Implementar el fetch al Calendar API con detección de errores auth (401/403), y el post-procesamiento: filtrar events, detectar links, agrupar por día, marcar en curso / próximo.

- [ ] **Step 1: Reemplazar el stub `refresh()` y agregar los helpers de fetch**

Localizar en `js/calendar-widget.js` la sección `// Stubs (implementados en tasks siguientes)` y reemplazarla por:

```js
  // ══════════════════════════════════════════════
  // Fetch a Google Calendar API v3
  // ══════════════════════════════════════════════
  async function fetchMeetings(accessToken) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);
    const params = new URLSearchParams({
      timeMin: startOfToday.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    });
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401 || res.status === 403) {
      const err = new Error("auth-required");
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new Error(`Calendar API ${res.status}`);
    const data = await res.json();
    return data.items || [];
  }

  // ══════════════════════════════════════════════
  // Detección del link "Unirme"
  // ══════════════════════════════════════════════
  const CONF_URL_REGEX = /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|gather\.town)\/[^\s"<)]+/i;
  const ANY_URL_REGEX = /https?:\/\/[^\s"<)]+/i;

  function pickJoinLink(event) {
    if (event.hangoutLink) return event.hangoutLink;
    const ep = (event.conferenceData && event.conferenceData.entryPoints) || [];
    const videoEp = ep.find(e => e.entryPointType === "video");
    if (videoEp && videoEp.uri) return videoEp.uri;
    if (event.location) {
      const m = event.location.match(CONF_URL_REGEX) || event.location.match(ANY_URL_REGEX);
      if (m) return m[0];
    }
    if (event.description) {
      const m = event.description.match(CONF_URL_REGEX);
      if (m) return m[0];
    }
    return null;
  }

  // ══════════════════════════════════════════════
  // Post-procesamiento
  // ══════════════════════════════════════════════
  function processEvents(rawEvents) {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const endOfTomorrow = new Date(startOfTomorrow);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

    const items = [];
    for (const ev of rawEvents) {
      if (ev.status === "cancelled") continue;
      if (ev.eventType === "outOfOffice" || ev.eventType === "focusTime") continue;
      if (!ev.start || !ev.start.dateTime) continue; // all-day
      const attendees = ev.attendees || [];
      const self = attendees.find(a => a.self);
      if (self && self.responseStatus === "declined") continue;

      const startMs = new Date(ev.start.dateTime).getTime();
      const endMs = ev.end && ev.end.dateTime
        ? new Date(ev.end.dateTime).getTime()
        : startMs + 30 * 60 * 1000;
      if (endMs < now) continue;

      const startDate = new Date(startMs);
      let dayGroup;
      if (startDate >= startOfToday && startDate < startOfTomorrow) dayGroup = "hoy";
      else if (startDate >= startOfTomorrow && startDate < endOfTomorrow) dayGroup = "mañana";
      else continue;

      let badge = null;
      if (startMs <= now && now <= endMs) {
        badge = { type: "en-curso", label: "En curso" };
      } else if (startMs > now && (startMs - now) <= IN_15_MIN_THRESHOLD_MS) {
        const minsLeft = Math.max(1, Math.round((startMs - now) / 60000));
        badge = { type: "proximo", label: `En ${minsLeft} min` };
      }

      items.push({
        id: ev.id,
        title: ev.summary || "(Sin título)",
        startMs,
        endMs,
        dayGroup,
        joinLink: pickJoinLink(ev),
        badge,
      });
    }

    const limited = items.slice(0, MAX_ITEMS);
    const hasMore = items.length > MAX_ITEMS;
    return { items: limited, hasMore };
  }

  // ══════════════════════════════════════════════
  // Token con refresh silencioso (placeholder — completado en Task 4)
  // ══════════════════════════════════════════════
  async function getFreshToken() {
    const t = readToken();
    if (tokenIsValid(t)) return t;
    return null;
  }

  // ══════════════════════════════════════════════
  // Refresh principal
  // ══════════════════════════════════════════════
  async function refresh(opts = {}) {
    const container = getContainer();
    if (!container) return;

    const token = await getFreshToken();
    if (!token) {
      renderReconnect();
      return;
    }

    if (!cachedEvents || opts.force) renderLoading();

    try {
      const raw = await fetchMeetings(token.accessToken);
      const processed = processEvents(raw);
      cachedEvents = processed;
      lastFetchAt = Date.now();
      if (processed.items.length === 0) renderEmpty();
      else renderMeetings(processed);
    } catch (e) {
      if (e.message === "auth-required") {
        renderReconnect(e.status === 403 ? "no-permission" : undefined);
      } else {
        console.warn("[gcal-widget] fetch falló:", e.message);
        renderError();
      }
    }
  }

  // Stubs temporales — Task 4 los implementa
  function renderMeetings(_processed) { renderEmpty(); }
  function handleReconnectClick() { console.warn("Reconnect click — implementado en Task 4"); }
```

- [ ] **Step 2: Verificación manual**

- `Grep` `fetchMeetings|processEvents|pickJoinLink|getFreshToken|renderMeetings|handleReconnectClick` en `js/calendar-widget.js` — cada nombre debe aparecer exactamente 1 vez como definición (`function X`), sin duplicados de los stubs anteriores.

- [ ] **Step 3: Commit**

```bash
git add js/calendar-widget.js
git commit -m "feat(calendar-widget): fetch + post-procesamiento + link detection"
```

---

## Task 4: Render de meetings + refresh silencioso del token + reconectar

**Files:**
- Modify: `js/calendar-widget.js`

**Objetivo:** Implementar el render real con grupos HOY/MAÑANA, items con hora + título + badge + botón "Unirme", el refresh silencioso del token (Firebase Auth con `prompt: 'none'`), y el handler del botón "Reconectar".

- [ ] **Step 1: Agregar el import dinámico de Firebase Auth**

Insertar dentro del IIFE, justo después de la sección "Configuración":

```js
  // ══════════════════════════════════════════════
  // Firebase Auth cargado dinámicamente (para evitar tener que hacer del
  // widget un módulo ES6; se carga con <script defer>)
  // ══════════════════════════════════════════════
  let _firebaseAuthModule = null;
  async function loadFirebaseAuth() {
    if (_firebaseAuthModule) return _firebaseAuthModule;
    _firebaseAuthModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    return _firebaseAuthModule;
  }
```

- [ ] **Step 2: Reemplazar los stubs con las implementaciones reales**

Localizar la sección `// Stubs temporales — Task 4 los implementa` y reemplazar TODO el bloque (los dos stubs) por:

```js
  // ══════════════════════════════════════════════
  // Refresh silencioso del token vía Firebase Auth
  // ══════════════════════════════════════════════
  async function refreshTokenSilently(hintEmail) {
    try {
      const { GoogleAuthProvider, signInWithPopup, getAuth } = await loadFirebaseAuth();
      const auth = getAuth();
      if (!auth.currentUser) return null;
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
      provider.setCustomParameters({
        login_hint: hintEmail || auth.currentUser.email,
        prompt: "none",
      });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential || !credential.accessToken) return null;
      const payload = {
        accessToken: credential.accessToken,
        expiresAt: Date.now() + 55 * 60 * 1000,
        email: result.user.email,
      };
      sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload));
      return payload;
    } catch (e) {
      console.warn("[gcal-widget] refresh silencioso falló:", e.message);
      return null;
    }
  }

  // Reemplaza el placeholder anterior de getFreshToken
  async function getFreshToken() {
    const t = readToken();
    if (tokenIsValid(t)) return t;
    const fresh = await refreshTokenSilently(t ? t.email : null);
    return fresh || null;
  }

  // ══════════════════════════════════════════════
  // Formato de hora
  // ══════════════════════════════════════════════
  function fmtTime(ms) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(ms));
  }

  // ══════════════════════════════════════════════
  // Render de meetings (createElement puro)
  // ══════════════════════════════════════════════
  function badgeNode(badge) {
    if (!badge) return null;
    const cls = `gcal-badge gcal-badge-${badge.type}`;
    return el("span", { class: cls, text: badge.label });
  }

  function joinBtnNode(item) {
    if (item.joinLink) {
      const a = el("a", {
        class: "gcal-join-btn",
        href: item.joinLink,
        target: "_blank",
        rel: "noopener",
        ariaLabel: `Unirme al meeting «${item.title}» a las ${fmtTime(item.startMs)}`,
      }, iconEl("video"), el("span", { text: "Unirme" }));
      return a;
    }
    return el("span", { class: "gcal-nolink", ariaLabel: "Sin link disponible", text: "Sin link" });
  }

  function itemNode(item) {
    const titleRow = el("div", { class: "gcal-title-row" },
      el("span", { class: "gcal-item-title", text: item.title }),
      badgeNode(item.badge)
    );
    const body = el("div", { class: "gcal-body" }, titleRow);
    const time = el("div", { class: "gcal-time mono", text: fmtTime(item.startMs) });
    const actions = el("div", { class: "gcal-actions" }, joinBtnNode(item));
    const row = el("div", { class: "gcal-item", role: "listitem" }, time, body, actions);
    row.setAttribute("data-id", item.id);
    return row;
  }

  function groupBlockNode(label, list) {
    if (!list.length) return null;
    const rows = el("div", { class: "gcal-list", role: "list" });
    for (const item of list) rows.appendChild(itemNode(item));
    return el("div", { class: "gcal-group" },
      el("div", { class: "gcal-group-label", text: label }),
      rows
    );
  }

  function moreLinkNode() {
    return el("a", {
      class: "gcal-more",
      href: "https://calendar.google.com",
      target: "_blank",
      rel: "noopener",
    }, el("span", { text: "Ver más en Google Calendar " }), iconEl("external-link"));
  }

  // Reemplaza el stub anterior de renderMeetings
  function renderMeetings(processed) {
    const { items, hasMore } = processed;
    const hoy = items.filter(i => i.dayGroup === "hoy");
    const manana = items.filter(i => i.dayGroup === "mañana");

    const nodes = [headerEl()];
    const gHoy = groupBlockNode("Hoy", hoy);
    if (gHoy) nodes.push(gHoy);
    const gManana = groupBlockNode("Mañana", manana);
    if (gManana) nodes.push(gManana);
    if (hasMore) nodes.push(moreLinkNode());

    renderInto(...nodes);
  }

  // ══════════════════════════════════════════════
  // Handler del botón "Reconectar" (popup completo)
  // ══════════════════════════════════════════════
  async function handleReconnectClick() {
    try {
      const { GoogleAuthProvider, signInWithPopup, getAuth } = await loadFirebaseAuth();
      const auth = getAuth();
      if (!auth.currentUser) return;
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
      provider.setCustomParameters({ login_hint: auth.currentUser.email });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        const payload = {
          accessToken: credential.accessToken,
          expiresAt: Date.now() + 55 * 60 * 1000,
          email: result.user.email,
        };
        sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload));
        await refresh({ force: true });
      }
    } catch (e) {
      console.warn("[gcal-widget] reconectar falló:", e.message);
    }
  }
```

- [ ] **Step 3: Verificación manual**

- `Grep` `function renderMeetings|function handleReconnectClick|function getFreshToken` en `js/calendar-widget.js` — cada una debe aparecer exactamente 1 vez.
- No debe quedar ningún `console.warn("Reconnect click — implementado en Task 4")`.

- [ ] **Step 4: Commit**

```bash
git add js/calendar-widget.js
git commit -m "feat(calendar-widget): render items + reconectar + refresh silencioso"
```

---

## Task 5: Bootstrap y refresh triggers

**Files:**
- Modify: `js/calendar-widget.js`

**Objetivo:** Arrancar el widget cuando el container existe y ya hay token; instalar `setInterval` (5 min) y `visibilitychange` para mantener el widget fresco.

- [ ] **Step 1: Reemplazar el bloque de bootstrap**

Localizar (cerca del final del IIFE):

```js
  // ══════════════════════════════════════════════
  // Bootstrap (implementado en Task 5)
  // ══════════════════════════════════════════════

  window._gcalWidget = { refresh };
})();
```

Reemplazar por:

```js
  // ══════════════════════════════════════════════
  // Bootstrap
  // ══════════════════════════════════════════════
  function installRefreshTriggers() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refresh(), REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAt > MIN_REFRESH_ON_FOCUS_MS) refresh();
    });
  }

  function init() {
    if (!getContainer()) return;
    installRefreshTriggers();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Si el token llega DESPUÉS del init (por login fresh en la misma página),
  // volver a renderizar.
  window.addEventListener("hero-gcal-token-ready", () => refresh({ force: true }));

  window._gcalWidget = { refresh };
})();
```

- [ ] **Step 2: Verificación manual**

- `Grep` `\}\)\(\);` en `js/calendar-widget.js` — el cierre del IIFE debe aparecer exactamente 1 vez, al final del archivo.

- [ ] **Step 3: Commit**

```bash
git add js/calendar-widget.js
git commit -m "feat(calendar-widget): bootstrap + refresh triggers (5min + visibilitychange)"
```

---

## Task 6: Markup del widget en `index.html` + layout 2 columnas

**Files:**
- Modify: `index.html`

**Objetivo:** Agregar el contenedor `#gcal-widget` al lado de "Mi Asistencia" en el dashboard, dentro de un grid de 2 columnas. Cargar el script del widget.

- [ ] **Step 1: Agregar el script tag**

Localizar en `index.html` la línea:

```html
<script defer src="js/hero-confirm.js"></script>
```

Insertar justo después:

```html
<script defer src="js/calendar-widget.js"></script>
```

- [ ] **Step 2: Wrappear "Mi Asistencia" en el grid 2 columnas y agregar el contenedor del widget**

Localizar la línea (aprox. L232):

```html
<section class="section fade-in" id="sec-asistencia">
```

Reemplazarla por:

```html
<section class="section fade-in section-dual" id="sec-asistencia-meetings">
  <div class="section-dual-grid">
    <div class="section-dual-col" id="sec-asistencia">
```

Luego localizar el `</section>` de cierre correspondiente (la sección de "Mi Asistencia" termina antes de la sección `<section class="section fade-in" id="sec-web-search">` en aprox. L299). Reemplazar ese `</section>` por:

```html
    </div>

    <div class="section-dual-col" id="sec-gcal">
      <div class="section-label"><span class="kicker-dot"></span>Próximos meetings</div>
      <div class="gcal-panel" id="gcal-widget">
        <!-- Contenido renderizado por js/calendar-widget.js -->
      </div>
    </div>
  </div>
</section>
```

**Nota:** este cambio preserva 100% del contenido interno de "Mi Asistencia" — solo agrega wrapping antes y después.

- [ ] **Step 3: Verificación manual**

- Abrir `index.html` en Live Server local.
- DevTools → confirmar que `#gcal-widget` existe en el DOM.
- Widget debe mostrar (sin estilos aún) el header "Próximos meetings" + estado loading/empty/reconectar según haya token.
- No hay errores en Console.
- El layout se ve mal (una columna abajo de otra sin gap) hasta Task 7.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(dashboard): markup del widget de meetings + layout 2 columnas"
```

---

## Task 7: Estilos completos en `css/styles.css`

**Files:**
- Modify: `css/styles.css`

**Objetivo:** Estilar el grid 2 columnas, el widget completo con todos sus estados, y cubrir modo oscuro. Respetar tokens del design system.

- [ ] **Step 1: Agregar los estilos al final de `css/styles.css`**

Contenido a agregar:

```css
/* ══════════════════════════════════════════════
   Widget de Google Calendar — dashboard
   ══════════════════════════════════════════════ */

/* Layout: sección de 2 columnas (Asistencia + Meetings) */
.section-dual-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-6, 24px);
  align-items: start;
}
.section-dual-col {
  min-width: 0;
}
@media (max-width: 900px) {
  .section-dual-grid { grid-template-columns: 1fr; }
}

/* Panel base */
.gcal-panel {
  background: var(--card, #fff);
  border: 1px solid var(--border, rgba(10,61,74,.10));
  border-radius: var(--r, 22px);
  padding: var(--s-5, 20px);
  min-height: 220px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--s-4, 16px);
}
.gcal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gcal-title {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2, 8px);
  font-family: var(--display, 'Bricolage Grotesque', sans-serif);
  font-weight: 700;
  font-size: 16px;
  color: var(--text, #0a3d4a);
}
.gcal-title i {
  width: 18px; height: 18px;
  color: var(--cyan, #06a3b6);
}

/* Grupos HOY / MAÑANA */
.gcal-group { display: flex; flex-direction: column; gap: var(--s-2, 8px); }
.gcal-group-label {
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 11px;
  font-weight: 700;
  color: var(--muted, #5a7480);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-left: var(--s-1, 4px);
}
.gcal-list { display: flex; flex-direction: column; gap: var(--s-2, 8px); }

/* Item */
.gcal-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--s-3, 12px);
  align-items: center;
  padding: var(--s-3, 12px);
  background: var(--paper-2, #e8f4f6);
  border: 1px solid var(--border, rgba(10,61,74,.10));
  border-radius: var(--r-sm, 14px);
  transition: box-shadow .15s ease;
}
.gcal-item:hover { box-shadow: var(--shadow-sm); }
.gcal-time {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  font-weight: 700;
  color: var(--cyan-deep, #066b78);
}
.gcal-body { min-width: 0; }
.gcal-title-row {
  display: flex;
  align-items: center;
  gap: var(--s-2, 8px);
  flex-wrap: wrap;
}
.gcal-item-title {
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #0a3d4a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* Badges */
.gcal-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.gcal-badge-en-curso {
  background: var(--cyan, #06a3b6);
  color: #fff;
  animation: gcal-pulse 1.8s infinite;
}
@keyframes gcal-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.65; }
}
.gcal-badge-proximo {
  background: var(--gold-2, #ffd166);
  color: var(--teal-darker, #062a33);
}
@media (prefers-reduced-motion: reduce) {
  .gcal-badge-en-curso { animation: none; }
}

/* Botones */
.gcal-join-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--cyan, #06a3b6);
  color: #fff;
  border-radius: 999px;
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color .15s ease;
}
.gcal-join-btn:hover { background: var(--cyan-2, #0891a3); }
.gcal-join-btn i { width: 14px; height: 14px; }

.gcal-nolink {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  color: var(--muted, #5a7480);
  border: 1px dashed var(--border-2, rgba(10,61,74,.18));
  border-radius: 999px;
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 12px;
  font-weight: 500;
}

.gcal-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: center;
  padding: 6px 12px;
  color: var(--cyan-deep, #066b78);
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
}
.gcal-more:hover { text-decoration: underline; }
.gcal-more i { width: 12px; height: 12px; }

/* Estado: empty */
.gcal-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--s-2, 8px);
  padding: var(--s-6, 24px) var(--s-4, 16px);
  text-align: center;
}
.gcal-empty-icon i { width: 32px; height: 32px; color: var(--emerald, #10b981); opacity: 0.7; }
.gcal-empty-title {
  font-family: var(--display, 'Bricolage Grotesque', sans-serif);
  font-weight: 600; font-size: 15px;
  color: var(--text, #0a3d4a);
}
.gcal-empty-sub {
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 13px;
  color: var(--muted, #5a7480);
}

/* Estado: reconectar */
.gcal-reconnect {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--s-3, 12px);
  padding: var(--s-6, 24px) var(--s-4, 16px);
  text-align: center;
}
.gcal-reconnect-icon i { width: 32px; height: 32px; color: var(--gold, #f5b830); }
.gcal-reconnect-msg {
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 13px;
  color: var(--text-2, #1a4a5a);
  line-height: 1.4;
}
.gcal-reconnect-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: var(--cyan, #06a3b6);
  color: #fff;
  border: 0;
  border-radius: 999px;
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background-color .15s ease;
}
.gcal-reconnect-btn:hover { background: var(--cyan-2, #0891a3); }
.gcal-reconnect-btn i { width: 14px; height: 14px; }

/* Estado: error */
.gcal-error {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--s-3, 12px);
  padding: var(--s-6, 24px) var(--s-4, 16px);
  text-align: center;
}
.gcal-error-icon i { width: 32px; height: 32px; color: var(--rose, #f43f5e); }
.gcal-error-msg {
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 13px;
  color: var(--text-2, #1a4a5a);
}
.gcal-retry-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: transparent;
  color: var(--cyan, #06a3b6);
  border: 1px solid var(--cyan, #06a3b6);
  border-radius: 999px;
  font-family: var(--sans, 'Inter', sans-serif);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.gcal-retry-btn:hover { background: var(--paper-2, #e8f4f6); }
.gcal-retry-btn i { width: 14px; height: 14px; }

/* Skeleton loading */
.gcal-skeleton { display: flex; flex-direction: column; gap: var(--s-2, 8px); }
.gcal-skel-row {
  height: 48px;
  border-radius: var(--r-sm, 14px);
  background: linear-gradient(90deg,
    var(--paper-2, #e8f4f6) 0%,
    var(--border, rgba(10,61,74,.10)) 50%,
    var(--paper-2, #e8f4f6) 100%);
  background-size: 200% 100%;
  animation: gcal-skel-shimmer 1.4s ease-in-out infinite;
}
@keyframes gcal-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .gcal-skel-row { animation: none; }
}

/* ══════════════════════════════════════════════
   Modo oscuro
   ══════════════════════════════════════════════ */
body[data-theme="dark"] .gcal-panel {
  background: var(--card, #0f2a33);
  border-color: var(--border, rgba(255,255,255,.08));
}
body[data-theme="dark"] .gcal-item {
  background: rgba(255,255,255,.03);
  border-color: var(--border, rgba(255,255,255,.08));
}
body[data-theme="dark"] .gcal-time { color: var(--gold-2, #ffd166); }
body[data-theme="dark"] .gcal-item-title,
body[data-theme="dark"] .gcal-empty-title,
body[data-theme="dark"] .gcal-title { color: var(--text, #e8f4f6); }
body[data-theme="dark"] .gcal-reconnect-msg,
body[data-theme="dark"] .gcal-error-msg { color: var(--text-2, #b8d4d8); }
body[data-theme="dark"] .gcal-nolink {
  color: var(--muted, #7a9aa5);
  border-color: var(--border-2, rgba(255,255,255,.14));
}
body[data-theme="dark"] .gcal-badge-proximo { color: var(--teal-darker, #062a33); }
body[data-theme="dark"] .gcal-retry-btn:hover { background: rgba(255,255,255,.05); }
```

- [ ] **Step 2: Verificación manual**

Refresh en Live Server local. Verificar:
- Grid 2 columnas en desktop (asistencia izquierda, meetings derecha, misma altura ≥220px).
- Panel blanco con radius y sombra suave.
- Header con icon cyan + título "Próximos meetings".
- Estado empty se ve bien (icon esmeralda, mensaje).
- Estado reconectar se ve bien (icon dorado, botón cyan).
- Toggle Día/Noche → widget cambia coherentemente.
- Viewport <900px → widget baja debajo de asistencia, 1 sola columna.
- DevTools → Rendering → Emulate CSS media `prefers-reduced-motion: reduce` → skeleton no anima, badge "En curso" no pulsa.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "style(dashboard): grid 2 col para asistencia+meetings + estilos del widget"
```

---

## Task 8: Verificación end-to-end en localhost y deploy

**Files:** ninguno (solo verificación y deploy).

- [ ] **Step 1: Confirmar que Task 0 está lista**

Preguntar a Fernando: "¿Ya habilitaste Google Calendar API y agregaste el scope `calendar.readonly` en el OAuth consent screen del proyecto de Firebase?"

Si NO: pausar hasta que lo confirme.

- [ ] **Step 2: Correr checklist de spec §10 en localhost**

Cerrar sesión completa y login de nuevo. Verificar caso por caso:

1. Primer login con nuevo scope → popup de Google muestra el consent extra → aceptar → widget renderiza.
2. Empty state real (cuenta o cambiar fecha del sistema para simularlo).
3. Meeting con Meet nativo → botón "Unirme" abre `meet.google.com/...`.
4. Meeting con Zoom en `location` → regex detecta → botón funciona.
5. Meeting sin link joinable → badge "Sin link".
6. Meeting en curso → badge "En curso" con pulsing (o sin, según `prefers-reduced-motion`).
7. Meeting all-day (evento de día completo) → filtrado, NO aparece.
8. Meeting rechazado (declined) → filtrado.
9. Layout 2 columnas en desktop (≥900px).
10. Layout apilado en móvil (<900px, DevTools responsive mode).
11. Modo oscuro completo.
12. Reconectar flow: en otra pestaña ir a `myaccount.google.com/permissions` → revocar acceso del Hero Hub → recargar Hub → widget muestra "Reconectar" → click → popup → widget se rellena.
13. Refresh de token: en DevTools → Application → Session Storage → editar `expiresAt` de `hero-gcal-token` a un valor pasado → llamar `_gcalWidget.refresh({force:true})` desde Console → dispara refresh silencioso.

Si algún caso falla: volver a la task correspondiente, arreglar, commit, y reintentar el checklist.

- [ ] **Step 3: Actualizar el changelog (preguntar a Fernando)**

**Nota:** Fernando había pedido "sin changelog ni cambio de versión" para el commit del swap masivo. Este feature es distinto (nuevo widget + scope OAuth extra), y su patrón normal es bump minor + entrada en changelog.

Preguntar: "¿Bumpeamos a v2.15.0 con entrada en changelog, o dejamos sin bump igual que el commit anterior?"

Si SÍ → bump minor:
- Aplicar bump de `v2.14.0` → `v2.15.0` en el footer de las 16 páginas HTML usando el snippet de `feedback_version_bump.md` en memoria.
- Agregar entrada en `data/changelog.json` describiendo el widget (nuevo widget de meetings, scope OAuth agregado, layout 2 col en dashboard).

- [ ] **Step 4: Commit del spec + plan**

Fernando había pedido diferir el commit del spec hasta la implementación. Ahora es el momento.

```bash
git add docs/superpowers/specs/2026-07-09-calendar-meetings-widget-design.md \
        docs/superpowers/plans/2026-07-09-calendar-meetings-widget.md
git commit -m "docs(specs): agregar spec + plan del widget de meetings"
```

- [ ] **Step 5: Push a `main` (deploy en vivo) — REQUIERE OK EXPLÍCITO DE FERNANDO**

**No ejecutar sin confirmación de Fernando.**

Preguntar: "Todo verificado en localhost. ¿Push a main (deploy en vivo)?"

Si SÍ:

```bash
git push origin main
```

Ejecutar en **foreground** (regla de memoria `feedback_git_push_background.md`).

Verificar post-push:
- `git log --oneline origin/main..HEAD` no muestra commits pendientes.
- Abrir `hub.heroinsuranceusa.com` → widget aparece y funciona (dar 1-2 min para que GitHub Pages termine el build).

Si GitHub Pages queda atascado en "building" >5 min, destrabar con `gh api -X POST /repos/<owner>/<repo>/pages/builds` (según `feedback_pages_deploy_stuck.md`).

---

## Self-Review (ejecutado al escribir el plan)

**Cobertura del spec:**

| Sección del spec | Task |
|---|---|
| §1 Motivación | Implícita en todo el plan |
| §2 Alcance (widget hoy+mañana, link detection, badges) | T3, T4 |
| §3 Decisiones de producto | Reflejadas en constantes del módulo (T2) |
| §4.1 Componentes nuevos | T2, T3, T4, T5 |
| §4.2 Componentes modificados | T1 (auth), T6 (index), T7 (styles) |
| §5.1 Adquisición del token | T1 |
| §5.2 Refresh silencioso | T4 |
| §5.3 Fetch de eventos | T3 |
| §5.4 Post-procesamiento (filtros, link, agrupar, "En curso", "En N min") | T3 |
| §5.5 Refresh triggers | T5 |
| §6 Estados de UI | T2 (empty/reconnect/error/loading), T4 (con meetings) |
| §7 Edge cases | T3 (filtros), T2/T4 (estados), T4/T5 (refresh) |
| §8 Accesibilidad | T4 (aria-labels), T7 (contrastes, prefers-reduced-motion) |
| §9 Persistencia (sessionStorage) | T1, T2, T4 |
| §10 Testing manual | T8 |
| §11 Rollout | T0 (manual), T8 (deploy) |
| §12 Riesgos y mitigaciones | T4 (estados de error), T8 (checklist) |
| §13 Archivos afectados | T1, T2-T5, T6, T7 |
| §14 Extensiones futuras | Explícitamente fuera de scope |

**Gaps detectados y arreglados:**
- El spec pedía render seguro (sec §7): plan cambiado para usar `createElement` + `textContent` en vez de template strings HTML.
- Se explicitó el manejo de `prefers-reduced-motion` en T7.
- Se agregó T0 (config manual Google Cloud) como prerrequisito claro.

**Type consistency:** verificado — nombres de funciones (`refresh`, `renderMeetings`, `getFreshToken`, `handleReconnectClick`, `pickJoinLink`, `refreshTokenSilently`) son coherentes entre tasks. IDs de DOM (`gcal-widget`, `gcal-reconnect-btn`, `gcal-retry-btn`) coinciden entre HTML (T6), CSS (T7) y JS (T2-T5). Clave de sessionStorage `hero-gcal-token` coincide entre `auth.js` (T1) y `calendar-widget.js` (T2+).

**Placeholder scan:** no hay TBD, TODO, ni "handle edge cases" — cada step tiene código completo o comando específico.
