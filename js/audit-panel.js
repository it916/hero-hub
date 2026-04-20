// ═══════════════════════════════════════════
// Hero Hub · Panel de Auditoría (admin)
// ═══════════════════════════════════════════
// UI para consultar el audit-log desde admin.html.
// Se carga al hacer click en el tab "Log".

import { fetchRecentEvents, cleanupOldEvents, ACTION_LABELS } from "./audit-log.js";

let allEvents = [];
let filter = { text: "", action: "all", days: 30 };

// ═══════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════

export async function initAuditPanel() {
  await loadEvents();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
}

async function loadEvents() {
  const body = document.getElementById("al-list");
  if (body) body.innerHTML = `<div class="al-empty loading">Cargando eventos...</div>`;

  allEvents = await fetchRecentEvents(300);
  renderStats();
  renderList();
}

// ═══════════════════════════════════════════
// FILTRADO
// ═══════════════════════════════════════════

function getFilteredEvents() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - filter.days * 24 * 60 * 60 * 1000);

  return allEvents.filter(ev => {
    // Rango de fechas
    if (ev.timestamp < cutoff) return false;

    // Tipo de acción
    if (filter.action !== "all" && ev.action !== filter.action) return false;

    // Búsqueda de texto (actor, target, action)
    if (filter.text) {
      const haystack = `${ev.actor} ${ev.actorName} ${ev.target} ${ev.action} ${JSON.stringify(ev.details || {})}`.toLowerCase();
      if (!haystack.includes(filter.text)) return false;
    }

    return true;
  });
}

// ═══════════════════════════════════════════
// RENDERIZADO
// ═══════════════════════════════════════════

function renderStats() {
  const filtered = getFilteredEvents();
  const total = filtered.length;

  // Contar por tipo de acción (top 3)
  const counts = {};
  filtered.forEach(ev => {
    counts[ev.action] = (counts[ev.action] || 0) + 1;
  });

  // Actores únicos
  const uniqueActors = new Set(filtered.map(ev => ev.actor)).size;

  document.getElementById("al-stat-total").textContent = total;
  document.getElementById("al-stat-actors").textContent = uniqueActors;

  // Acción más frecuente
  const topAction = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (topAction) {
    const label = ACTION_LABELS[topAction[0]]?.label || topAction[0];
    document.getElementById("al-stat-top").textContent = label;
    document.getElementById("al-stat-top-count").textContent = `${topAction[1]} veces`;
  } else {
    document.getElementById("al-stat-top").textContent = "—";
    document.getElementById("al-stat-top-count").textContent = "—";
  }
}

function renderList() {
  const body = document.getElementById("al-list");
  if (!body) return;

  const filtered = getFilteredEvents();

  if (!filtered.length) {
    body.innerHTML = `<div class="al-empty">
      ${filter.text || filter.action !== "all"
        ? "Sin eventos con esos filtros."
        : "No hay eventos registrados en este rango de fechas."}
    </div>`;
    return;
  }

  body.innerHTML = filtered.map(ev => {
    const meta = ACTION_LABELS[ev.action] || {
      label: ev.action,
      icon: "circle",
      color: "#5a6b7a"
    };
    const when = formatRelativeDate(ev.timestamp);
    const whenFull = ev.timestamp.toLocaleString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
    const actorShort = ev.actor.split("@")[0];
    const detailsText = formatDetails(ev.action, ev.details);

    return `
      <div class="al-event">
        <div class="al-event-icon" style="background:${meta.color}15; color:${meta.color};">
          <i data-lucide="${meta.icon}"></i>
        </div>
        <div class="al-event-body">
          <div class="al-event-line">
            <span class="al-event-action">${meta.label}</span>
            ${ev.target ? `<span class="al-event-target">${escapeHtml(ev.target)}</span>` : ""}
          </div>
          ${detailsText ? `<div class="al-event-details">${detailsText}</div>` : ""}
          <div class="al-event-footer">
            <span class="al-event-actor">por ${escapeHtml(ev.actorName || actorShort)}</span>
            <span class="al-event-time" title="${whenFull}">${when}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (window.refreshIcons) window.refreshIcons();
}

/**
 * Formatea los "details" de un evento en un string amigable.
 */
function formatDetails(action, details) {
  if (!details || Object.keys(details).length === 0) return "";

  // Casos especiales por tipo de acción
  if (action === "role.update" && details.from && details.to) {
    return `Cambio: <strong>${escapeHtml(details.from)}</strong> → <strong>${escapeHtml(details.to)}</strong>`;
  }
  if (action === "role.create" && details.role) {
    return `Rol asignado: <strong>${escapeHtml(details.role)}</strong>`;
  }
  if (action === "role.delete" && details.role) {
    return `Tenía rol: <strong>${escapeHtml(details.role)}</strong>`;
  }
  if (action === "auth.denied.page" && details.page) {
    return `Intentó acceder a: <strong>${escapeHtml(details.page)}</strong>`;
  }
  if (action === "carrier.team.edit" || action === "carrier.team.add" || action === "carrier.team.delete") {
    if (details.account) return `Cuenta: <strong>${escapeHtml(details.account)}</strong>`;
  }

  // Fallback: mostrar keys/values genéricos
  const pairs = Object.entries(details).map(([k, v]) => `${k}: ${escapeHtml(String(v))}`);
  return pairs.join(" · ");
}

/**
 * Formatea una fecha como "hace X minutos/horas/días".
 */
function formatRelativeDate(date) {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHour < 24) return `hace ${diffHour} h`;
  if (diffDay < 7) return `hace ${diffDay} ${diffDay === 1 ? "día" : "días"}`;

  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// ═══════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════

function wireHandlers() {
  // Búsqueda
  const searchInp = document.getElementById("al-search");
  if (searchInp && !searchInp.dataset.bound) {
    searchInp.dataset.bound = "1";
    searchInp.addEventListener("input", e => {
      filter.text = e.target.value.toLowerCase().trim();
      renderStats();
      renderList();
    });
  }

  // Filtros por tipo de acción
  document.querySelectorAll(".al-filter-chip").forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll(".al-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.action = chip.dataset.action;
      renderStats();
      renderList();
    });
  });

  // Rango de fechas
  const rangeSel = document.getElementById("al-range");
  if (rangeSel && !rangeSel.dataset.bound) {
    rangeSel.dataset.bound = "1";
    rangeSel.addEventListener("change", e => {
      filter.days = parseInt(e.target.value, 10);
      renderStats();
      renderList();
    });
  }

  // Botón refresh
  const refreshBtn = document.getElementById("al-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", loadEvents);
  }

  // Botón limpiar eventos >1 año
  const cleanupBtn = document.getElementById("al-cleanup");
  if (cleanupBtn && !cleanupBtn.dataset.bound) {
    cleanupBtn.dataset.bound = "1";
    cleanupBtn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar eventos con más de 1 año de antigüedad?\n\nEsta acción no se puede deshacer.")) return;
      cleanupBtn.disabled = true;
      try {
        const deleted = await cleanupOldEvents(365);
        alert(`✓ ${deleted} eventos antiguos eliminados`);
        await loadEvents();
      } catch (e) {
        alert("Error: " + e.message);
      } finally {
        cleanupBtn.disabled = false;
      }
    });
  }
}
