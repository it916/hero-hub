// ═══════════════════════════════════════════
// Hero Hub · Dashboard de Asistencia
// ═══════════════════════════════════════════
// Lee los registros del Sheet de Asistencia vía GET al Apps Script,
// agrega los datos en memoria y renderiza:
//   - 4 contadores de estado actual
//   - Lista de equipo en vivo
//   - Donut de distribución (Chart.js)
//   - Barras de horas trabajadas por persona (Chart.js)
//   - Lista de cortes de luz
//   - Lista de ausencias
//
// Vive como tab dentro de admin.html. La verificación de rol admin
// la hace admin.js antes de invocar initAsistenciaDashboard().

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxgZulYURxNjprHfvXuj82HHveHtNueg1J6SYkRPzqh8AjYSduzN9RkK-n5-1zO1N3F/exec";

const STATUS_META = {
  "trabajando":   { label: "Trabajando", color: "#10b981", icon: "check-circle-2" },
  "break":        { label: "En break",   color: "#06a3b6", icon: "coffee" },
  "sin-luz":      { label: "Sin luz",    color: "#f59e0b", icon: "zap-off" },
  "fuera":        { label: "Fuera",      color: "#94a3b8", icon: "log-out" },
  "ausencia":     { label: "Ausencia",   color: "#64748b", icon: "calendar-x" },
  "sin-registro": { label: "Sin registro hoy", color: "#cbd5e1", icon: "circle" },
};

let allEvents = [];
const charts = {};

// ── Helpers de fecha/tiempo ────────────────────────────────────────
function parseMMDDYYYY(str) {
  if (!str) return null;
  if (str instanceof Date) return new Date(str);
  const [m, d, y] = String(str).split("/");
  if (!m || !d || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function parseEventDate(ev) {
  if (!ev.fecha) return null;
  if (ev.fecha instanceof Date) return new Date(ev.fecha);
  const base = parseMMDDYYYY(ev.fecha);
  if (!base) return null;
  if (!ev.hora) return base;
  const horaStr = String(ev.hora);
  const [hh, mm, ss] = horaStr.split(":");
  base.setHours(parseInt(hh) || 0, parseInt(mm) || 0, parseInt(ss) || 0);
  return base;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=domingo, 1=lunes,...
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function fmtTime(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function fmtDateShort(d) {
  if (!d) return "—";
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
function fmtHoursMinutes(ms) {
  if (!ms || ms <= 0) return "0h 0min";
  const total = Math.floor(ms / 60000);
  return `${Math.floor(total / 60)}h ${total % 60}min`;
}

function escapeHtml(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ── Init (llamado desde admin.js cuando el tab "asistencia" se abre) ──
let handlersBound = false;

export async function initAsistenciaDashboard() {
  if (!handlersBound) {
    const refreshBtn = document.getElementById("ad-refresh");
    const periodSel = document.getElementById("ad-period");
    if (refreshBtn) refreshBtn.addEventListener("click", () => fetchAndRender());
    if (periodSel) periodSel.addEventListener("change", renderAll);
    handlersBound = true;
  }
  await fetchAndRender();
}

// ── Fetch & render ─────────────────────────────────────────────────
async function fetchAndRender() {
  const loading = document.getElementById("ad-loading");
  const errorEl = document.getElementById("ad-error");
  const content = document.getElementById("ad-content");
  loading.style.display = "block";
  errorEl.style.display = "none";
  content.style.display = "none";

  try {
    const resp = await fetch(APPS_SCRIPT_URL, { method: "GET", redirect: "follow" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || "Respuesta inválida del Apps Script");
    allEvents = json.data || [];

    document.getElementById("ad-last-update").textContent =
      "Actualizado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

    renderAll();
    loading.style.display = "none";
    content.style.display = "block";
  } catch (e) {
    console.error("asistencia-dashboard:", e);
    loading.style.display = "none";
    errorEl.style.display = "block";
    errorEl.innerHTML = `
      <div class="ad-error-icon"><i data-lucide="alert-triangle"></i></div>
      <div class="ad-error-text">No pudimos cargar la data del Sheet.</div>
      <div class="ad-error-detail">${escapeHtml(e.message)}<br>Verifica que el Apps Script tenga <code>doGet</code> y esté redeployed con nueva versión.</div>`;
    if (window.refreshIcons) window.refreshIcons();
  }
}

// ── Cálculos: estado actual por persona (hoy) ──────────────────────
function computeCurrentStateByPerson(events, today) {
  const todayStart = startOfDay(today);
  const byEmail = new Map();
  for (const ev of events) {
    if (!ev.email) continue;
    const d = parseEventDate(ev);
    if (!d || d < todayStart) continue;
    if (!byEmail.has(ev.email)) byEmail.set(ev.email, []);
    byEmail.get(ev.email).push({ ...ev, _date: d });
  }

  const result = [];
  for (const [email, evs] of byEmail) {
    evs.sort((a, b) => a._date - b._date);
    const last = evs[evs.length - 1];
    let state;
    switch (last.tipo) {
      case "Entrada":
      case "Fin Break":
      case "Corte Luz Fin":    state = "trabajando"; break;
      case "Inicio Break":     state = "break"; break;
      case "Corte Luz Inicio": state = "sin-luz"; break;
      case "Salida":           state = "fuera"; break;
      case "Ausencia":         state = "ausencia"; break;
      default:                 state = "sin-registro";
    }

    // Timestamps clave del día: primera Entrada, único Break, última Salida
    let entradaTime = null, breakStart = null, breakEnd = null, salidaTime = null;
    for (const ev of evs) {
      if (ev.tipo === "Entrada" && !entradaTime) entradaTime = ev._date;
      if (ev.tipo === "Inicio Break" && !breakStart) breakStart = ev._date;
      if (ev.tipo === "Fin Break" && !breakEnd) breakEnd = ev._date;
      if (ev.tipo === "Salida") salidaTime = ev._date;
    }

    result.push({
      email,
      name: last.nombre || email,
      state,
      lastEvent: last.tipo,
      lastTime: last._date,
      entradaTime,
      breakStart,
      breakEnd,
      salidaTime,
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Cálculos: horas trabajadas (state machine) ─────────────────────
function computeHoursWorked(events, rangeStart, rangeEnd, now) {
  const byEmail = new Map();
  for (const ev of events) {
    if (!ev.email) continue;
    const d = parseEventDate(ev);
    if (!d) continue;
    if (d < rangeStart || d > rangeEnd) continue;
    if (!byEmail.has(ev.email)) byEmail.set(ev.email, { name: ev.nombre, events: [] });
    byEmail.get(ev.email).events.push({ ...ev, _date: d });
  }

  const result = [];
  for (const [email, { name, events: evs }] of byEmail) {
    evs.sort((a, b) => a._date - b._date);
    let totalMs = 0;
    let workStart = null;

    for (const ev of evs) {
      switch (ev.tipo) {
        case "Entrada":
        case "Fin Break":
        case "Corte Luz Fin":
          workStart = ev._date;
          break;
        case "Salida":
        case "Inicio Break":
        case "Corte Luz Inicio":
          if (workStart) {
            totalMs += ev._date - workStart;
            workStart = null;
          }
          break;
        // Ausencia no afecta horas trabajadas
      }
    }
    // Si quedó tramo abierto, contar hasta NOW (o fin de rango)
    if (workStart) {
      const cutoff = now < rangeEnd ? now : rangeEnd;
      if (cutoff > workStart) totalMs += cutoff - workStart;
    }
    result.push({ email, name: name || email, hoursMs: totalMs });
  }
  return result.sort((a, b) => b.hoursMs - a.hoursMs);
}

// ── Cálculos: cortes de luz (pares Inicio/Fin) ─────────────────────
function computePowerOutages(events, rangeStart, rangeEnd) {
  const byEmail = new Map();
  for (const ev of events) {
    if (!ev.email) continue;
    if (ev.tipo !== "Corte Luz Inicio" && ev.tipo !== "Corte Luz Fin") continue;
    const d = parseEventDate(ev);
    if (!d) continue;
    if (!byEmail.has(ev.email)) byEmail.set(ev.email, []);
    byEmail.get(ev.email).push({ ...ev, _date: d });
  }

  const outages = [];
  for (const [email, evs] of byEmail) {
    evs.sort((a, b) => a._date - b._date);
    let openStart = null;
    for (const ev of evs) {
      if (ev.tipo === "Corte Luz Inicio") {
        openStart = ev;
      } else if (ev.tipo === "Corte Luz Fin" && openStart) {
        if (openStart._date >= rangeStart && openStart._date <= rangeEnd) {
          outages.push({
            email, name: openStart.nombre,
            start: openStart._date, end: ev._date,
            durationMs: ev._date - openStart._date,
            ongoing: false,
          });
        }
        openStart = null;
      }
    }
    if (openStart && openStart._date >= rangeStart && openStart._date <= rangeEnd) {
      outages.push({
        email, name: openStart.nombre,
        start: openStart._date, end: null,
        durationMs: Date.now() - openStart._date,
        ongoing: true,
      });
    }
  }
  return outages.sort((a, b) => b.start - a.start);
}

// ── Cálculos: ausencias (últimos N días) ──────────────────────────
function computeAbsences(events, daysAgo) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);
  cutoff.setHours(0, 0, 0, 0);

  return events
    .filter(ev => ev.tipo === "Ausencia")
    .map(ev => ({
      email: ev.email,
      name: ev.nombre,
      reportedAt: parseEventDate(ev),
      targetDate: ev.fechaObjetivo ? parseMMDDYYYY(ev.fechaObjetivo) : null,
      reason: ev.motivo || "",
    }))
    .filter(a => a.reportedAt && a.reportedAt >= cutoff)
    .sort((a, b) => (b.targetDate || b.reportedAt) - (a.targetDate || a.reportedAt));
}

// ── Render principal ───────────────────────────────────────────────
function renderAll() {
  const now = new Date();
  const periodSel = document.getElementById("ad-period").value;
  let rangeStart, periodLabel;
  if (periodSel === "today") {
    rangeStart = startOfDay(now);
    periodLabel = "hoy";
  } else if (periodSel === "month") {
    rangeStart = startOfMonth(now);
    periodLabel = "este mes";
  } else {
    rangeStart = startOfWeek(now);
    periodLabel = "esta semana";
  }
  const rangeEnd = now;

  document.getElementById("ad-period-label").textContent =
    periodSel === "today" ? "Hoy" : (periodSel === "month" ? "Este mes" : "Esta semana");
  document.getElementById("ad-hours-period-label").textContent = periodLabel;
  document.getElementById("ad-power-period-label").textContent = periodLabel;

  // Estado actual (siempre HOY, independiente del selector)
  const states = computeCurrentStateByPerson(allEvents, now);
  renderCounters(states);
  renderTeamList(states);
  renderDonut(states);

  // Horas trabajadas dentro del rango seleccionado
  const hours = computeHoursWorked(allEvents, rangeStart, rangeEnd, now);
  renderHoursBars(hours);

  // Cortes de luz dentro del rango
  const outages = computePowerOutages(allEvents, rangeStart, rangeEnd);
  renderPowerList(outages);

  // Ausencias últimos 30 días (siempre)
  const absences = computeAbsences(allEvents, 30);
  renderAbsenceList(absences);

  if (window.refreshIcons) window.refreshIcons();
}

function renderCounters(states) {
  const counts = { trabajando: 0, break: 0, "sin-luz": 0, fuera: 0, ausencia: 0 };
  states.forEach(s => { if (counts[s.state] !== undefined) counts[s.state]++; });
  document.getElementById("ad-count-working").textContent = counts.trabajando;
  document.getElementById("ad-count-break").textContent = counts.break;
  document.getElementById("ad-count-power").textContent = counts["sin-luz"];
  document.getElementById("ad-count-out").textContent = counts.fuera + counts.ausencia;
}

function renderTeamList(states) {
  const list = document.getElementById("ad-team-list");
  if (!states.length) {
    list.innerHTML = `<div class="ad-empty">— Nadie ha marcado hoy —</div>`;
    return;
  }
  list.innerHTML = states.map(s => {
    const meta = STATUS_META[s.state] || STATUS_META["sin-registro"];
    const breakEndStr = s.breakStart && !s.breakEnd && s.state === "break"
      ? "(en curso)"
      : fmtTime(s.breakEnd);
    return `
      <div class="ad-team-row" data-state="${s.state}">
        <div class="ad-team-top">
          <div class="ad-team-name">${escapeHtml(s.name)}</div>
          <div class="ad-team-status">
            <span class="ad-status-pill" style="background:${meta.color}1a; color:${meta.color}; border-color:${meta.color}44;">
              <i data-lucide="${meta.icon}"></i> ${meta.label}
            </span>
            <span class="ad-team-time">desde ${fmtTime(s.lastTime)}</span>
          </div>
        </div>
        <div class="ad-team-detail">
          <span><span class="ad-d-lbl">Entrada</span> ${fmtTime(s.entradaTime)}</span>
          <span class="ad-d-sep">·</span>
          <span><span class="ad-d-lbl">Break</span> ${fmtTime(s.breakStart)} → ${breakEndStr}</span>
          <span class="ad-d-sep">·</span>
          <span><span class="ad-d-lbl">Salida</span> ${fmtTime(s.salidaTime)}</span>
        </div>
      </div>`;
  }).join("");
}

function renderDonut(states) {
  const counts = { trabajando: 0, break: 0, "sin-luz": 0, fuera: 0, ausencia: 0 };
  states.forEach(s => { if (counts[s.state] !== undefined) counts[s.state]++; });

  const labels = ["Trabajando", "Break", "Sin luz", "Fuera", "Ausencia"];
  const data = [counts.trabajando, counts.break, counts["sin-luz"], counts.fuera, counts.ausencia];
  const colors = [
    STATUS_META.trabajando.color,
    STATUS_META.break.color,
    STATUS_META["sin-luz"].color,
    STATUS_META.fuera.color,
    STATUS_META.ausencia.color,
  ];

  if (charts.donut) charts.donut.destroy();
  charts.donut = new Chart(document.getElementById("ad-donut"), {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11, weight: "600" }, padding: 10, boxWidth: 12 } }
      }
    }
  });
}

function renderHoursBars(hours) {
  const labels = hours.map(h => h.name);
  const data = hours.map(h => h.hoursMs / 3600000);

  if (charts.hours) charts.hours.destroy();
  charts.hours = new Chart(document.getElementById("ad-hours-bars"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Horas", data, backgroundColor: "#06a3b6", borderRadius: 6 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtHoursMinutes(ctx.parsed.x * 3600000) } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: v => v + "h" } }
      }
    }
  });
}

function renderPowerList(outages) {
  const list = document.getElementById("ad-power-list");
  if (!outages.length) {
    list.innerHTML = `<div class="ad-empty">— Sin cortes de luz en este período —</div>`;
    return;
  }
  list.innerHTML = outages.map(o => `
    <div class="ad-power-item ${o.ongoing ? "ongoing" : ""}">
      <div class="ad-power-icon"><i data-lucide="zap-off"></i></div>
      <div class="ad-power-name">${escapeHtml(o.name)}</div>
      <div class="ad-power-times">
        ${fmtDateShort(o.start)} · ${fmtTime(o.start)}
        ${o.ongoing ? `<span class="ad-ongoing">→ en curso</span>` : `→ ${fmtTime(o.end)}`}
      </div>
      <div class="ad-power-duration">${fmtHoursMinutes(o.durationMs)}</div>
    </div>
  `).join("");
}

function renderAbsenceList(absences) {
  const list = document.getElementById("ad-absence-list");
  if (!absences.length) {
    list.innerHTML = `<div class="ad-empty">— Sin ausencias reportadas en los últimos 30 días —</div>`;
    return;
  }
  list.innerHTML = absences.map(a => `
    <div class="ad-absence-item">
      <div class="ad-absence-icon"><i data-lucide="calendar-x"></i></div>
      <div class="ad-absence-name">${escapeHtml(a.name)}</div>
      <div class="ad-absence-date">
        ${a.targetDate ? fmtDateShort(a.targetDate) : fmtDateShort(a.reportedAt)}
      </div>
      <div class="ad-absence-reason">${escapeHtml(a.reason || "—")}</div>
    </div>
  `).join("");
}

