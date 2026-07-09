// ═══════════════════════════════════════════
// Hero Hub · Panel de Auditoría (admin)
// ═══════════════════════════════════════════
// Tabla del audit-log usando Tabulator (Stage C del rediseño admin).
// Mantiene la API pública initAuditPanel() para que admin.html no cambie.

import { fetchRecentEvents, cleanupOldEvents, ACTION_LABELS } from "./audit-log.js";

let allEvents = [];
let table = null;
const filterState = { text: "", action: "all", days: 30 };

// ═══════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════
export async function initAuditPanel() {
  if (!table) initTable();
  await loadEvents();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
}

// ═══════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════
async function loadEvents() {
  if (!table) return;
  table.alert("Cargando eventos…");
  allEvents = await fetchRecentEvents(300);
  // Enriquecemos con _details ya formateados (HTML) para evitar reformatear en cada render
  const enriched = allEvents.map(ev => ({
    ...ev,
    _details: formatDetails(ev.action, ev.details),
    _actorDisplay: ev.actorName || (ev.actor ? ev.actor.split("@")[0] : "—"),
  }));
  table.setData(enriched);
  table.clearAlert();
  applyFilters();
}

// ═══════════════════════════════════════════
// TABLA TABULATOR
// ═══════════════════════════════════════════
function initTable() {
  table = new Tabulator("#al-table", {
    layout: "fitColumns",
    height: "640px",
    pagination: true,
    paginationSize: 50,
    paginationSizeSelector: [25, 50, 100, 200],
    initialSort: [{ column: "timestamp", dir: "desc" }],
    placeholder: "Sin eventos para mostrar.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«",
          "first_title": "Primera página",
          "last": "»",
          "last_title": "Última página",
          "prev": "‹",
          "prev_title": "Anterior",
          "next": "›",
          "next_title": "Siguiente",
          "page_size": "Por página",
          "all": "Todos",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "filas", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Acción",
        field: "action",
        width: 240,
        formatter: (cell) => {
          const v = cell.getValue();
          const meta = ACTION_LABELS[v] || { label: v, icon: "circle", color: "#5a6b7a" };
          return `<div class="al-cell-action">
            <span class="al-cell-icon" style="background:${meta.color}1a;color:${meta.color};">
              <i data-lucide="${meta.icon}"></i>
            </span>
            <span class="al-cell-label">${escapeHtml(meta.label)}</span>
          </div>`;
        },
        sorter: (a, b, aRow, bRow) => {
          const la = ACTION_LABELS[a]?.label || a || "";
          const lb = ACTION_LABELS[b]?.label || b || "";
          return la.localeCompare(lb);
        }
      },
      {
        title: "Por",
        field: "_actorDisplay",
        width: 180,
        formatter: "plaintext"
      },
      {
        title: "Objetivo",
        field: "target",
        minWidth: 160,
        formatter: (cell) => cell.getValue() ? escapeHtml(cell.getValue()) : "<span style='color:#94a3b8'>—</span>"
      },
      {
        title: "Detalles",
        field: "_details",
        minWidth: 200,
        formatter: "html",
        headerSort: false
      },
      {
        title: "Cuándo",
        field: "timestamp",
        width: 150,
        sorter: "datetime",
        formatter: (cell) => {
          const d = cell.getValue();
          if (!d) return "";
          const rel = formatRelativeDate(d);
          const full = d.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          return `<span class="al-cell-time" title="${full}">${rel}</span>`;
        }
      }
    ]
  });

  // Re-render Lucide icons después de cada render
  let refreshTimer = null;
  const scheduleIconRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (window.refreshIcons) window.refreshIcons(); }, 50);
  };
  table.on("renderComplete", scheduleIconRefresh);
  table.on("dataFiltered", () => { renderStats(); scheduleIconRefresh(); });
  table.on("dataLoaded", renderStats);
}

// ═══════════════════════════════════════════
// FILTROS
// ═══════════════════════════════════════════
function applyFilters() {
  if (!table) return;
  const now = new Date();
  const cutoff = new Date(now.getTime() - filterState.days * 24 * 60 * 60 * 1000);

  table.setFilter((row) => {
    // Rango de fechas
    if (row.timestamp && row.timestamp < cutoff) return false;
    // Tipo de acción
    if (filterState.action !== "all" && row.action !== filterState.action) return false;
    // Búsqueda libre
    if (filterState.text) {
      const haystack = `${row.actor || ""} ${row.actorName || ""} ${row.target || ""} ${row.action || ""} ${JSON.stringify(row.details || {})}`.toLowerCase();
      if (!haystack.includes(filterState.text)) return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════
// STATS (3 contadores arriba)
// ═══════════════════════════════════════════
function renderStats() {
  if (!table) return;
  const filtered = table.getData("active"); // filtered + sorted

  const total = filtered.length;
  const uniqueActors = new Set(filtered.map(ev => ev.actor)).size;
  const counts = {};
  filtered.forEach(ev => { counts[ev.action] = (counts[ev.action] || 0) + 1; });
  const topEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  setText("al-stat-total", total);
  setText("al-stat-actors", uniqueActors);
  if (topEntry) {
    const label = ACTION_LABELS[topEntry[0]]?.label || topEntry[0];
    setText("al-stat-top", label);
    setText("al-stat-top-count", `${topEntry[1]} ${topEntry[1] === 1 ? "vez" : "veces"}`);
  } else {
    setText("al-stat-top", "—");
    setText("al-stat-top-count", "—");
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

// ═══════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════
function formatDetails(action, details) {
  if (!details || Object.keys(details).length === 0) return "";

  if (action === "role.update" && details.from && details.to) {
    return `<span class="al-tag">${escapeHtml(details.from)}</span> → <span class="al-tag al-tag-cyan">${escapeHtml(details.to)}</span>`;
  }
  if (action === "role.create" && details.role) {
    return `Rol: <span class="al-tag al-tag-cyan">${escapeHtml(details.role)}</span>`;
  }
  if (action === "role.delete" && details.role) {
    return `Tenía: <span class="al-tag">${escapeHtml(details.role)}</span>`;
  }
  if (action === "auth.denied.page" && details.page) {
    return `Intentó: <code>${escapeHtml(details.page)}</code>`;
  }
  if ((action === "carrier.team.edit" || action === "carrier.team.add" || action === "carrier.team.delete") && details.account) {
    return `Cuenta: <strong>${escapeHtml(details.account)}</strong>`;
  }

  const pairs = Object.entries(details)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `<span class="al-kv"><em>${escapeHtml(k)}:</em> ${escapeHtml(String(v))}</span>`);
  return pairs.join(" ");
}

function formatRelativeDate(date) {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "hace un momento";
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
// HANDLERS DE UI (búsqueda, chips, range, botones)
// ═══════════════════════════════════════════
function wireHandlers() {
  // Búsqueda libre
  const searchInp = document.getElementById("al-search");
  if (searchInp && !searchInp.dataset.bound) {
    searchInp.dataset.bound = "1";
    searchInp.addEventListener("input", e => {
      filterState.text = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }

  // Chips por tipo de acción
  document.querySelectorAll(".al-filter-chip").forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll(".al-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filterState.action = chip.dataset.action;
      applyFilters();
    });
  });

  // Rango de fechas
  const rangeSel = document.getElementById("al-range");
  if (rangeSel && !rangeSel.dataset.bound) {
    rangeSel.dataset.bound = "1";
    rangeSel.addEventListener("change", e => {
      filterState.days = parseInt(e.target.value, 10);
      applyFilters();
    });
  }

  // Refresh
  const refreshBtn = document.getElementById("al-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", loadEvents);
  }

  // Export CSV
  const exportBtn = document.getElementById("al-export");
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", () => {
      if (!table) return;
      const fname = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      table.download("csv", fname);
    });
  }

  // Limpiar eventos >1 año
  const cleanupBtn = document.getElementById("al-cleanup");
  if (cleanupBtn && !cleanupBtn.dataset.bound) {
    cleanupBtn.dataset.bound = "1";
    cleanupBtn.addEventListener("click", async () => {
      const ok = await heroConfirm({
        title: "Limpiar eventos antiguos",
        message: "¿Eliminar eventos con más de 1 año de antigüedad? Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar",
        variant: "danger"
      });
      if (!ok) return;
      cleanupBtn.disabled = true;
      try {
        const deleted = await cleanupOldEvents(365);
        heroToast.success(`${deleted} eventos antiguos eliminados`);
        await loadEvents();
      } catch (e) {
        heroToast.error("No se pudo limpiar: " + e.message);
      } finally {
        cleanupBtn.disabled = false;
      }
    });
  }
}
