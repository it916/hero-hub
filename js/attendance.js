// ═══════════════════════════════════════════
// Hero Hub · Registro de Asistencia
// ═══════════════════════════════════════════
// Cablea los botones de la sección "Mi Asistencia" (index.html) con
// un endpoint de Google Apps Script que escribe en un Sheet.
//
// Tipos registrados:
//   Entrada · Salida · Inicio Break · Fin Break
//   Corte Luz Inicio · Corte Luz Fin · Ausencia
//
// El último evento se guarda en localStorage para mostrar el estado
// actual al recargar la página (sin hacer GET al Sheet).
//
// Apps Script: ver bloque al final de este archivo para el código y
// los pasos de despliegue.
// ═══════════════════════════════════════════

import { auth } from "./firebase-config.js";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxgZulYURxNjprHfvXuj82HHveHtNueg1J6SYkRPzqh8AjYSduzN9RkK-n5-1zO1N3F/exec";
const STORAGE_KEY = "hh-attendance-last";

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
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function formatTime(d) {
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(d) {
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
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
    return;
  }

  const d = new Date(last.timestamp);
  const meta = STATUS_FOR_TYPE[last.type] || { verb: last.type };
  const today = isSameLocalDay(last.timestamp, new Date().toISOString());

  // Estado vivo: si la última acción es de hoy, refleja el estado actual.
  // Si es de otro día, mostramos "— sin registro hoy —" y dejamos "último" como referencia.
  if (today) {
    if (meta.state === "fuera") {
      elState.textContent = `${meta.verb} a las ${formatTime(d)}`;
    } else if (meta.state === "ausencia") {
      elState.textContent = `Ausencia reportada`;
    } else {
      elState.textContent = `${meta.verb} desde ${formatTime(d)}`;
    }
  } else {
    elState.textContent = "— sin registro hoy —";
  }

  elLast.textContent = `${last.type} · ${formatDateLong(d)} · ${formatTime(d)}`;
}

// ── POST al Apps Script ────────────────────────────────────────────
async function postToSheet(payload) {
  // Sin Content-Type custom → evita CORS pre-flight con Apps Script.
  // El body llega a Apps Script como e.postData.contents (string).
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    redirect: "follow"
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
}

async function recordAttendance(type, btn, extras = {}) {
  const user = auth.currentUser;
  if (!user) { setFeedback("Sesión expirada. Recarga la página.", "err"); return; }
  if (!APPS_SCRIPT_URL) { setFeedback("⚠ Endpoint no configurado", "err"); return; }

  btn.classList.add("is-loading");
  btn.disabled = true;
  setFeedback(`Registrando ${type.toLowerCase()}…`);

  const now = new Date();
  const payload = {
    email: user.email,
    name: user.displayName || user.email.split("@")[0],
    type,
    timestamp: now.toISOString(),
    ...extras, // absenceDate, reason para ausencias
  };

  try {
    await postToSheet(payload);
    setFeedback(`✓ ${type} registrada a las ${formatTime(now)}`, "ok");
    saveLast(type, payload.timestamp, extras);
    refreshStatusFromStorage();
  } catch (e) {
    console.error("attendance:", e);
    setFeedback("✗ No se pudo registrar. Reintenta.", "err");
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

    if (!dateInput) { alert("Selecciona el día de ausencia."); return; }
    if (!reason) { alert("Escribe un motivo breve."); reasonEl.focus(); return; }

    const [y, m, d] = dateInput.split("-");
    const absenceDate = `${m}/${d}/${y}`;

    submitted = true;
    dialog.hide();
    await recordAttendance("Ausencia", triggerBtn, { absenceDate, reason });
  });

  dialog.show();
}

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

  refreshStatusFromStorage();
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
