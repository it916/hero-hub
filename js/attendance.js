// ═══════════════════════════════════════════
// Hero Hub · Registro de Asistencia
// ═══════════════════════════════════════════
// Cablea los botones de la sección "Mi Asistencia" (index.html) con
// la colección `attendance` de Firestore (a través de attendance-store.js).
//
// Tipos registrados:
//   Entrada · Salida · Inicio Break · Fin Break · Ausencia
//   (Los tipos "Corte Luz *" se descontinuaron el 2026-08-04 — v2.24.0.)
//
// FUENTE DE VERDAD: Firestore. Nos suscribimos al último evento del
// usuario vía onSnapshot, por lo que si marca desde otro device el
// estado se sincroniza en las pestañas abiertas.
//
// localStorage["hh-attendance-last"] se mantiene solo como cache de
// pre-render, para no mostrar "cargando" al abrir la página mientras
// Firestore responde. Se sobreescribe con lo que traiga el snapshot.
//
// Historia: hasta v2.17.1 escribíamos a un Google Sheet vía Apps Script.
// En v2.18.0 migramos a Firestore. En v2.24.0 la lectura pasó también
// a Firestore (antes solo localStorage) + máquina de transiciones válidas.
// ═══════════════════════════════════════════

import { auth } from "./firebase-config.js";
import { writeAttendance, subscribeLastEvent, fetchLastEvent } from "./attendance-store.js";

const STORAGE_KEY = "hh-attendance-last";
const TICK_MS = 30_000;

// Título original de la pestaña — lo restauramos cuando el estado no necesita nudge.
const ORIGINAL_TITLE = document.title;
let tickerInterval = null;

// Mapa tipo → cómo se describe el estado vivo que provoca esa marcación
const STATUS_FOR_TYPE = {
  "Entrada":      { state: "trabajando", verb: "Trabajando" },
  "Salida":       { state: "fuera",      verb: "Jornada terminada" },
  "Inicio Break": { state: "break",      verb: "En break" },
  "Fin Break":    { state: "trabajando", verb: "Trabajando" },
  "Ausencia":     { state: "ausencia",   verb: "Ausencia reportada" },
};

// ── Máquina de estados de transiciones válidas ──────────────────────
// Dado el último evento del día actual, ¿qué tipos puede marcar el usuario?
// Al cambiar de día se resetea a "sin registro" (Entrada + Ausencia).
const TRANSITIONS = {
  __none__:       new Set(["Entrada", "Ausencia"]),
  "Entrada":      new Set(["Salida", "Inicio Break"]),
  "Fin Break":    new Set(["Salida", "Inicio Break"]),
  "Inicio Break": new Set(["Fin Break"]),
  "Salida":       new Set([]),
  "Ausencia":     new Set([]),
};

// Motivo por tipo bloqueado. Se muestra como title del botón y como toast si el click cuela.
const BLOCK_REASON = {
  "Entrada":      "Ya marcaste tu Entrada hoy.",
  "Salida":       "No puedes marcar Salida antes de la Entrada.",
  "Inicio Break": "Solo puedes iniciar break si estás trabajando.",
  "Fin Break":    "Solo puedes terminar break si estás en break.",
  "Ausencia":     "No puedes reportar ausencia si ya marcaste asistencia hoy.",
};

// Estado en memoria — la fuente de verdad tras el primer snapshot de Firestore.
// { type, timestamp: ISO string, absenceDate?, reason? }
let currentState = null;

// Se resuelve cuando llegue el primer snapshot (o timeout / falla).
// auth.js espera esta promesa antes de decidir si abrir el modal de inicio de jornada.
let _readyResolve = null;
window.hhAttendanceReady = new Promise((resolve) => { _readyResolve = resolve; });
let _readySettled = false;
function _markReady(reason) {
  if (_readySettled) return;
  _readySettled = true;
  _readyResolve && _readyResolve(reason);
}

let _unsubSnapshot = null;

function statusFeedbackEl() { return document.getElementById("attendanceStatus"); }

function setFeedback(text, kind) {
  const el = statusFeedbackEl();
  if (el) {
    el.textContent = text;
    el.classList.remove("ok", "err");
    if (kind) el.classList.add(kind);
    return;
  }
  // Fallback: si la página no tiene el status bar (ej. mi-perfil.html),
  // usamos toasts para que el usuario vea confirmación.
  if (typeof heroToast !== "undefined") {
    if (kind === "ok") heroToast.success(text);
    else if (kind === "err") heroToast.error(text);
    // Los mensajes en progreso ("Registrando…") se omiten como toast — muy ruidoso.
  }
}

function formatTime(d) {
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(d) {
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

// "hace 23 min" / "hace 5h 23min" / "hace 2h" — texto del status bar.
function formatElapsed(start, now) {
  const diffMs = now - start;
  if (diffMs < 60_000) return "hace menos de 1 min";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
}

// "23 min" / "5h 23m" / "2h" — versión compacta para el title de la pestaña.
function formatElapsedShort(start, now) {
  const mins = Math.max(0, Math.floor((now - start) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function startStatusTicker() {
  if (tickerInterval) return;
  tickerInterval = setInterval(refreshStatusView, TICK_MS);
}
function stopStatusTicker() {
  if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
}

// ── localStorage: cache de pre-render (NO fuente de verdad) ────────
function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.type || !obj.timestamp) return null;
    return obj;
  } catch { return null; }
}

function saveCache(state) {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function isSameLocalDay(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Cálculo de transiciones válidas ────────────────────────────────
export function computeAllowedTypes(state, now = new Date()) {
  if (!state) return TRANSITIONS.__none__;
  if (!isSameLocalDay(state.timestamp, now.toISOString())) return TRANSITIONS.__none__;
  return TRANSITIONS[state.type] || TRANSITIONS.__none__;
}

// ── UI: sincroniza botones (habilitado/deshabilitado + title) ──────
function refreshButtonsState() {
  const allowed = computeAllowedTypes(currentState);

  document.querySelectorAll("button[data-att-type]").forEach(btn => {
    _applyButtonState(btn, allowed, btn.dataset.attType);
  });

  const btnAus = document.getElementById("btnAusencia");
  if (btnAus) _applyButtonState(btnAus, allowed, "Ausencia");

  // Botón break proxy del HQCC — activo si Inicio Break O Fin Break están permitidos.
  const btnBreak = document.getElementById("hqcc-break");
  if (btnBreak) {
    const canStartBreak = allowed.has("Inicio Break");
    const canEndBreak = allowed.has("Fin Break");
    const active = canStartBreak || canEndBreak;
    btnBreak.disabled = !active;
    btnBreak.classList.toggle("is-blocked", !active);
    if (!active) {
      btnBreak.title = BLOCK_REASON["Inicio Break"];
    } else {
      btnBreak.title = canEndBreak ? "Terminar break" : "Iniciar break";
    }
  }
}

function _applyButtonState(btn, allowedSet, type) {
  if (!type) return;
  const allowed = allowedSet.has(type);
  btn.disabled = !allowed;
  btn.classList.toggle("is-blocked", !allowed);
  if (!allowed) {
    btn.title = BLOCK_REASON[type] || "No disponible en este momento.";
  } else {
    btn.removeAttribute("title");
  }
}

// ── UI: status bar y título de pestaña ─────────────────────────────
function refreshStatusView() {
  const elState = document.getElementById("attStatusValue");
  const elLast  = document.getElementById("attLastValue");

  if (!currentState) {
    if (elState) elState.textContent = "— sin registro hoy —";
    if (elLast) elLast.textContent = "—";
    document.title = ORIGINAL_TITLE;
    stopStatusTicker();
    refreshButtonsState();
    return;
  }

  const d = new Date(currentState.timestamp);
  const now = new Date();
  const meta = STATUS_FOR_TYPE[currentState.type] || { verb: currentState.type };
  const today = isSameLocalDay(currentState.timestamp, now.toISOString());

  if (elState && elLast) {
    if (today) {
      if (meta.state === "fuera") {
        elState.textContent = `${meta.verb} a las ${formatTime(d)}`;
        document.title = ORIGINAL_TITLE;
        stopStatusTicker();
      } else if (meta.state === "ausencia") {
        elState.textContent = `Ausencia reportada`;
        document.title = ORIGINAL_TITLE;
        stopStatusTicker();
      } else {
        elState.textContent = `${meta.verb} desde ${formatTime(d)} · ${formatElapsed(d, now)}`;
        if (meta.state === "break") {
          document.title = `⏰ En break (${formatElapsedShort(d, now)}) — Hero Hub`;
        } else {
          document.title = ORIGINAL_TITLE;
        }
        startStatusTicker();
      }
    } else {
      elState.textContent = "— sin registro hoy —";
      document.title = ORIGINAL_TITLE;
      stopStatusTicker();
    }
    elLast.textContent = `${currentState.type} · ${formatDateLong(d)} · ${formatTime(d)}`;
  }

  refreshButtonsState();
}

// ── Aplicar un nuevo estado (llamado por snapshot o por escritura local) ──
function applyState(newState) {
  currentState = newState;
  saveCache(newState);
  refreshStatusView();
  if (window.hqccSyncBreak) window.hqccSyncBreak();
}

// ── Registro del evento (Firestore) ────────────────────────────────
async function recordAttendance(type, btn, extras = {}) {
  const user = auth.currentUser;
  if (!user) { setFeedback("Sesión expirada. Recarga la página.", "err"); return; }

  // Validación de transición: si el tipo NO está permitido, no escribimos.
  const allowed = computeAllowedTypes(currentState);
  if (!allowed.has(type)) {
    const reason = BLOCK_REASON[type] || "No disponible en este momento.";
    if (typeof heroToast !== "undefined") heroToast.info(reason);
    setFeedback(reason, "err");
    return;
  }

  btn.classList.add("is-loading");
  btn.disabled = true;
  setFeedback(`Registrando ${type.toLowerCase()}…`);

  const now = new Date();

  try {
    await writeAttendance({
      type,
      timestamp: now,
      absenceDate: extras.absenceDate,
      reason: extras.reason,
    });
    setFeedback(`✓ ${type} registrada a las ${formatTime(now)}`, "ok");

    // Optimistic update: aplicamos el estado nuevo YA para que la UI reaccione
    // sin esperar al round-trip del snapshot. El snapshot llegará después
    // y confirmará este estado.
    applyState({ type, timestamp: now.toISOString(), ...extras });

    // Persistimos aparte el día de la primera Entrada para que
    // checkDailyPopup pueda detectarla aunque después se marquen Break/Salida
    // y el estado actual ya no sea "Entrada".
    if (type === "Entrada") {
      try { localStorage.setItem("hh-attendance-entry-day", now.toISOString().slice(0, 10)); } catch {}
    }

    // Modal de break: se abre al iniciar y se cierra al terminar.
    if (type === "Inicio Break") openBreakModal(now);
    else if (type === "Fin Break") closeBreakModal();

    // Modal de inicio de jornada: si estaba abierto (o se marcó Entrada
    // desde el HQCC con el modal abierto), mostrar la vista de confirmación
    // + barra 5s antes de auto-cerrar.
    if (type === "Entrada") {
      const dp = document.getElementById("daily-popup");
      if (dp && dp.style.display !== "none" && typeof window.showJornadaConfirmation === "function") {
        window.showJornadaConfirmation();
      }
    }
  } catch (e) {
    console.error("attendance:", e);
    setFeedback("✗ No se pudo registrar. Reintenta.", "err");
    // Si el fallo es la Entrada disparada desde el modal de inicio de
    // jornada, reactivamos su botón para que el usuario pueda reintentar.
    if (type === "Entrada") {
      const btnStart = document.getElementById("dp-btn-start");
      if (btnStart) btnStart.disabled = false;
    }
  } finally {
    btn.classList.remove("is-loading");
    // No reactivamos btn.disabled aquí — refreshButtonsState (llamado
    // desde applyState o desde el próximo snapshot) decide si va habilitado.
    refreshButtonsState();
  }
}

// ── Modal de ausencia (sl-dialog) ──────────────────────────────────
function openAbsenceModal(triggerBtn) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const dialog = document.createElement("sl-dialog");
  dialog.label = "📝 Reportar ausencia";
  dialog.className = "att-abs-dialog";
  dialog.innerHTML = `
    <div class="att-abs-form">
      <p class="att-abs-note">
        Tu ausencia queda registrada para HR. Si es por varios días, reporta cada día por separado.
      </p>

      <label class="att-abs-date-label">
        <span>Día de ausencia</span>
        <input id="att-abs-date" type="date" value="${todayStr}">
      </label>

      <sl-textarea
        id="att-abs-reason"
        label="Motivo"
        rows="3"
        maxlength="200"
        resize="vertical"
        placeholder="Ej: cita médica, asunto personal, viaje…"
        required>
      </sl-textarea>
    </div>

    <sl-button slot="footer" id="att-abs-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="att-abs-submit" variant="primary">
      <i data-lucide="check" slot="prefix" style="width:14px;height:14px;"></i>
      Reportar ausencia
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  // Flatpickr sobre el <input> nativo (sl-input no funciona bien con Flatpickr porque su input está en shadow DOM)
  let fp = null;
  if (typeof window.flatpickr === "function") {
    fp = window.flatpickr(dialog.querySelector("#att-abs-date"), {
      locale: "es",
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "j \\d\\e F, Y",
      defaultDate: todayStr,
      disableMobile: true,
      monthSelectorType: "static",
    });
  }

  // Si el usuario ya envió la ausencia, recordAttendance se encarga del estado del botón.
  // Si solo cierra/cancela, hay que reactivar el botón manualmente.
  let submitted = false;

  dialog.addEventListener("sl-after-hide", () => {
    if (fp) fp.destroy();
    if (!submitted) triggerBtn.disabled = false;
    dialog.remove();
  });

  dialog.querySelector("#att-abs-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#att-abs-submit").addEventListener("click", async () => {
    const dateInput = dialog.querySelector("#att-abs-date").value;
    const reasonEl = dialog.querySelector("#att-abs-reason");
    const reason = (reasonEl.value || "").trim();

    if (!dateInput) {
      dialog.querySelector("#att-abs-date").focus();
      heroToast.error("Selecciona el día de ausencia.");
      return;
    }
    if (!reason) {
      reasonEl.focus();
      heroToast.error("Escribe un motivo breve.");
      return;
    }

    const [y, m, d] = dateInput.split("-");
    const absenceDate = `${m}/${d}/${y}`;

    submitted = true;
    dialog.hide();
    await recordAttendance("Ausencia", triggerBtn, { absenceDate, reason });
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

// ── Break toggle del HQCC ──────────────────────────────────────────
// En el banner HQ Command Center, el break tiene un solo botón visible
// (#hqcc-break) que hace de proxy a los dos ocultos (#hqcc-break-in /
// #hqcc-break-out) — que ya están cableados por data-att-type arriba.
// El label se sincroniza leyendo el estado actual en memoria.
function initHqccBreakToggle() {
  const btn = document.getElementById("hqcc-break");
  if (!btn) return;
  const label = btn.querySelector(".hqcc-break-label");

  const onBreakNow = () => {
    if (!currentState) return false;
    if (currentState.type !== "Inicio Break") return false;
    return isSameLocalDay(currentState.timestamp, new Date().toISOString());
  };

  const sync = () => {
    const on = onBreakNow();
    btn.classList.toggle("on", on);
    if (label) label.textContent = on ? "Volver" : "Break";
  };

  btn.addEventListener("click", () => {
    // Si el proxy está bloqueado por transición, no hacemos nada.
    if (btn.disabled) return;
    const proxyId = onBreakNow() ? "hqcc-break-out" : "hqcc-break-in";
    const proxy = document.getElementById(proxyId);
    if (proxy) proxy.click();
    setTimeout(sync, 80);
  });

  window.hqccSyncBreak = sync;
  sync();
}

// ── Modal Break (bloqueante) ───────────────────────────────────────
// El modal vive en index.html (#break-modal). Se abre al registrar
// "Inicio Break" y se cierra al terminar. No tiene X ni cierre por ESC;
// el único cierre es el botón "Terminar break" que a su vez dispara el
// evento de Fin Break. Se reabre automáticamente al recargar la página
// si el usuario dejó el break activo.
const BREAK_OVERTIME_MS = 30 * 60 * 1000; // 30 min
let _breakTimerInt = null;
let _breakOvertimeNoticed = false;

function _breakOvertimeKey(isoTs) {
  return "hh-break-30min-shown:" + new Date(isoTs).toISOString().slice(0, 10);
}

function _updateBreakTimer(startTs) {
  const el = document.getElementById("bm-timer");
  if (!el) return;
  const diff = Math.max(0, Date.now() - startTs);
  const totalSec = Math.floor(diff / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const hh = Math.floor(mm / 60);
  const mmRem = mm % 60;
  el.textContent = hh > 0
    ? `${hh}:${mmRem.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`
    : `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;

  if (diff >= BREAK_OVERTIME_MS) {
    el.classList.add("overtime");
    if (!_breakOvertimeNoticed) {
      _breakOvertimeNoticed = true;
      const startIso = new Date(startTs).toISOString();
      const flagKey = _breakOvertimeKey(startIso);
      if (localStorage.getItem(flagKey) !== "1") {
        try { localStorage.setItem(flagKey, "1"); } catch {}
        if (typeof heroToast !== "undefined") {
          heroToast.info("Ya llevas 30 min de break — recuerda regresar cuando puedas");
        }
      }
    }
  } else {
    el.classList.remove("overtime");
  }
}

function openBreakModal(startTs) {
  const overlay = document.getElementById("break-modal");
  if (!overlay) return;
  const startMs = startTs instanceof Date ? startTs.getTime() : new Date(startTs).getTime();

  overlay.classList.add("is-open");
  overlay.style.display = "flex";
  document.body.style.overflow = "hidden";

  // Reset overtime tracking para esta apertura; si ya se disparó el toast
  // para este día, el flag en localStorage evita repetirlo.
  _breakOvertimeNoticed = false;

  _updateBreakTimer(startMs);
  if (_breakTimerInt) clearInterval(_breakTimerInt);
  _breakTimerInt = setInterval(() => _updateBreakTimer(startMs), 1000);

  if (window.refreshIcons) window.refreshIcons();

  const endBtn = document.getElementById("bm-end-btn");
  if (endBtn && !endBtn.dataset.bound) {
    endBtn.dataset.bound = "1";
    endBtn.addEventListener("click", () => {
      endBtn.disabled = true;
      const proxy = document.getElementById("hqcc-break-out");
      if (proxy) proxy.click();
      // recordAttendance("Fin Break") → cierra el modal vía el hook.
      // Reactivamos el botón por si falló y el modal sigue abierto.
      setTimeout(() => { endBtn.disabled = false; }, 1500);
    });
  }
}

function closeBreakModal() {
  const overlay = document.getElementById("break-modal");
  if (!overlay) return;
  overlay.classList.remove("is-open");
  overlay.style.display = "none";
  document.body.style.overflow = "";
  if (_breakTimerInt) { clearInterval(_breakTimerInt); _breakTimerInt = null; }
}

window.openBreakModal = openBreakModal;
window.closeBreakModal = closeBreakModal;

// ── Suscripción a Firestore ────────────────────────────────────────
// currentUser guardado para poder reconciliar/resuscribir sin depender
// de auth.currentUser (que puede ser null en callbacks tardíos).
let _subscribedUser = null;

function startSubscription(user) {
  _subscribedUser = user;
  if (_unsubSnapshot) { _unsubSnapshot(); _unsubSnapshot = null; }
  _unsubSnapshot = subscribeLastEvent({ email: user.email }, (evt, err) => {
    if (err) {
      // Si Firestore falla, mantenemos el cache y liberamos la promesa
      // para que auth.js no quede colgado esperando.
      _markReady({ ok: false, err });
      return;
    }
    const newState = evt
      ? {
          type: evt.type,
          timestamp: evt.timestamp.toISOString(),
          absenceDate: evt.absenceDate,
          reason: evt.reason,
        }
      : null;
    applyState(newState);
    _markReady({ ok: true });
  });
}

// Hardening cross-device: Chrome suspende websockets en pestañas dormidas.
// Cuando la pestaña vuelve a visible o al foco, fetch directo del último
// evento y re-suscripción si cambió. Cubre el caso: usuario marca Entrada
// desde móvil, deja el desktop dormido; al volver al desktop la vista
// tiene que reflejar la Entrada nueva sin esperar a que onSnapshot
// eventualmente re-conecte.
async function reconcileFromFirestore(reason) {
  if (!_subscribedUser) return;
  try {
    const evt = await fetchLastEvent({ email: _subscribedUser.email });
    // Defensa crítica: si el fetch devuelve null pero SÍ teníamos estado en
    // cache, es casi seguro un error transitorio (query cancelada por race
    // con auth, cache vacío temporal, etc.). NO borramos el cache — el
    // próximo snapshot corregirá. Sin esta guarda, entrar a la página
    // dispara `focus`, fetch devuelve null, y borramos el "Entrada" del
    // día → aparece el modal de entrada + Break bloqueado.
    if (!evt && currentState) return;

    const newState = evt
      ? {
          type: evt.type,
          timestamp: evt.timestamp.toISOString(),
          absenceDate: evt.absenceDate,
          reason: evt.reason,
        }
      : null;
    // Aplicar solo si difiere del actual (evita re-renders innecesarios).
    const cur = currentState;
    const changed = (!cur && newState)
      || (cur && newState && (cur.type !== newState.type || cur.timestamp !== newState.timestamp));
    if (changed) {
      applyState(newState);
    }
    // Re-suscribir si la suscripción murió en background — barato porque
    // Firestore deduplica por query.
    if (reason === 'visibility') {
      startSubscription(_subscribedUser);
    }
  } catch (err) {
    console.warn('[attendance] reconcile falló:', err && err.message);
  }
}

// Dispara reconciliación cuando la pestaña vuelve a foco/visible.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reconcileFromFirestore('visibility');
  }
});
window.addEventListener('focus', () => {
  reconcileFromFirestore('focus');
});

// ── Init ───────────────────────────────────────────────────────────
function init() {
  // Botones genéricos: data-att-type indica qué tipo registrar
  document.querySelectorAll("button[data-att-type]").forEach(btn => {
    const type = btn.dataset.attType;
    btn.addEventListener("click", () => recordAttendance(type, btn));
  });

  // Botón ausencia (abre modal)
  const btnAusencia = document.getElementById("btnAusencia");
  if (btnAusencia) {
    btnAusencia.addEventListener("click", () => {
      const allowed = computeAllowedTypes(currentState);
      if (!allowed.has("Ausencia")) {
        if (typeof heroToast !== "undefined") heroToast.info(BLOCK_REASON["Ausencia"]);
        return;
      }
      btnAusencia.disabled = true;
      openAbsenceModal(btnAusencia);
    });
  }

  initHqccBreakToggle();

  // Pinta con cache mientras carga el snapshot.
  const cached = loadCache();
  if (cached) currentState = cached;
  refreshStatusView();

  // Si al cargar la página el usuario ya está en break hoy, reabre el modal.
  if (currentState && currentState.type === "Inicio Break"
      && isSameLocalDay(currentState.timestamp, new Date().toISOString())) {
    openBreakModal(currentState.timestamp);
  }

  // Cuando auth tenga usuario, arrancamos la suscripción a Firestore.
  if (auth.currentUser) {
    startSubscription(auth.currentUser);
  } else {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) {
        startSubscription(user);
        unsub();
      }
    });
  }

  // Safety net: si Firestore tarda demasiado en responder, liberamos la
  // promesa hhAttendanceReady igual — auth.js caerá al fallback de cache.
  setTimeout(() => _markReady({ ok: false, reason: "timeout" }), 3500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ═══════════════════════════════════════════════════════════════════════
   CÓDIGO DEL GOOGLE APPS SCRIPT (pégalo en Extensiones → Apps Script)
   ═══════════════════════════════════════════════════════════════════════

   Sheet con columnas (en este orden):
     Fecha | Hora | Email | Nombre | Tipo | Fecha objetivo | Motivo

   Las dos últimas columnas solo se llenan en eventos "Ausencia"; en el
   resto van vacías. Esto permite filtrar fácilmente desde el Sheet.

const SHEET_ID = "PEGA_AQUI_EL_ID_DEL_SHEET";
const SHEET_NAME = "Asistencia";
const TIMEZONE = "America/New_York";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const d = new Date(data.timestamp);
    const fecha = Utilities.formatDate(d, TIMEZONE, "MM/dd/yyyy");
    const hora  = Utilities.formatDate(d, TIMEZONE, "HH:mm:ss");
    sheet.appendRow([
      fecha,
      hora,
      data.email,
      data.name,
      data.type,
      data.absenceDate || "",
      data.reason || ""
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET: devuelve TODA la data del Sheet como JSON, para el dashboard de asistencia.
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    // Saltar la fila del header
    const data = rows.slice(1).map(r => ({
      fecha: Utilities.formatDate(new Date(r[0]), TIMEZONE, "MM/dd/yyyy"),
      hora: typeof r[1] === "string" ? r[1] : Utilities.formatDate(new Date(r[1]), TIMEZONE, "HH:mm:ss"),
      email: r[2],
      nombre: r[3],
      tipo: r[4],
      fechaObjetivo: r[5] || null,
      motivo: r[6] || null
    }));
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

   ─── Pasos para desplegar la VERSIÓN NUEVA ───────────────────────────────
   1. En el Sheet, agregar dos columnas nuevas a la derecha:
        Fecha objetivo | Motivo
      El header completo queda:
        Fecha | Hora | Email | Nombre | Tipo | Fecha objetivo | Motivo
   2. Extensiones → Apps Script → reemplaza/agrega doPost y doGet.
   3. Guardar. IMPORTANTE: redeploy.
        Administrar implementaciones → ✏️ Editar → Versión: NUEVA → Implementar.
      Solo guardar NO actualiza el endpoint público.
   4. La URL del endpoint no cambia entre versiones — atiende tanto GET (dashboard)
      como POST (botones de asistencia).

   ═══════════════════════════════════════════════════════════════════════ */
