// ═══════════════════════════════════════════
// Hero Hub · Motor compartido de estadísticas de asistencia
// ═══════════════════════════════════════════
// Extraído de asistencia-dashboard.js para poder reutilizarlo
// también en mi-perfil.html. Contiene:
//   - Parseo de eventos de asistencia (Firestore)
//   - Cálculo de stats por persona en un rango (computePersonStats)
//   - Resolución de periodos predefinidos (computePeriod)
//   - Render de los 3 charts (línea, donut, barras) que usan tanto
//     el modal admin como la vista personal.
//
// Fuente de datos: colección `attendance` de Firestore (desde v2.18.0).
// Historia: hasta v2.17.1 leíamos de un Google Sheet vía Apps Script.

import { fetchAttendance } from "./attendance-store.js";

export const STATUS_META = {
  "trabajando":   { label: "Trabajando", color: "#10b981", icon: "check-circle-2" },
  "break":        { label: "En break",   color: "#06a3b6", icon: "coffee" },
  "fuera":        { label: "Fuera",      color: "#94a3b8", icon: "log-out" },
  "ausencia":     { label: "Ausencia",   color: "#64748b", icon: "calendar-x" },
  "sin-registro": { label: "Sin registro hoy", color: "#cbd5e1", icon: "circle" },
};

// ── Helpers de fecha/tiempo ─────────────────────────────────────
export function parseMMDDYYYY(str) {
  if (!str) return null;
  if (str instanceof Date) return new Date(str);
  const [m, d, y] = String(str).split("/");
  if (!m || !d || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

export function parseEventDate(ev) {
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

export function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

export function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Helpers de formato ──────────────────────────────────────────
export function fmtTime(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
export function fmtDateShort(d) {
  if (!d) return "—";
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
export function fmtHoursMinutes(ms) {
  if (!ms || ms <= 0) return "0h 0min";
  const total = Math.floor(ms / 60000);
  return `${Math.floor(total / 60)}h ${total % 60}min`;
}
export function fmtTimeOfDay(t) {
  if (!t) return "—";
  const h12 = ((t.hh + 11) % 12) + 1;
  const ampm = t.hh >= 12 ? "PM" : "AM";
  return `${h12}:${String(t.mm).padStart(2, '0')} ${ampm}`;
}
export function avgTimeOfDay(dates) {
  if (!dates.length) return null;
  let sumMinutes = 0;
  for (const d of dates) sumMinutes += d.getHours() * 60 + d.getMinutes();
  const avg = Math.round(sumMinutes / dates.length);
  return { hh: Math.floor(avg / 60), mm: avg % 60 };
}

// ── Resolución de periodos ──────────────────────────────────────
// Retorna { rangeStart, rangeEnd, label } dado un valor:
//   "month" | "prevMonth" | "last30" | "last90" | "all" | "custom"
// Para "custom", recibe { from, to } (objetos Date o strings MM/DD/YYYY).
export function computePeriod(periodVal, customRange = null) {
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
  } else if (periodVal === "custom") {
    const from = customRange?.from;
    const to = customRange?.to;
    rangeStart = from instanceof Date ? from : parseMMDDYYYY(from);
    rangeEnd = to instanceof Date ? to : parseMMDDYYYY(to);
    if (!rangeStart) {
      rangeStart = new Date(now);
      rangeStart.setDate(rangeStart.getDate() - 30);
    }
    if (!rangeEnd) rangeEnd = new Date(now);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);
    const fmt = d => d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    label = `${fmt(rangeStart)} – ${fmt(rangeEnd)}`;
  } else {
    rangeStart = new Date(2000, 0, 1);
    label = "Todo el historial";
  }
  if (label && periodVal !== "custom") label = label.charAt(0).toUpperCase() + label.slice(1);
  return { rangeStart, rangeEnd, label };
}

// ── Cálculo principal: stats por persona en un rango ────────────
// Agrupa por día y calcula entrada/salida/horas/breaks/cortes/ausencia.
// Cierra tramos abiertos al fin del día (o NOW si es hoy).
export function computePersonStats(events, email, rangeStart, rangeEnd) {
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
  let totalAbsences = 0, activeDays = 0;
  const entradaTimes = [], salidaTimes = [];
  const weekdayHours = [0, 0, 0, 0, 0, 0, 0];

  for (const [dayKey, { date: dayDate, events: evs }] of byDay) {
    let worked = 0, breaksCount = 0, breaksMs = 0;
    let absent = false;
    let firstEntrada = null, lastSalida = null;
    let workStart = null, breakStart = null;

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
        case "Salida":
          lastSalida = ev._date;
          if (workStart) { worked += ev._date - workStart; workStart = null; }
          break;
        case "Inicio Break":
          breakStart = ev._date;
          if (workStart) { worked += ev._date - workStart; workStart = null; }
          break;
        case "Ausencia":
          absent = true;
          break;
        // "Corte Luz *" (histórico) se ignora — descontinuado v2.24.0.
      }
    }

    const ongoing = !!workStart;
    if (workStart && cutoff > workStart) worked += cutoff - workStart;
    if (breakStart && cutoff > breakStart) {
      breaksCount++;
      breaksMs += cutoff - breakStart;
    }

    totalMs += worked;
    totalBreaks += breaksCount;
    totalBreakMs += breaksMs;
    if (absent) totalAbsences++;
    if (firstEntrada || worked > 0) activeDays++;
    if (firstEntrada) entradaTimes.push(firstEntrada);
    if (lastSalida) salidaTimes.push(lastSalida);
    weekdayHours[dayDate.getDay()] += worked;

    dailyStats.push({
      dayKey, date: dayDate,
      entrada: firstEntrada, salida: lastSalida,
      worked, breaksCount, breaksMs,
      absent, ongoing,
    });
  }

  return {
    dailyStats: dailyStats.sort((a, b) => b.date - a.date),
    totalMs, activeDays,
    avgWorkPerDay: activeDays > 0 ? totalMs / activeDays : 0,
    totalBreaks, totalBreakMs,
    avgBreakDuration: totalBreaks > 0 ? totalBreakMs / totalBreaks : 0,
    totalAbsences,
    avgEntrada: avgTimeOfDay(entradaTimes),
    avgSalida: avgTimeOfDay(salidaTimes),
    weekdayHours,
  };
}

// ── Estado actual por persona (para mostrar pill "Trabajando/Break/etc.") ──
export function computeCurrentStateByPerson(events, today) {
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
      case "Corte Luz Fin":  state = "trabajando"; break; // legacy — histórico
      case "Inicio Break":   state = "break"; break;
      case "Corte Luz Inicio": state = "trabajando"; break; // legacy — histórico se trata como si estuviera trabajando
      case "Salida":         state = "fuera"; break;
      case "Ausencia":       state = "ausencia"; break;
      default:               state = "sin-registro";
    }

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

// ── Fetch de eventos (Firestore) ─────────────────────────────────
// Delega al store; se mantiene el mismo formato de salida
// { fecha, hora, email, nombre, tipo, fechaObjetivo, motivo } para
// no tocar el resto del motor de stats.
//
// Filtros opcionales:
//   - from:  Date — solo eventos desde esa fecha
//   - to:    Date — solo eventos hasta esa fecha
//   - email: string — solo eventos de un usuario específico
//
// Sin filtros trae toda la colección. Con la colección creciendo por
// año, evita llamar sin filtros — el free tier de Firestore es 50k
// reads/día. Para el dashboard admin, usar rango. Para mi-perfil,
// filtrar por email.
export async function fetchAttendanceEvents(opts = {}) {
  return await fetchAttendance(opts);
}

// ═══════════════════════════════════════════════════════════════
// RENDER DE CHARTS (Chart.js) — reutilizables por admin y perfil
// ═══════════════════════════════════════════════════════════════

// Renderea el line chart de horas trabajadas por día en el rango.
// El caller pasa el canvas y el chart previo (si lo hay para destruirlo).
// Retorna la nueva instancia de Chart.
export function renderPersonLineChart(canvasEl, prevChart, stats, rangeStart, rangeEnd) {
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

  if (prevChart) prevChart.destroy();
  return new Chart(canvasEl, {
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
}

export function renderPersonDonutChart(canvasEl, prevChart, stats) {
  const donutData = [
    stats.totalMs / 3600000,
    stats.totalBreakMs / 3600000,
  ];
  if (prevChart) prevChart.destroy();
  return new Chart(canvasEl, {
    type: "doughnut",
    data: {
      labels: ["Trabajado", "Break"],
      datasets: [{
        data: donutData,
        backgroundColor: [STATUS_META.trabajando.color, STATUS_META.break.color],
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
}

export function renderPersonWeekdayBars(canvasEl, prevChart, stats) {
  const weekdayLabels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const weekdayData = stats.weekdayHours.map(ms => ms / 3600000);
  if (prevChart) prevChart.destroy();
  return new Chart(canvasEl, {
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
