// ═══════════════════════════════════════════
// Hero Hub · Migración one-shot de Asistencia
// ═══════════════════════════════════════════
// Descarga TODOS los registros del Google Sheet vía el doGet del
// Apps Script viejo y los sube a Firestore usando IDs determinísticos
// para que sea idempotente (correr dos veces no duplica).
//
// Solo accesible por rol admin/IT (page-guard.js).
// Después del cutover exitoso, este archivo + migrar-asistencia.html
// se pueden borrar del repo.

import { writeAttendanceWithId, buildDocId } from "./attendance-store.js";
import { isAdmin } from "./roles.js";

// Endpoint del Apps Script viejo (sigue funcionando hasta que archivemos el Sheet).
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxgZulYURxNjprHfvXuj82HHveHtNueg1J6SYkRPzqh8AjYSduzN9RkK-n5-1zO1N3F/exec";

// Concurrencia de escrituras: 5 en paralelo mantiene throughput sin saturar Firestore.
const CONCURRENCY = 5;

// ── UI helpers ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function log(msg, kind = "info") {
  const el = $("log");
  const div = document.createElement("div");
  div.className = "log-" + kind;
  const ts = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  div.textContent = `[${ts}] ${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function setProgress(pct) {
  $("progress-bar").style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function setStat(id, value) {
  $(id).textContent = String(value);
}

function clearLog() {
  const el = $("log");
  el.replaceChildren();
}

// ── Fecha/hora del Sheet → Date (America/New_York) ────────────────
// El Sheet guarda "MM/DD/YYYY" + "HH:mm:ss" en NY tz. Reconstruimos
// un Date correcto teniendo en cuenta DST usando Intl como referencia.
const NY_TZ = "America/New_York";

function fromNyDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [m, d, y] = String(dateStr).split("/").map(s => parseInt(s, 10));
  const [hh, mm, ss] = (timeStr || "00:00:00").split(":").map(s => parseInt(s, 10) || 0);
  if (!y || !m || !d) return null;

  // Empezamos asumiendo que el string es UTC.
  const wantedMs = Date.UTC(y, m - 1, d, hh, mm, ss);

  // Vemos qué hora dice NY para ese instante UTC.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).formatToParts(new Date(wantedMs));

  const nyY = parseInt(parts.find(p => p.type === "year").value, 10);
  const nyM = parseInt(parts.find(p => p.type === "month").value, 10);
  const nyD = parseInt(parts.find(p => p.type === "day").value, 10);
  let nyH = parseInt(parts.find(p => p.type === "hour").value, 10);
  const nyMin = parseInt(parts.find(p => p.type === "minute").value, 10);
  const nyS = parseInt(parts.find(p => p.type === "second").value, 10);
  if (nyH === 24) nyH = 0;

  const gotMs = Date.UTC(nyY, nyM - 1, nyD, nyH, nyMin, nyS);
  const offset = wantedMs - gotMs;
  return new Date(wantedMs + offset);
}

// ── Fetch de todos los eventos del Sheet ──────────────────────────
async function fetchSheetEvents() {
  const resp = await fetch(APPS_SCRIPT_URL, { method: "GET", redirect: "follow" });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " al leer del Sheet");
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || "Respuesta inválida del Apps Script");
  return json.data || [];
}

// ── Batch writer con concurrencia limitada ────────────────────────
async function runBatch(items, worker) {
  const results = { ok: 0, err: 0 };
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        await worker(items[i], i);
        results.ok++;
      } catch (e) {
        results.err++;
        log(`Error en fila ${i + 1}: ${e.message}`, "err");
      }
      // Actualizar contadores en UI cada N iteraciones para no saturar.
      if ((results.ok + results.err) % 10 === 0 || cursor >= items.length) {
        setStat("stat-written", results.ok);
        setStat("stat-errors", results.err);
        setProgress(((results.ok + results.err) / items.length) * 100);
      }
    }
  }

  const workers = Array(Math.min(CONCURRENCY, items.length)).fill(0).map(next);
  await Promise.all(workers);
  return results;
}

// ── Proceso principal ─────────────────────────────────────────────
async function runMigration() {
  const btn = $("btn-start");
  btn.disabled = true;
  clearLog();
  setProgress(0);
  setStat("stat-total", "—");
  setStat("stat-written", 0);
  setStat("stat-skipped", 0);
  setStat("stat-errors", 0);

  try {
    log("Descargando registros del Sheet…", "info");
    const rows = await fetchSheetEvents();
    log(`Recibidas ${rows.length} filas del Sheet.`, "ok");
    setStat("stat-total", rows.length);

    // Preparamos los payloads y filtramos filas incompletas.
    const payloads = [];
    let skipped = 0;
    for (const row of rows) {
      const ts = fromNyDateTime(row.fecha, row.hora);
      if (!ts || !row.email || !row.tipo) {
        skipped++;
        continue;
      }
      const email = String(row.email).toLowerCase().trim();
      const name = row.nombre || email.split("@")[0];
      const id = buildDocId({ email, timestamp: ts, type: row.tipo });
      payloads.push({
        id,
        email,
        name,
        type: row.tipo,
        timestamp: ts,
        absenceDate: row.fechaObjetivo || null,
        reason: row.motivo || null,
      });
    }
    setStat("stat-skipped", skipped);
    if (skipped > 0) log(`${skipped} filas saltadas por datos incompletos.`, "warn");
    log(`Subiendo ${payloads.length} eventos a Firestore (${CONCURRENCY} concurrentes)…`, "info");

    const t0 = performance.now();
    const results = await runBatch(payloads, async (p) => {
      const { id, ...data } = p;
      await writeAttendanceWithId(id, data);
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);

    setStat("stat-written", results.ok);
    setStat("stat-errors", results.err);
    setProgress(100);

    if (results.err === 0) {
      log(`Migración completa: ${results.ok} eventos escritos en ${secs}s.`, "ok");
      heroToast.success(`Migración completa · ${results.ok} eventos`);
    } else {
      log(`Migración terminó con errores: ${results.ok} OK, ${results.err} fallidos.`, "warn");
      heroToast.error(`Migración con errores · revisa el log`);
    }
  } catch (e) {
    console.error("[migrar-asistencia]", e);
    log("FATAL: " + e.message, "err");
    heroToast.error("Migración interrumpida: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ── Init: verificar rol antes de habilitar el botón ───────────────
window.HeroHubContext.readyPromise.then(() => {
  const userRole = window.HeroHubContext.userRole;
  if (!isAdmin(userRole)) {
    // page-guard ya debería haber redirigido; esto es defensa en profundidad.
    log("Acceso denegado — solo rol admin/IT.", "err");
    $("btn-start").disabled = true;
    return;
  }
  log(`Sesión activa: ${window.HeroHubContext.user.email} (${userRole.role}). Listo para migrar.`, "info");
  $("btn-start").addEventListener("click", runMigration);
});
