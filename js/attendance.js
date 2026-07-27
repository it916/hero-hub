// ═══════════════════════════════════════════
// Hero Hub · Registro de Asistencia
// ═══════════════════════════════════════════
// Cablea los botones de la sección "Mi Asistencia" (index.html) con
// la colección `attendance` de Firestore (a través de attendance-store.js).
//
// Tipos registrados:
//   Entrada · Salida · Inicio Break · Fin Break
//   Corte Luz Inicio · Corte Luz Fin · Ausencia
//
// El último evento se guarda en localStorage para mostrar el estado
// actual al recargar la página (sin hacer read a Firestore).
//
// Historia: hasta v2.17.1 este módulo escribía a un Google Sheet vía
// Apps Script. En v2.18.0 migramos a Firestore por escalabilidad —
// el Sheet había pasado los 1000 registros y el doGet se estaba
// volviendo lento.
// ═══════════════════════════════════════════

import { auth } from "./firebase-config.js";
import { writeAttendance } from "./attendance-store.js";

const STORAGE_KEY = "hh-attendance-last";
const TICK_MS = 30_000;

// Título original de la pestaña — lo restauramos cuando el estado no necesita nudge.
const ORIGINAL_TITLE = document.title;
let tickerInterval = null;

// Mapa tipo → cómo se describe el estado vivo que provoca esa marcación
const STATUS_FOR_TYPE = {
  "Entrada":           { state: "trabajando", verb: "Trabajando" },
  "Salida":            { state: "fuera",      verb: "Jornada terminada" },
  "Inicio Break":      { state: "break",      verb: "En break" },
  "Fin Break":         { state: "trabajando", verb: "Trabajando" },
  "Corte Luz Inicio":  { state: "sin-luz",    verb: "Sin luz" },
  "Corte Luz Fin":     { state: "trabajando", verb: "Trabajando" },
  "Ausencia":          { state: "ausencia",   verb: "Ausencia reportada" },
};

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
  tickerInterval = setInterval(refreshStatusFromStorage, TICK_MS);
}
function stopStatusTicker() {
  if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
}

// ── localStorage: último evento ────────────────────────────────────
function loadLast() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.type || !obj.timestamp) return null;
    return obj;
  } catch { return null; }
}

function saveLast(type, timestamp, extra = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, timestamp, ...extra }));
  } catch {}
}

function isSameLocalDay(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function refreshStatusFromStorage() {
  const elState = document.getElementById("attStatusValue");
  const elLast  = document.getElementById("attLastValue");
  if (!elState || !elLast) return;

  const last = loadLast();
  if (!last) {
    elState.textContent = "— sin registro hoy —";
    elLast.textContent = "—";
    document.title = ORIGINAL_TITLE;
    stopStatusTicker();
    return;
  }

  const d = new Date(last.timestamp);
  const now = new Date();
  const meta = STATUS_FOR_TYPE[last.type] || { verb: last.type };
  const today = isSameLocalDay(last.timestamp, now.toISOString());

  // Estado vivo: si la última acción es de hoy, refleja el estado actual.
  // Si es de otro día, mostramos "— sin registro hoy —" y dejamos "último" como referencia.
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
      // Estados activos (trabajando, break, sin-luz): mostramos elapsed
      // en el status bar para que el tiempo transcurrido sea visible.
      elState.textContent = `${meta.verb} desde ${formatTime(d)} · ${formatElapsed(d, now)}`;

      // Tab title: solo en estados cortos que se olvidan (break / sin-luz).
      // Trabajando NO modifica el title — el nudge para Salida vive en el status bar.
      if (meta.state === "break") {
        document.title = `⏰ En break (${formatElapsedShort(d, now)}) — Hero Hub`;
      } else if (meta.state === "sin-luz") {
        document.title = `⚡ Sin luz (${formatElapsedShort(d, now)}) — Hero Hub`;
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

  elLast.textContent = `${last.type} · ${formatDateLong(d)} · ${formatTime(d)}`;
}

// ── Registro del evento (Firestore) ────────────────────────────────
async function recordAttendance(type, btn, extras = {}) {
  const user = auth.currentUser;
  if (!user) { setFeedback("Sesión expirada. Recarga la página.", "err"); return; }

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
    saveLast(type, now.toISOString(), extras);
    // Persistimos aparte el día de la primera Entrada para que
    // checkDailyPopup pueda detectarla aunque después se marquen Break/Salida
    // y "hh-attendance-last" ya no sea "Entrada".
    if (type === "Entrada") {
      try { localStorage.setItem("hh-attendance-entry-day", now.toISOString().slice(0, 10)); } catch {}
    }
    refreshStatusFromStorage();
    if (window.hqccSyncBreak) window.hqccSyncBreak();

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
    btn.disabled = false;
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
// El label se sincroniza leyendo el último evento de localStorage.
function initHqccBreakToggle() {
  const btn = document.getElementById("hqcc-break");
  if (!btn) return;
  const label = btn.querySelector(".hqcc-break-label");

  const onBreakNow = () => {
    const last = loadLast();
    if (!last) return false;
    if (last.type !== "Inicio Break") return false;
    return isSameLocalDay(last.timestamp, new Date().toISOString());
  };

  const sync = () => {
    const on = onBreakNow();
    btn.classList.toggle("on", on);
    // Labels cortos porque el botón vive en un grid de 3 columnas junto a Entrada/Salida.
    if (label) label.textContent = on ? "Volver" : "Break";
  };

  btn.addEventListener("click", () => {
    const proxyId = onBreakNow() ? "hqcc-break-out" : "hqcc-break-in";
    const proxy = document.getElementById(proxyId);
    if (proxy) proxy.click();
    // Le damos un tick para que recordAttendance guarde en localStorage antes de releer
    setTimeout(sync, 80);
  });

  window.addEventListener("storage", sync);
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
      btnAusencia.disabled = true;
      openAbsenceModal(btnAusencia);
    });
  }

  initHqccBreakToggle();
  refreshStatusFromStorage();

  // Si al cargar la página el usuario ya está en break hoy, reabre el modal.
  const last = loadLast();
  if (last && last.type === "Inicio Break" && isSameLocalDay(last.timestamp, new Date().toISOString())) {
    openBreakModal(last.timestamp);
  }
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
