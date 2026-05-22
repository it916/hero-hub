// ═══════════════════════════════════════════
// Hero Hub · Registro de Asistencia
// ═══════════════════════════════════════════
// Cablea los botones de Entrada / Salida del banner principal
// con un endpoint de Google Apps Script que escribe en un Sheet.
//
// CONFIGURACIÓN:
// 1. Crea un Google Sheet con columnas: Timestamp | Email | Nombre | Tipo
// 2. Extensiones → Apps Script → pega el código que aparece al final de este archivo
// 3. Implementar → Nueva implementación → Tipo: aplicación web
//    - "Ejecutar como": yo mismo
//    - "Quién tiene acceso": cualquier usuario
// 4. Copia la URL de la implementación
// 5. Pégala abajo en APPS_SCRIPT_URL
// ═══════════════════════════════════════════

import { auth } from "./firebase-config.js";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxgZulYURxNjprHfvXuj82HHveHtNueg1J6SYkRPzqh8AjYSduzN9RkK-n5-1zO1N3F/exec";

function statusEl() { return document.getElementById("attendanceStatus"); }

function setStatus(text, kind) {
  const el = statusEl();
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function formatNowTime() {
  const d = new Date();
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

async function recordAttendance(type, btn) {
  const user = auth.currentUser;
  if (!user) {
    setStatus("Sesión expirada. Recarga la página.", "err");
    return;
  }

  if (!APPS_SCRIPT_URL) {
    setStatus("⚠ Endpoint no configurado todavía", "err");
    console.warn("attendance.js: APPS_SCRIPT_URL vacío. Configurar con la URL del Apps Script desplegado.");
    return;
  }

  btn.classList.add("is-loading");
  btn.disabled = true;
  setStatus(`Registrando ${type.toLowerCase()}…`);

  const payload = {
    email: user.email,
    name: user.displayName || user.email.split("@")[0],
    type,
    timestamp: new Date().toISOString()
  };

  try {
    // Sin Content-Type custom para evitar CORS pre-flight con Apps Script.
    // El body llega a Apps Script como e.postData.contents (string).
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    setStatus(`✓ ${type} registrada a las ${formatNowTime()}`, "ok");
  } catch (e) {
    console.error("attendance:", e);
    setStatus("✗ No se pudo registrar. Reintenta.", "err");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

function init() {
  const btnEntrada = document.getElementById("btnEntrada");
  const btnSalida = document.getElementById("btnSalida");
  if (btnEntrada) btnEntrada.addEventListener("click", () => recordAttendance("Entrada", btnEntrada));
  if (btnSalida) btnSalida.addEventListener("click", () => recordAttendance("Salida", btnSalida));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ═══════════════════════════════════════════════════════════════════════
   CÓDIGO DEL GOOGLE APPS SCRIPT (pégalo en Extensiones → Apps Script)
   ═══════════════════════════════════════════════════════════════════════

const SHEET_ID = "PEGA_AQUI_EL_ID_DEL_SHEET";      // de la URL del Sheet
const SHEET_NAME = "Asistencia";                    // nombre de la pestaña
const TIMEZONE = "America/New_York";                // Miami

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const d = new Date(data.timestamp);
    const fecha = Utilities.formatDate(d, TIMEZONE, "MM/dd/yyyy");
    const hora  = Utilities.formatDate(d, TIMEZONE, "HH:mm:ss");
    sheet.appendRow([fecha, hora, data.email, data.name, data.type]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

   ─── Pasos para desplegar ────────────────────────────────────────────────
   1. En el Sheet, agrega como primera fila los headers:
        Fecha | Hora | Email | Nombre | Tipo
   2. Extensiones → Apps Script → pega este bloque, reemplaza SHEET_ID.
   3. Guardar. Implementar → Nueva implementación → Tipo: aplicación web.
        - Ejecutar como: yo mismo
        - Quién tiene acceso: cualquier usuario
   4. Copia la URL `https://script.google.com/macros/s/.../exec`.
   5. Pégala en `APPS_SCRIPT_URL` arriba de este archivo.

   Si cambias el código de un deployment ya existente, debes hacer
   "Administrar implementaciones → Editar → Versión: nueva → Implementar"
   para que la URL apunte al código actualizado.
   ═══════════════════════════════════════════════════════════════════════ */
