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
