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
    wirePersonModal();
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
      <div class="ad-team-row" data-state="${s.state}" data-email="${escapeHtml(s.email)}" data-name="${escapeHtml(s.name)}" role="button" tabindex="0" title="Ver estadísticas detalladas">
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

  // Delegación de clic (se wirea una sola vez por instancia del listado)
  if (!list._clickWired) {
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".ad-team-row");
      if (!row) return;
      const email = row.dataset.email;
      const name = row.dataset.name;
      if (email) openPersonModal(email, name);
    });
    list._clickWired = true;
  }
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

// ═══════════════════════════════════════════════════════════════════
// MODAL DE PERSONA · Estadísticas detalladas
// ═══════════════════════════════════════════════════════════════════

let currentPersonEmail = null;
let currentPersonName = null;
let modalEscapeHandler = null;

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getInitials(s) {
  if (!s) return "?";
  const clean = s.includes("@") ? s.split("@")[0] : s;
  const parts = clean.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtTimeOfDay(t) {
  if (!t) return "—";
  const h12 = ((t.hh + 11) % 12) + 1;
  const ampm = t.hh >= 12 ? "PM" : "AM";
  return `${h12}:${String(t.mm).padStart(2, '0')} ${ampm}`;
}

function avgTimeOfDay(dates) {
  if (!dates.length) return null;
  let sumMinutes = 0;
  for (const d of dates) sumMinutes += d.getHours() * 60 + d.getMinutes();
  const avg = Math.round(sumMinutes / dates.length);
  return { hh: Math.floor(avg / 60), mm: avg % 60 };
}

function computePeriod(periodVal) {
  const now = new Date();
  let rangeStart, rangeEnd = now, label;
  if (periodVal === "month") {
    rangeStart = startOfMonth(now);
    label = now.toLocaleDateString("es", { month: "long", year: "numeric" });
  } else if (periodVal === "prevMonth") {
    rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    label = rangeStart.toLocaleDateString("es", { month: "long", year: "numeric" });
  } else if (periodVal === "last30") {
    rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 30);
    rangeStart.setHours(0, 0, 0, 0);
    label = "Últimos 30 días";
  } else if (periodVal === "last90") {
    rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 90);
    rangeStart.setHours(0, 0, 0, 0);
    label = "Últimos 90 días";
  } else {
    rangeStart = new Date(2000, 0, 1);
    label = "Todo el historial";
  }
  if (label) label = label.charAt(0).toUpperCase() + label.slice(1);
  return { rangeStart, rangeEnd, label };
}

// Stats por persona en un rango. Agrupa por día y calcula entrada/salida/horas/
// breaks/cortes/ausencia. Cierra tramos abiertos al fin del día (o NOW si es hoy).
function computePersonStats(events, email, rangeStart, rangeEnd) {
  const now = new Date();

  const personEvents = events
    .filter(e => e.email === email)
    .map(e => ({ ...e, _date: parseEventDate(e) }))
    .filter(e => e._date && e._date >= rangeStart && e._date <= rangeEnd)
    .sort((a, b) => a._date - b._date);

  const byDay = new Map();
  for (const e of personEvents) {
    const dayKey = ymdLocal(e._date);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { date: startOfDay(e._date), events: [] });
    }
    byDay.get(dayKey).events.push(e);
  }

  const dailyStats = [];
  let totalMs = 0, totalBreaks = 0, totalBreakMs = 0;
  let totalOutages = 0, totalOutageMs = 0;
  let totalAbsences = 0, activeDays = 0;
  const entradaTimes = [], salidaTimes = [];
  const weekdayHours = [0, 0, 0, 0, 0, 0, 0];

  for (const [dayKey, { date: dayDate, events: evs }] of byDay) {
    let worked = 0, breaksCount = 0, breaksMs = 0;
    let outages = 0, outagesMs = 0, absent = false;
    let firstEntrada = null, lastSalida = null;
    let workStart = null, breakStart = null, outageStart = null;

    const dayEnd = new Date(dayDate);
    dayEnd.setHours(23, 59, 59, 999);
    const cutoff = dayEnd < now ? dayEnd : now;

    for (const ev of evs) {
      switch (ev.tipo) {
        case "Entrada":
          if (!firstEntrada) firstEntrada = ev._date;
          workStart = ev._date;
          break;
        case "Fin Break":
          if (breakStart) {
            breaksCount++;
            breaksMs += ev._date - breakStart;
            breakStart = null;
          }
          workStart = ev._date;
          break;
        case "Corte Luz Fin":
          if (outageStart) {
            outages++;
            outagesMs += ev._date - outageStart;
            outageStart = null;
          }
          workStart = ev._date;
          break;
        case "Salida":
          lastSalida = ev._date;
          if (workStart) { worked += ev._date - workStart; workStart = null; }
          break;
        case "Inicio Break":
          breakStart = ev._date;
          if (workStart) { worked += ev._date - workStart; workStart = null; }
          break;
        case "Corte Luz Inicio":
          outageStart = ev._date;
          if (workStart) { worked += ev._date - workStart; workStart = null; }
          break;
        case "Ausencia":
          absent = true;
          break;
      }
    }

    const ongoing = !!workStart;
    if (workStart && cutoff > workStart) worked += cutoff - workStart;
    if (breakStart && cutoff > breakStart) {
      breaksCount++;
      breaksMs += cutoff - breakStart;
    }
    if (outageStart && cutoff > outageStart) {
      outages++;
      outagesMs += cutoff - outageStart;
    }

    totalMs += worked;
    totalBreaks += breaksCount;
    totalBreakMs += breaksMs;
    totalOutages += outages;
    totalOutageMs += outagesMs;
    if (absent) totalAbsences++;
    if (firstEntrada || worked > 0) activeDays++;
    if (firstEntrada) entradaTimes.push(firstEntrada);
    if (lastSalida) salidaTimes.push(lastSalida);
    weekdayHours[dayDate.getDay()] += worked;

    dailyStats.push({
      dayKey, date: dayDate,
      entrada: firstEntrada, salida: lastSalida,
      worked, breaksCount, breaksMs,
      outages, outagesMs, absent, ongoing,
    });
  }

  return {
    dailyStats: dailyStats.sort((a, b) => b.date - a.date),
    totalMs, activeDays,
    avgWorkPerDay: activeDays > 0 ? totalMs / activeDays : 0,
    totalBreaks, totalBreakMs,
    avgBreakDuration: totalBreaks > 0 ? totalBreakMs / totalBreaks : 0,
    totalOutages, totalOutageMs, totalAbsences,
    avgEntrada: avgTimeOfDay(entradaTimes),
    avgSalida: avgTimeOfDay(salidaTimes),
    weekdayHours,
  };
}

function wirePersonModal() {
  const overlay = document.getElementById("ad-person-modal");
  const closeBtn = document.getElementById("ad-pm-close");
  const periodSel = document.getElementById("ad-pm-period");
  if (!overlay || !closeBtn) return;

  closeBtn.addEventListener("click", closePersonModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePersonModal();
  });
  if (periodSel) periodSel.addEventListener("change", renderPersonModal);
}

function openPersonModal(email, name) {
  currentPersonEmail = email;
  currentPersonName = name;

  const overlay = document.getElementById("ad-person-modal");
  if (!overlay) return;

  document.getElementById("ad-pm-name").textContent = name || email;
  document.getElementById("ad-pm-email").textContent = email;
  document.getElementById("ad-pm-avatar").textContent = getInitials(name || email);

  const states = computeCurrentStateByPerson(allEvents, new Date());
  const myState = states.find(s => s.email === email);
  const nowEl = document.getElementById("ad-pm-now");
  if (myState) {
    const meta = STATUS_META[myState.state] || STATUS_META["sin-registro"];
    nowEl.textContent = `${meta.label} · desde ${fmtTime(myState.lastTime)}`;
    nowEl.style.background = meta.color + "22";
    nowEl.style.color = meta.color;
  } else {
    nowEl.textContent = "Sin registro hoy";
    nowEl.style.background = "";
    nowEl.style.color = "";
  }

  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  document.body.style.overflow = "hidden";

  modalEscapeHandler = (e) => { if (e.key === "Escape") closePersonModal(); };
  document.addEventListener("keydown", modalEscapeHandler);

  renderPersonModal();
}

function closePersonModal() {
  const overlay = document.getElementById("ad-person-modal");
  if (!overlay) return;
  overlay.classList.remove("is-open");
  setTimeout(() => { overlay.style.display = "none"; }, 220);
  document.body.style.overflow = "";

  if (modalEscapeHandler) {
    document.removeEventListener("keydown", modalEscapeHandler);
    modalEscapeHandler = null;
  }

  ["pmLine", "pmDonut", "pmBars"].forEach(k => {
    if (charts[k]) { charts[k].destroy(); delete charts[k]; }
  });

  currentPersonEmail = null;
  currentPersonName = null;
}

function renderPersonModal() {
  if (!currentPersonEmail) return;
  const periodVal = document.getElementById("ad-pm-period").value;
  const { rangeStart, rangeEnd, label } = computePeriod(periodVal);
  document.getElementById("ad-pm-period-label").textContent = label;

  const stats = computePersonStats(allEvents, currentPersonEmail, rangeStart, rangeEnd);

  renderPersonKPIs(stats);
  renderPersonCharts(stats, rangeStart, rangeEnd);
  renderPersonTable(stats);

  if (window.refreshIcons) window.refreshIcons();
}

function renderPersonKPIs(stats) {
  const items = [
    { label: "Trabajado", value: fmtHoursMinutes(stats.totalMs) },
    { label: "Días activos", value: stats.activeDays },
    { label: "Prom/día", value: fmtHoursMinutes(stats.avgWorkPerDay) },
    { label: "Breaks", value: stats.totalBreaks },
    { label: "Brk-prom", value: fmtHoursMinutes(stats.avgBreakDuration) },
    { label: "Cortes luz", value: stats.totalOutages },
    { label: "Ausencias", value: stats.totalAbsences },
    { label: "Entrada prom", value: fmtTimeOfDay(stats.avgEntrada) },
  ];
  document.getElementById("ad-pm-kpis").innerHTML = items.map(k => `
    <div class="ad-pm-kpi">
      <div class="ad-pm-kpi-value">${escapeHtml(String(k.value))}</div>
      <div class="ad-pm-kpi-label">${escapeHtml(k.label)}</div>
    </div>
  `).join("");
}

function renderPersonCharts(stats, rangeStart, rangeEnd) {
  // Línea: horas trabajadas por día (cap 92 puntos)
  const dayMap = new Map(stats.dailyStats.map(d => [d.dayKey, d.worked]));
  const cur = new Date(rangeStart); cur.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd); end.setHours(0, 0, 0, 0);
  const MAX_POINTS = 92;
  const totalDays = Math.floor((end - cur) / 86400000) + 1;
  if (totalDays > MAX_POINTS) {
    cur.setTime(end.getTime() - (MAX_POINTS - 1) * 86400000);
  }
  const dates = [], series = [];
  while (cur <= end) {
    dates.push(new Date(cur));
    series.push((dayMap.get(ymdLocal(cur)) || 0) / 3600000);
    cur.setDate(cur.getDate() + 1);
  }
  const labels = dates.map(d => d.toLocaleDateString("es", { day: "numeric", month: "short" }));

  if (charts.pmLine) charts.pmLine.destroy();
  charts.pmLine = new Chart(document.getElementById("ad-pm-chart-line"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Horas",
        data: series,
        borderColor: "#06a3b6",
        backgroundColor: "rgba(6,163,182,.18)",
        fill: true,
        tension: 0.35,
        pointRadius: series.length > 40 ? 0 : 3,
        pointHoverRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtHoursMinutes(ctx.parsed.y * 3600000) } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v + "h" } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
      }
    }
  });

  // Donut: distribución de tiempo
  const donutData = [
    stats.totalMs / 3600000,
    stats.totalBreakMs / 3600000,
    stats.totalOutageMs / 3600000,
  ];
  if (charts.pmDonut) charts.pmDonut.destroy();
  charts.pmDonut = new Chart(document.getElementById("ad-pm-chart-donut"), {
    type: "doughnut",
    data: {
      labels: ["Trabajado", "Break", "Sin luz"],
      datasets: [{
        data: donutData,
        backgroundColor: [STATUS_META.trabajando.color, STATUS_META.break.color, STATUS_META["sin-luz"].color],
        borderWidth: 2,
        borderColor: "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11, weight: "600" }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtHoursMinutes(ctx.parsed * 3600000)}` } }
      }
    }
  });

  // Barras: horas por día de semana
  const weekdayLabels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const weekdayData = stats.weekdayHours.map(ms => ms / 3600000);
  if (charts.pmBars) charts.pmBars.destroy();
  charts.pmBars = new Chart(document.getElementById("ad-pm-chart-bars"), {
    type: "bar",
    data: {
      labels: weekdayLabels,
      datasets: [{ label: "Horas", data: weekdayData, backgroundColor: "#06a3b6", borderRadius: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtHoursMinutes(ctx.parsed.y * 3600000) } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => v + "h" } } }
    }
  });
}

function renderPersonTable(stats) {
  const tbody = document.getElementById("ad-pm-detail-tbody");
  if (!stats.dailyStats.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="cell-dim" style="text-align:center;padding:24px;">Sin registros en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = stats.dailyStats.map(d => {
    const dateStr = d.date.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const dim = `<span class="cell-dim">—</span>`;
    const breaksCell = d.breaksCount ? `${d.breaksCount} (${fmtHoursMinutes(d.breaksMs)})` : dim;
    const outagesCell = d.outages ? `${d.outages} (${fmtHoursMinutes(d.outagesMs)})` : dim;
    const absentCell = d.absent ? `<span class="cell-absent">Sí</span>` : dim;
    let workedCell = dim;
    if (d.worked > 0) {
      workedCell = d.ongoing
        ? `<span class="cell-ongoing">${fmtHoursMinutes(d.worked)} (en curso)</span>`
        : fmtHoursMinutes(d.worked);
    }
    return `<tr>
      <td class="cell-date">${dateStr}</td>
      <td>${d.entrada ? fmtTime(d.entrada) : dim}</td>
      <td>${d.salida ? fmtTime(d.salida) : dim}</td>
      <td>${workedCell}</td>
      <td>${breaksCell}</td>
      <td>${outagesCell}</td>
      <td>${absentCell}</td>
    </tr>`;
  }).join("");
}
