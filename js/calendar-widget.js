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
  // Firebase Auth cargado dinámicamente (para evitar tener que hacer del
  // widget un módulo ES6; se carga con <script defer>)
  // ══════════════════════════════════════════════
  let _firebaseAuthModule = null;
  async function loadFirebaseAuth() {
    if (_firebaseAuthModule) return _firebaseAuthModule;
    _firebaseAuthModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    return _firebaseAuthModule;
  }

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

  async function getFreshToken() {
    const t = readToken();
    if (tokenIsValid(t)) return t;
    const fresh = await refreshTokenSilently(t ? t.email : null);
    return fresh || null;
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
