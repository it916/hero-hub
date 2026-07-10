/**
 * Hero Hub — Widget del "Próximo meeting" del banner HQ Command Center.
 *
 * Consume el access token publicado por js/auth.js (via localStorage +
 * evento "hero-gcal-token-ready"), hace fetch a Google Calendar API v3
 * para hoy+mañana, y alimenta los slots del tile #hqcc-meet-tile del banner:
 *   #hqcc-meet-badge     · "En 15 min" / "En curso" / "Hoy" / "Mañana"
 *   #hqcc-meet-time-h    · hora del próximo meeting ("10:00")
 *   #hqcc-meet-time-m    · AM/PM
 *   #hqcc-meet-title     · título del meeting
 *   #hqcc-meet-next      · "Luego · [hora] · [título]" del siguiente evento
 *   #hqcc-meet-join      · href del link para unirse
 *
 * Estados (leídos por CSS vía data-state en #hqcc-meet-tile):
 *   loading | ready | empty | reconnect | error
 * Refresh: cada 5 min + al recuperar foco de pestaña.
 */
(function () {
  // ══════════════════════════════════════════════
  // Configuración
  // ══════════════════════════════════════════════
  const GCAL_TOKEN_KEY = "hero-gcal-token";
  const TILE_ID = "hqcc-meet-tile";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const MIN_REFRESH_ON_FOCUS_MS = 60 * 1000;
  const IN_15_MIN_THRESHOLD_MS = 15 * 60 * 1000;

  // ══════════════════════════════════════════════
  // Firebase Auth cargado dinámicamente
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
      const raw = localStorage.getItem(GCAL_TOKEN_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function tokenIsValid(t) {
    return t && t.accessToken && t.expiresAt && Date.now() < t.expiresAt;
  }

  // ══════════════════════════════════════════════
  // Acceso al tile
  // ══════════════════════════════════════════════
  function getTile() { return document.getElementById(TILE_ID); }
  function $(id) { return document.getElementById(id); }

  function setState(state) {
    const tile = getTile();
    if (tile) tile.dataset.state = state;
  }

  function setJoin({ href, label, iconName, onclick }) {
    const join = $("hqcc-meet-join");
    if (!join) return;
    join.href = href || "#";
    join.onclick = onclick || null;
    join.target = onclick ? "" : "_blank";
    join.rel = onclick ? "" : "noopener";
    // Reemplaza el ícono (lucide reemplaza el <i> por <svg>, así que recreamos el <i>)
    while (join.firstChild) join.removeChild(join.firstChild);
    const i = document.createElement("i");
    i.setAttribute("data-lucide", iconName || "video");
    const span = document.createElement("span");
    span.textContent = label || "Unirme";
    join.appendChild(i);
    join.appendChild(span);
  }

  function setBadge(text) {
    const b = $("hqcc-meet-badge");
    if (!b) return;
    if (!text) { b.hidden = true; b.textContent = ""; return; }
    b.hidden = false;
    b.textContent = text;
  }

  function setTime(h, m) {
    const eh = $("hqcc-meet-time-h");
    const em = $("hqcc-meet-time-m");
    if (eh) eh.textContent = h || "—";
    if (em) em.textContent = m || "";
  }

  function setTitle(txt) { const el = $("hqcc-meet-title"); if (el) el.textContent = txt || ""; }
  function setNext(txt)  { const el = $("hqcc-meet-next");  if (el) el.textContent = txt || ""; }

  function refreshIcons() {
    if (window.refreshIcons) window.refreshIcons();
  }

  // ══════════════════════════════════════════════
  // Renderizadores de estados
  // ══════════════════════════════════════════════
  function renderLoading() {
    setState("loading");
    setBadge(null);
    setTime("—", "");
    setTitle("Cargando…");
    setNext("");
    setJoin({ href: "https://calendar.google.com", label: "Unirme", iconName: "video" });
    refreshIcons();
  }

  function renderEmpty() {
    setState("empty");
    setBadge(null);
    setTitle("Sin meetings próximos ✨");
    setNext("");
    setJoin({ href: "https://calendar.google.com", label: "Abrir calendario", iconName: "external-link" });
    refreshIcons();
  }

  function renderReconnect(reason) {
    setState("reconnect");
    setBadge(null);
    setTitle(reason === "no-permission"
      ? "El Hub necesita permiso para leer tu Google Calendar."
      : "Reconecta Google Calendar para ver tus meetings.");
    setNext("");
    setJoin({
      href: "#",
      label: "Reconectar",
      iconName: "refresh-cw",
      onclick: (e) => { e.preventDefault(); handleReconnectClick(); },
    });
    refreshIcons();
  }

  function renderError() {
    setState("error");
    setBadge(null);
    setTitle("No pudimos cargar tus meetings.");
    setNext("");
    setJoin({
      href: "#",
      label: "Reintentar",
      iconName: "refresh-cw",
      onclick: (e) => { e.preventDefault(); refresh({ force: true }); },
    });
    refreshIcons();
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
  // Post-procesamiento — devuelve lista ordenada de items futuros o en curso
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
      if (!ev.start || !ev.start.dateTime) continue;
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

      items.push({
        id: ev.id,
        title: ev.summary || "(Sin título)",
        startMs,
        endMs,
        dayGroup,
        joinLink: pickJoinLink(ev),
      });
    }
    return items;
  }

  // ══════════════════════════════════════════════
  // Formato y badge del próximo meeting
  // ══════════════════════════════════════════════
  function fmtHM(ms) {
    // Devuelve { h: "10:00", m: "AM" } para el layout del tile.
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(d);
    let h = "", m = "";
    for (const p of parts) {
      if (p.type === "hour" || p.type === "literal" || p.type === "minute") h += p.value;
      else if (p.type === "dayPeriod") m = p.value.toUpperCase();
    }
    return { h: h.trim(), m };
  }

  function badgeFor(item) {
    const now = Date.now();
    if (item.startMs <= now && now <= item.endMs) return "En curso";
    if (item.startMs > now && (item.startMs - now) <= IN_15_MIN_THRESHOLD_MS) {
      const mins = Math.max(1, Math.round((item.startMs - now) / 60000));
      return `En ${mins} min`;
    }
    return item.dayGroup === "mañana" ? "Mañana" : "Hoy";
  }

  // ══════════════════════════════════════════════
  // Render del próximo meeting
  // ══════════════════════════════════════════════
  function renderMeetings(items) {
    if (!items.length) { renderEmpty(); return; }

    const next = items[0];
    const follow = items[1] || null;

    setState("ready");
    setBadge(badgeFor(next));

    const t = fmtHM(next.startMs);
    setTime(t.h, t.m);
    setTitle(next.title);

    if (follow) {
      const ft = fmtHM(follow.startMs);
      const prefix = follow.dayGroup === "mañana" ? "Mañana" : "Luego";
      setNext(`${prefix} · ${ft.h} ${ft.m} · ${follow.title}`);
    } else {
      setNext(next.dayGroup === "mañana" ? "Mañana en tu agenda" : "Único evento de hoy");
    }

    if (next.joinLink) {
      setJoin({ href: next.joinLink, label: "Unirme", iconName: "video" });
    } else {
      setJoin({ href: "https://calendar.google.com", label: "Ver en Calendar", iconName: "external-link" });
    }
    refreshIcons();
  }

  // ══════════════════════════════════════════════
  // Refresh silencioso del token
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
      localStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload));
      return payload;
    } catch (e) {
      console.warn("[calendar-widget] refresh silencioso falló:", e.message);
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
    if (!getTile()) return;

    const token = await getFreshToken();
    if (!token) { renderReconnect(); return; }

    if (!cachedEvents || opts.force) renderLoading();

    try {
      const raw = await fetchMeetings(token.accessToken);
      const processed = processEvents(raw);
      cachedEvents = processed;
      lastFetchAt = Date.now();
      renderMeetings(processed);
    } catch (e) {
      if (e.message === "auth-required") {
        renderReconnect(e.status === 403 ? "no-permission" : undefined);
      } else {
        console.warn("[calendar-widget] fetch falló:", e.message);
        renderError();
      }
    }
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
        localStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload));
        await refresh({ force: true });
      }
    } catch (e) {
      console.warn("[calendar-widget] reconectar falló:", e.message);
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
    if (!getTile()) return;
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
