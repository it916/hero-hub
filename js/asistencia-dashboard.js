// ═══════════════════════════════════════════
// Hero Hub · Dashboard de Asistencia
// ═══════════════════════════════════════════
// Lee los registros de la colección `attendance` de Firestore (desde
// v2.18.0), agrega los datos en memoria y renderiza:
//   - 4 contadores de estado actual
//   - Lista de equipo en vivo
//   - Donut de distribución (Chart.js)
//   - Barras de horas trabajadas por persona (Chart.js)
//   - Lista de cortes de luz
//   - Lista de ausencias
//   - Modal por persona con stats detalladas
//
// Vive como tab dentro de admin.html. La verificación de rol admin
// la hace admin.js antes de invocar initAsistenciaDashboard().
//
// El motor de cálculo (computePersonStats, helpers de fecha, renders
// de charts) vive en js/attendance-stats.js y se comparte con
// mi-perfil.html.

import {
  STATUS_META,
  parseMMDDYYYY, parseEventDate,
  startOfDay, startOfWeek, startOfMonth,
  fmtTime, fmtDateShort, fmtHoursMinutes, fmtTimeOfDay,
  computePeriod, computePersonStats, computeCurrentStateByPerson,
  fetchAttendanceEvents,
  renderPersonLineChart, renderPersonDonutChart, renderPersonWeekdayBars,
} from "./attendance-stats.js";

let allEvents = [];
const charts = {};

// Por default traemos solo los ultimos 30 dias para minimizar reads a
// Firestore (free tier = 50k reads/dia). El boton "Historico completo"
// levanta este flag y hace un refetch sin filtro de fecha.
const DEFAULT_LOOKBACK_DAYS = 30;
let historyLoaded = false;

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
    const historyBtn = document.getElementById("ad-load-history");
    const periodSel = document.getElementById("ad-period");
    if (refreshBtn) refreshBtn.addEventListener("click", () => fetchAndRender({ loadHistory: historyLoaded }));
    if (historyBtn) historyBtn.addEventListener("click", () => fetchAndRender({ loadHistory: true }));
    if (periodSel) periodSel.addEventListener("change", renderAll);
    wirePersonModal();
    handlersBound = true;
  }
  await fetchAndRender({ loadHistory: false });
}

// ── Fetch & render ─────────────────────────────────────────────────
async function fetchAndRender({ loadHistory = false } = {}) {
  const loading = document.getElementById("ad-loading");
  const errorEl = document.getElementById("ad-error");
  const content = document.getElementById("ad-content");
  const historyBtn = document.getElementById("ad-load-history");
  loading.style.display = "block";
  errorEl.style.display = "none";
  content.style.display = "none";

  try {
    // Sin loadHistory: solo ultimos 30 dias (default). Con loadHistory:
    // sin filtro de fecha (trae todo, mas costoso).
    const opts = loadHistory ? {} : { from: daysAgo(DEFAULT_LOOKBACK_DAYS) };
    allEvents = await fetchAttendanceEvents(opts);
    historyLoaded = loadHistory;

    if (historyBtn) {
      historyBtn.textContent = loadHistory
        ? `Historico cargado (${allEvents.length})`
        : "Historico completo";
      historyBtn.disabled = loadHistory;
    }

    const suffix = loadHistory ? " · historico completo" : ` · ultimos ${DEFAULT_LOOKBACK_DAYS} dias`;
    document.getElementById("ad-last-update").textContent =
      "Actualizado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + suffix;

    renderAll();
    loading.style.display = "none";
    content.style.display = "block";
  } catch (e) {
    console.error("asistencia-dashboard:", e);
    loading.style.display = "none";
    errorEl.style.display = "block";
    renderErrorMessage(errorEl, e.message);
    if (window.refreshIcons) window.refreshIcons();
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderErrorMessage(container, detail) {
  container.replaceChildren();
  const iconWrap = document.createElement("div");
  iconWrap.className = "ad-error-icon";
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", "alert-triangle");
  iconWrap.appendChild(icon);
  const text = document.createElement("div");
  text.className = "ad-error-text";
  text.textContent = "No pudimos cargar los datos de asistencia.";
  const detailEl = document.createElement("div");
  detailEl.className = "ad-error-detail";
  detailEl.textContent = detail || "Verifica tu conexion y las reglas de Firestore.";
  container.appendChild(iconWrap);
  container.appendChild(text);
  container.appendChild(detailEl);
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
let fpFrom = null, fpTo = null;

function getInitials(s) {
  if (!s) return "?";
  const clean = s.includes("@") ? s.split("@")[0] : s;
  const parts = clean.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Wrapper para leer las fechas del custom range del modal admin y pasárselas a computePeriod.
function computeModalPeriod(periodVal) {
  if (periodVal !== "custom") return computePeriod(periodVal);
  return computePeriod("custom", {
    from: document.getElementById("ad-pm-from")?.value,
    to: document.getElementById("ad-pm-to")?.value,
  });
}

// Inicializa los date pickers la primera vez que se elige "custom".
// Defaults: últimos 30 días. Se restringen entre sí para evitar from > to.
function ensureCustomPickers() {
  if (fpFrom && fpTo) return;
  const fromEl = document.getElementById("ad-pm-from");
  const toEl = document.getElementById("ad-pm-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;

  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  fpFrom = flatpickr(fromEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: monthAgo,
    maxDate: today,
    onChange: ([d]) => {
      if (d && fpTo) fpTo.set("minDate", d);
      renderPersonModal();
    }
  });

  fpTo = flatpickr(toEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: today,
    maxDate: today,
    minDate: monthAgo,
    onChange: ([d]) => {
      if (d && fpFrom) fpFrom.set("maxDate", d);
      renderPersonModal();
    }
  });
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

  if (periodSel) {
    periodSel.addEventListener("change", () => {
      const wrap = document.getElementById("ad-pm-custom-range");
      const isCustom = periodSel.value === "custom";
      if (wrap) wrap.hidden = !isCustom;
      if (isCustom) ensureCustomPickers();
      renderPersonModal();
    });
  }
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

  // Reset del periodo al abrir cada vez (no recordamos selección entre personas)
  const periodSel = document.getElementById("ad-pm-period");
  if (periodSel) periodSel.value = "month";
  const customWrap = document.getElementById("ad-pm-custom-range");
  if (customWrap) customWrap.hidden = true;

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
  const { rangeStart, rangeEnd, label } = computeModalPeriod(periodVal);
  document.getElementById("ad-pm-period-label").textContent = label;

  const stats = computePersonStats(allEvents, currentPersonEmail, rangeStart, rangeEnd);

  renderPersonKPIs(stats);
  charts.pmLine  = renderPersonLineChart(document.getElementById("ad-pm-chart-line"),   charts.pmLine,  stats, rangeStart, rangeEnd);
  charts.pmDonut = renderPersonDonutChart(document.getElementById("ad-pm-chart-donut"), charts.pmDonut, stats);
  charts.pmBars  = renderPersonWeekdayBars(document.getElementById("ad-pm-chart-bars"), charts.pmBars,  stats);
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
