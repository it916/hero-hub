// ═══════════════════════════════════════════
// Hero Hub · Próxima Reunión (topbar widget)
// ═══════════════════════════════════════════
// Carga la próxima reunión del calendario primario de IT
// vía Apps Script y muestra un countdown en el topbar.
//
// Refresca el JSON cada 5 minutos.
// Refresca el countdown cada 30 segundos.

const CONFIG = {
  // ⚠️ REEMPLAZA con la URL del Apps Script desplegado
  endpoint: "https://script.google.com/macros/s/AKfycbxdYvkWspugcgHpG5TmjyQYk-ShVCXp4x_hxZqc9lztNUBNLGthnODMxCJ9epjiHLI9VA/exec",
  refreshIntervalMs: 5 * 60 * 1000,    // 5 minutos
  countdownIntervalMs: 30 * 1000        // 30 segundos
};

let nextMeeting = null;
let countdownTimer = null;

function el(id) { return document.getElementById(id); }

function pad2(n) { return String(n).padStart(2, "0"); }

function formatCountdown(targetISO) {
  if (!targetISO) return "—";
  const diff = new Date(targetISO).getTime() - Date.now();

  // Reunión en curso (empezó hace < 5 min)
  if (diff <= 0 && diff > -5 * 60 * 1000) return "¡Es ahora!";
  if (diff <= 0) return "Terminada";

  const hours = Math.floor(diff / (60 * 60 * 1000));
  const mins  = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `En ${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `En ${hours}h ${pad2(mins)}m`;
  if (mins > 0)  return `En ${mins} min`;
  return "En menos de 1 min";
}

function formatTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

function renderEmpty() {
  const widget = el("next-meeting");
  if (!widget) return;
  widget.classList.add("nm-empty");
  widget.classList.remove("nm-live");
  widget.innerHTML = `
    <div class="nm-icon"><i data-lucide="calendar-x"></i></div>
    <div class="nm-body">
      <div class="nm-label">Sin reuniones</div>
      <div class="nm-title">próximas 7 días</div>
    </div>
  `;
  if (window.refreshIcons) window.refreshIcons();
}

function renderError() {
  const widget = el("next-meeting");
  if (!widget) return;
  widget.classList.add("nm-empty");
  widget.classList.remove("nm-live");
  widget.innerHTML = `
    <div class="nm-icon"><i data-lucide="calendar"></i></div>
    <div class="nm-body">
      <div class="nm-label">Calendario</div>
      <div class="nm-title">No disponible</div>
    </div>
  `;
  if (window.refreshIcons) window.refreshIcons();
}

function renderMeeting(data) {
  const widget = el("next-meeting");
  if (!widget) return;

  const isLive = (() => {
    const diff = new Date(data.startISO).getTime() - Date.now();
    return diff <= 0 && diff > -5 * 60 * 1000;
  })();

  widget.classList.remove("nm-empty");
  widget.classList.toggle("nm-live", isLive);

  const countdown = formatCountdown(data.startISO);
  const timeStr = formatTime(data.startISO);

  // Truncar título si es muy largo (>30 chars)
  const title = data.title.length > 30
    ? data.title.substring(0, 28) + "…"
    : data.title;

  // Si tiene enlace Meet, hacer clickeable
  const clickable = data.meetUrl
    ? `style="cursor:pointer;" data-meet="${data.meetUrl}" title="Click para unirse"`
    : `title="${escapeAttr(data.title)} · ${timeStr}"`;

  widget.innerHTML = `
    <div class="nm-icon" ${clickable}>
      <i data-lucide="${isLive ? 'radio' : 'calendar-clock'}"></i>
    </div>
    <div class="nm-body" ${clickable}>
      <div class="nm-label">${countdown}</div>
      <div class="nm-title">${escapeHtml(title)}</div>
    </div>
  `;

  // Wire click si hay Meet URL
  if (data.meetUrl) {
    widget.querySelectorAll("[data-meet]").forEach(elx => {
      elx.addEventListener("click", () => window.open(data.meetUrl, "_blank", "noopener"));
    });
  }

  if (window.refreshIcons) window.refreshIcons();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str || "");
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}

async function fetchNextMeeting() {
  if (CONFIG.endpoint.includes("PEGAR_AQUI_TU_URL")) {
    console.warn("next-meeting.js: endpoint no configurado");
    renderError();
    return;
  }

  try {
    const res = await fetch(CONFIG.endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    if (!data.found) {
      nextMeeting = null;
      renderEmpty();
      return;
    }

    nextMeeting = data;
    renderMeeting(data);
    startCountdown();

  } catch (e) {
    console.warn("Próxima reunión no disponible:", e.message);
    renderError();
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (nextMeeting) renderMeeting(nextMeeting);
  }, CONFIG.countdownIntervalMs);
}

// Inicialización: esperar al render del topbar
document.addEventListener("DOMContentLoaded", () => {
  fetchNextMeeting();
  setInterval(fetchNextMeeting, CONFIG.refreshIntervalMs);
});
