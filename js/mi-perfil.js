// ═══════════════════════════════════════════
// Hero Hub · Mi perfil
// ═══════════════════════════════════════════
// Página personal del usuario logueado. Muestra:
//   - Hero header con foto, nombre, cargo, rol y email.
//   - Información personal (teléfono, país, cumpleaños, tema).
//   - Actividad reciente (desde audit-log en Firestore).
//   - Mi asistencia: sección amplia con selector de periodo, 8 KPIs,
//     3 gráficos y tabla detalle. Reusa js/attendance-stats.js.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { guardPage, filterTopbarByRole } from "./roles.js";
import { getFreshGooglePhotoURL, getGooglePhotoURL } from "./user-photo.js";
import { ACTION_LABELS } from "./audit-log.js";
import { getUserByEmail, countryLabel, countryFlagUrl } from "./user-store.js";
import {
  fetchAttendanceEvents,
  computePersonStats, computePeriod,
  fmtTime, fmtHoursMinutes, fmtTimeOfDay,
  renderPersonLineChart, renderPersonDonutChart, renderPersonWeekdayBars,
} from "./attendance-stats.js";

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ── Helpers de fecha ─────────────────────────────────────────────

function parseBirthdate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let month, day;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { month = parseInt(m[2], 10); day = parseInt(m[3], 10); }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{2,4}$/))) {
    month = parseInt(m[2], 10); day = parseInt(m[1], 10);
  }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/))) {
    month = parseInt(m[1], 10); day = parseInt(m[2], 10);
  }
  return (month && day) ? { month, day } : null;
}

function formatBirthday({ month, day }) {
  const name = MONTHS_ES[month - 1];
  return `${day} de ${name}`;
}

function daysUntilBirthday({ month, day }) {
  const now = new Date();
  const year = now.getFullYear();
  let target = new Date(year, month - 1, day);
  if (target < startOfDay(now)) target = new Date(year + 1, month - 1, day);
  return Math.ceil((target - now) / (24 * 60 * 60 * 1000));
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

function relativeTime(date) {
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `hace ${weeks} semana${weeks > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

// ── Bootstrap ─────────────────────────────────────────────────────

let currentUser = null;
let currentPerson = null;   // doc de users/{email} — nueva fuente de verdad
let allEvents = [];
const attCharts = {};
let fpFrom = null, fpTo = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;

  const guard = await guardPage(user);
  if (!guard) return;
  const { userRole } = guard;

  document.body.classList.add(`role-${userRole.role}`);
  try { localStorage.setItem("hero-user-role", userRole.role); } catch (_) {}
  filterTopbarByRole(userRole);

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.body.classList.remove("skip-loading");

  // Foto del topbar
  const freshPhoto = await getFreshGooglePhotoURL(user);
  const avatarEl = document.getElementById("user-avatar");
  if (avatarEl) avatarEl.src = freshPhoto;
  const menuAvatarEl = document.getElementById("user-menu-avatar");
  if (menuAvatarEl) menuAvatarEl.src = freshPhoto;

  // Cargar todos los datos
  await Promise.all([
    loadPersonDoc(),
    loadActivity(),
    loadAttendance(),
  ]);

  wireAttendanceToolbar();

  // Handler de cerrar sesión (para el #btn-logout oculto que el dropdown dispara)
  document.getElementById("btn-logout")?.addEventListener("click", () =>
    signOut(auth).then(() => location.href = "index.html")
  );

  if (window.refreshIcons) window.refreshIcons();
});

// ── Carga del doc users/{email} ────────────────────────────────

async function loadPersonDoc() {
  try {
    currentPerson = await getUserByEmail(currentUser.email);
  } catch (e) {
    console.error("[mi-perfil] Error cargando users/{email}:", e);
  }
  renderHero();
  renderInfo();
}

function renderHero() {
  const user = currentUser;
  const name = currentPerson?.identity?.name || user.displayName || user.email.split("@")[0];
  const cargo = currentPerson?.display?.jobTitle || "";
  // getGooglePhotoURL prioriza providerData (fresh) sobre user.photoURL (stale cache).
  // El reload() ya lo hizo getFreshGooglePhotoURL en el bootstrap, así que aquí sync está OK.
  const photo = getGooglePhotoURL(user) || currentPerson?.identity?.photo || "";

  document.getElementById("mp-name").textContent = name;
  document.getElementById("mp-cargo").textContent = cargo || "—";
  document.getElementById("mp-email").textContent = user.email;
  if (photo) document.getElementById("mp-photo").src = photo;
  document.title = `${name} — Mi perfil`;

  const roleClass = [...document.body.classList].find(c => c.startsWith("role-"));
  if (roleClass) {
    const badge = document.getElementById("mp-badge");
    badge.textContent = roleClass.replace("role-", "").toUpperCase();
    badge.hidden = false;
  }
}

function renderInfo() {
  const identity = currentPerson?.identity || {};
  const phonesArr = Array.isArray(identity.phones) ? identity.phones.filter(Boolean) : [];
  const phone = phonesArr.join(", ");
  const countryIso = identity.country || "";
  const countryName = countryLabel(countryIso);
  const flagUrl = countryIso ? countryFlagUrl(countryIso) : null;
  const bd = parseBirthdate(identity.birthdate);

  const phoneEl = document.getElementById("mp-phone");
  phoneEl.textContent = phone || "—";
  if (!phone) phoneEl.classList.add("mp-empty");

  const countryEl = document.getElementById("mp-country");
  countryEl.replaceChildren();
  if (countryName) {
    if (flagUrl) {
      const img = document.createElement("img");
      img.src = flagUrl;
      img.alt = "";
      img.className = "mp-flag";
      countryEl.appendChild(img);
    }
    countryEl.appendChild(document.createTextNode(countryName));
  } else {
    countryEl.textContent = "—";
    countryEl.classList.add("mp-empty");
  }

  const bdEl = document.getElementById("mp-birthday");
  const bdInEl = document.getElementById("mp-birthday-in");
  if (bd) {
    bdEl.textContent = formatBirthday(bd);
    const days = daysUntilBirthday(bd);
    if (days === 0) bdInEl.textContent = "· ¡hoy!";
    else if (days === 1) bdInEl.textContent = "· mañana";
    else bdInEl.textContent = `· en ${days} días`;
    bdInEl.hidden = false;
  } else {
    bdEl.textContent = "—";
    bdEl.classList.add("mp-empty");
    bdInEl.hidden = true;
  }

  const themeEl = document.getElementById("mp-theme");
  themeEl.textContent = document.body.dataset.theme === "dark" ? "Noche" : "Día";
}

// ── Mi asistencia (vista amplia) ─────────────────────────────

async function loadAttendance() {
  const loading = document.getElementById("mp-att-loading");
  const errorEl = document.getElementById("mp-att-error");
  const content = document.getElementById("mp-att-content");

  loading.hidden = false;
  errorEl.hidden = true;
  content.hidden = true;

  try {
    // Trae solo los eventos del usuario actual — evita bajar toda la coleccion.
    // El filtro por rango se sigue haciendo client-side sobre estos eventos.
    allEvents = await fetchAttendanceEvents({ email: currentUser.email });
    loading.hidden = true;
    content.hidden = false;
    renderAttendance();
  } catch (e) {
    console.error("[mi-perfil] Error cargando asistencia:", e);
    loading.hidden = true;
    errorEl.hidden = false;
    document.getElementById("mp-att-error-detail").textContent = e.message || "";
    if (window.refreshIcons) window.refreshIcons();
  }
}

function wireAttendanceToolbar() {
  const periodSel = document.getElementById("mp-att-period");
  if (!periodSel) return;
  periodSel.addEventListener("change", () => {
    const wrap = document.getElementById("mp-att-custom-range");
    const isCustom = periodSel.value === "custom";
    if (wrap) wrap.hidden = !isCustom;
    if (isCustom) ensureCustomPickers();
    renderAttendance();
  });
}

// Inicializa flatpickr la primera vez que se elige "custom".
function ensureCustomPickers() {
  if (fpFrom && fpTo) return;
  const fromEl = document.getElementById("mp-att-from");
  const toEl = document.getElementById("mp-att-to");
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
      renderAttendance();
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
      renderAttendance();
    }
  });
}

function renderAttendance() {
  const periodVal = document.getElementById("mp-att-period").value;
  const custom = periodVal === "custom"
    ? { from: document.getElementById("mp-att-from")?.value, to: document.getElementById("mp-att-to")?.value }
    : null;
  const { rangeStart, rangeEnd, label } = computePeriod(periodVal, custom);
  document.getElementById("mp-att-period-label").textContent = label;

  // El email del user en el Sheet respeta may/min como llegó desde Google Auth.
  // Buscamos primero exacto; si no aparece, probamos case-insensitive.
  const emailLower = currentUser.email.toLowerCase();
  let matchEmail = currentUser.email;
  if (!allEvents.some(e => e.email === matchEmail)) {
    const hit = allEvents.find(e => e.email && String(e.email).toLowerCase() === emailLower);
    if (hit) matchEmail = hit.email;
  }

  const stats = computePersonStats(allEvents, matchEmail, rangeStart, rangeEnd);

  renderAttendanceKPIs(stats);
  attCharts.line  = renderPersonLineChart(document.getElementById("mp-att-chart-line"),   attCharts.line,  stats, rangeStart, rangeEnd);
  attCharts.donut = renderPersonDonutChart(document.getElementById("mp-att-chart-donut"), attCharts.donut, stats);
  attCharts.bars  = renderPersonWeekdayBars(document.getElementById("mp-att-chart-bars"), attCharts.bars,  stats);
  renderAttendanceTable(stats);

  if (window.refreshIcons) window.refreshIcons();
}

function renderAttendanceKPIs(stats) {
  const items = [
    { label: "Trabajado",     value: fmtHoursMinutes(stats.totalMs) },
    { label: "Días activos",  value: stats.activeDays },
    { label: "Prom/día",      value: fmtHoursMinutes(stats.avgWorkPerDay) },
    { label: "Breaks",        value: stats.totalBreaks },
    { label: "Brk-prom",      value: fmtHoursMinutes(stats.avgBreakDuration) },
    { label: "Cortes luz",    value: stats.totalOutages },
    { label: "Ausencias",     value: stats.totalAbsences },
    { label: "Entrada prom",  value: fmtTimeOfDay(stats.avgEntrada) },
  ];
  document.getElementById("mp-att-kpis").innerHTML = items.map(k => `
    <div class="mp-att-kpi">
      <div class="mp-att-kpi-value">${escapeHtml(String(k.value))}</div>
      <div class="mp-att-kpi-label">${escapeHtml(k.label)}</div>
    </div>
  `).join("");
}

function renderAttendanceTable(stats) {
  const tbody = document.getElementById("mp-att-detail-tbody");
  if (!stats.dailyStats.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="mp-att-cell-dim" style="text-align:center;padding:24px;">Sin registros en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = stats.dailyStats.map(d => {
    const dateStr = d.date.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const dim = `<span class="mp-att-cell-dim">—</span>`;
    const breaksCell = d.breaksCount ? `${d.breaksCount} (${fmtHoursMinutes(d.breaksMs)})` : dim;
    const outagesCell = d.outages ? `${d.outages} (${fmtHoursMinutes(d.outagesMs)})` : dim;
    const absentCell = d.absent ? `<span class="mp-att-cell-absent">Sí</span>` : dim;
    let workedCell = dim;
    if (d.worked > 0) {
      workedCell = d.ongoing
        ? `<span class="mp-att-cell-ongoing">${fmtHoursMinutes(d.worked)} (en curso)</span>`
        : fmtHoursMinutes(d.worked);
    }
    return `<tr>
      <td class="mp-att-cell-date">${dateStr}</td>
      <td>${d.entrada ? fmtTime(d.entrada) : dim}</td>
      <td>${d.salida ? fmtTime(d.salida) : dim}</td>
      <td>${workedCell}</td>
      <td>${breaksCell}</td>
      <td>${outagesCell}</td>
      <td>${absentCell}</td>
    </tr>`;
  }).join("");
}

// ── Actividad reciente (audit-log) ─────────────────────────────

async function loadActivity() {
  const container = document.getElementById("mp-activity");
  try {
    const q = query(
      collection(db, "audit-log"),
      where("actor", "==", currentUser.email),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      container.innerHTML = `<p class="mp-empty">Aún no hay actividad registrada.</p>`;
      return;
    }
    const rows = [];
    snap.forEach(docSnap => {
      const ev = docSnap.data();
      const meta = ACTION_LABELS[ev.action] || { label: ev.action, icon: "circle", color: "#94a3b8" };
      const when = ev.timestamp?.toDate ? ev.timestamp.toDate() : new Date();
      const target = ev.target ? ` · ${escapeHtml(ev.target)}` : "";
      rows.push(`
        <div class="mp-activity-row">
          <div class="mp-activity-icon" style="background:${meta.color}1a;color:${meta.color};">
            <i data-lucide="${meta.icon}"></i>
          </div>
          <div class="mp-activity-body">
            <div class="mp-activity-label">${escapeHtml(meta.label)}${target}</div>
            <div class="mp-activity-time">${relativeTime(when)}</div>
          </div>
        </div>
      `);
    });
    container.innerHTML = rows.join("");

    // Mostrar link "Ver todo" solo para admins.
    if (document.body.classList.contains("role-admin")) {
      document.getElementById("mp-activity-more").hidden = false;
    }
    if (window.refreshIcons) window.refreshIcons();
  } catch (e) {
    console.error("[mi-perfil] Error cargando audit-log:", e);
    container.innerHTML = `<p class="mp-empty">No se pudo cargar la actividad.</p>`;
  }
}
