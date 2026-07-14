// ═══════════════════════════════════════════
// Hero Hub · Finanzas
// ═══════════════════════════════════════════
// Lógica del módulo de Finanzas: ingresos, payouts a brokers,
// tabla de comisiones, reportes y envío por email.
//
// Implementado:
//   - Reveal del panel post page-guard.
//   - Toggle Día/Noche en el header (sincroniza con localStorage + Firestore).
//   - Tab "Tabla de Comisiones": CRUD Firestore + Tabulator (lazy init al abrir el tab).
//
// Pendiente: Brokers, Modal Nuevo Ingreso, Lista de Ingresos,
// Dashboard real, Comparativas, Exportar, Migración del Excel.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { logEvent, ACTIONS } from "./audit-log.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

// URL del Worker (Cloudflare) — disparador de emails a brokers.
// Es el MISMO Worker que usa el IT Console; aquí solo consumimos el endpoint
// /finanzas/send-report. La auth es por Firebase ID token verificado del lado
// del Worker contra el dominio del Hub.
const FINANZAS_WORKER_URL = "https://hero-email-worker.broad-fire-d2d6.workers.dev";

let currentUserEmail = null;


// ═══════════════════════════════════════════
// 1) Handlers estáticos — se bindean al cargar
// ═══════════════════════════════════════════
// Bindeamos cuanto antes para que el botón "Nueva fila" responda
// aunque Tabulator/Firestore aún no hayan terminado de inicializar.
document.addEventListener("DOMContentLoaded", () => {
  bindThemeToggle();
  bindComisionesStaticHandlers();
  bindComisionesLazyInit();
  bindBrokersStaticHandlers();
  bindBrokersLazyInit();
  bindIngresosStaticHandlers();
  bindIngresosLazyInit();
  bindReportesStaticHandlers();
  bindReportesLazyInit();
  bindDashboardStaticHandlers();
  bindDashboardLazyInit();
  bindComparativasStaticHandlers();
  bindComparativasLazyInit();
  bindExportarStaticHandlers();
  bindExportarLazyInit();
  bindImportarStaticHandlers();
  bindImportarLazyInit();
});


// ═══════════════════════════════════════════
// 2) Auth + reveal
// ═══════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    location.href = "index.html";
    return;
  }

  await window.getPageContext();
  currentUserEmail = user.email.toLowerCase().trim();

  document.getElementById("loading").style.display = "none";
  document.getElementById("finanzas-panel").style.display = "block";
  if (window.refreshIcons) window.refreshIcons();

  // Dashboard es el tab activo por default → init inmediato
  const activeTab = document.querySelector(".admin-sidebar-link.active");
  if (activeTab?.dataset.tab === "dashboard") initDashboardPanel();
});


// ═══════════════════════════════════════════════════════════
// TOGGLE DE TEMA (Día/Noche)
// ═══════════════════════════════════════════════════════════
function bindThemeToggle() {
  const btn = document.getElementById("fc-theme-toggle");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";

  function syncIcon() {
    const isDark = document.body.dataset.theme === "dark";
    btn.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i>`;
    if (window.refreshIcons) window.refreshIcons();
  }
  syncIcon();

  btn.addEventListener("click", async () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    try { localStorage.setItem("hero-theme", next); } catch (_) {}
    syncIcon();
    // Re-render charts del Dashboard para que colores/labels usen el tema nuevo
    if (fdInited) renderDashboard();
    if (!currentUserEmail) return;
    try {
      await updateDoc(doc(db, "users", currentUserEmail), { theme: next });
    } catch (e) {
      console.warn("No se pudo guardar el tema en Firestore:", e.message);
    }
  });
}


// ═══════════════════════════════════════════════════════════
// TABLA DE COMISIONES
// ═══════════════════════════════════════════════════════════
const COMISIONES_COL = "finanzas-comisiones-tabla";
const TIPOS_ORIGEN = ["HERO", "FRIENDS", "AGENTES"];

let comisionesData = [];     // [{ id, carrier, tipoOrigen, agente, tasa, notas, ... }]
let fcTable = null;
let comisionesInited = false;
const fcFilter = { text: "", origen: "all" };


// ─── Bind estático: search, chips, "Nueva fila" ────────────
function bindComisionesStaticHandlers() {
  const search = document.getElementById("fc-search");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", (e) => {
      fcFilter.text = e.target.value.toLowerCase().trim();
      applyFcFilters();
    });
  }

  document.querySelectorAll(".fc-filter-chip").forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll(".fc-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      fcFilter.origen = chip.dataset.origen;
      applyFcFilters();
    });
  });

  const addBtn = document.getElementById("fc-add-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => {
      // Si el tab nunca se ha abierto (raro pero posible), inicializa ahora.
      if (!comisionesInited) initComisionesPanel();
      openComisionModal(null);
    });
  }
}

// ─── Init perezosa: dispara al abrir el tab de Comisiones ───
function bindComisionesLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="comisiones"]').forEach(b => {
    if (b.dataset.fcBound) return;
    b.dataset.fcBound = "1";
    b.addEventListener("click", () => {
      if (!comisionesInited) initComisionesPanel();
    });
  });
}

async function initComisionesPanel() {
  if (comisionesInited) return;
  comisionesInited = true;
  try {
    if (!fcTable) initFcTable();
    await loadComisiones();
    fcTable.setData(comisionesData);
    updateTotal();
  } catch (e) {
    console.error("Error inicializando Tabla de Comisiones:", e);
    comisionesInited = false; // permitir reintentar
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de la colección "${COMISIONES_COL}".\n\n` +
        `Agrega esta regla en Firebase Console → Firestore → Rules:\n\n` +
        `match /${COMISIONES_COL}/{doc} {\n  allow read, write: if request.auth != null && request.auth.token.email.matches(".*@heroinsuranceusa.com");\n}`
      : `No se pudo cargar la Tabla de Comisiones:\n${e?.message || e}`;
    heroToast.error(msg, { duration: 6000 });
  }
  if (window.refreshIcons) window.refreshIcons();
}

async function loadComisiones() {
  // Si falla, propagamos el error al caller (initComisionesPanel) para
  // que muestre el detalle real (ej. permisos de Firestore).
  const q = query(collection(db, COMISIONES_COL), orderBy("carrier", "asc"));
  const snap = await getDocs(q);
  comisionesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function initFcTable() {
  fcTable = new Tabulator("#fc-table", {
    index: "id",
    data: [],
    layout: "fitColumns",
    height: "560px",
    pagination: true,
    paginationSize: 25,
    paginationSizeSelector: [10, 25, 50, 100],
    initialSort: [{ column: "carrier", dir: "asc" }],
    placeholder: "Aún no hay filas. Agrega la primera con el botón “Nueva fila”.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "filas", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Carrier",
        field: "carrier",
        minWidth: 180,
        sorter: "string",
        formatter: (cell) => `<strong>${escapeHtml(cell.getValue() || "—")}</strong>`
      },
      {
        title: "Origen",
        field: "tipoOrigen",
        width: 130,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue() || "";
          if (!v) return `<span class="fc-empty">—</span>`;
          return `<span class="fc-origen-badge fc-origen-${escapeHtmlAttr(v)}">${escapeHtml(v)}</span>`;
        }
      },
      {
        title: "Agente",
        field: "agente",
        minWidth: 180,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? escapeHtml(v) : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Tasa",
        field: "tasa",
        width: 110,
        hozAlign: "right",
        headerHozAlign: "right",
        sorter: "number",
        formatter: (cell) => {
          const v = cell.getValue();
          if (v == null || isNaN(v)) return `<span class="fc-empty">—</span>`;
          return `<span class="fc-tasa-cell">${formatPct(v)}</span>`;
        }
      },
      {
        title: "Notas",
        field: "notas",
        minWidth: 200,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<div class="fc-notes-cell" title="${escapeHtmlAttr(v)}">${escapeHtml(v)}</div>` : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "",
        field: "_actions",
        width: 90,
        hozAlign: "center",
        headerSort: false,
        formatter: (cell) => {
          const r = cell.getRow().getData();
          return `<div class="fc-actions">
            <button class="fc-act-btn fc-edit" data-id="${escapeHtmlAttr(r.id)}" title="Editar">✎</button>
            <button class="fc-act-btn fc-del" data-id="${escapeHtmlAttr(r.id)}" title="Eliminar">✕</button>
          </div>`;
        }
      }
    ]
  });

  // Delegación para botones dentro de las celdas
  const tableEl = document.getElementById("fc-table");
  tableEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".fc-edit");
    const delBtn = e.target.closest(".fc-del");
    if (editBtn) onEditComision(editBtn.dataset.id);
    else if (delBtn) onDeleteComision(delBtn.dataset.id);
  });

  fcTable.on("dataFiltered", updateTotal);
  fcTable.on("dataLoaded", updateTotal);
}

// ─── Filtros ─────────────────────────────────
function applyFcFilters() {
  if (!fcTable) return;
  fcTable.setFilter((row) => {
    if (fcFilter.origen !== "all" && row.tipoOrigen !== fcFilter.origen) return false;
    if (fcFilter.text) {
      const haystack = `${row.carrier || ""} ${row.agente || ""} ${row.notas || ""}`.toLowerCase();
      if (!haystack.includes(fcFilter.text)) return false;
    }
    return true;
  });
}

function updateTotal() {
  const el = document.getElementById("fc-total");
  if (!el || !fcTable) return;
  const visible = fcTable.getDataCount("active");
  const total = comisionesData.length;
  el.textContent = visible === total
    ? `${total} fila${total === 1 ? "" : "s"}`
    : `${visible} de ${total}`;
}


// ─── CRUD handlers ───────────────────────────
function onEditComision(id) {
  const row = comisionesData.find(r => r.id === id);
  if (!row) return;
  openComisionModal(row);
}

async function onDeleteComision(id) {
  const row = comisionesData.find(r => r.id === id);
  if (!row) return;
  const label = `${row.carrier || "(sin carrier)"} · ${row.tipoOrigen || ""}${row.agente ? " · " + row.agente : ""}`;
  const ok = await heroConfirm({
    title: "Eliminar fila",
    message: `¿Eliminar esta fila? ${label}. Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, COMISIONES_COL, id));
  } catch (e) {
    heroToast.error("No se pudo eliminar: " + e.message);
    return;
  }

  logEvent(ACTIONS.FINANZAS_COMISION_DELETE, row.carrier || id, {
    tipoOrigen: row.tipoOrigen, agente: row.agente || null, tasa: row.tasa
  });

  comisionesData = comisionesData.filter(r => r.id !== id);
  if (fcTable) fcTable.deleteRow(id);
  updateTotal();
  showFcStatus(`✓ Fila de ${row.carrier || "?"} eliminada`);
}


// ─── Modal Nueva/Editar (sl-dialog) ──────────
function openComisionModal(existing) {
  const isEdit = !!existing;
  const carriersExistentes = uniqueCarriers();
  const initialOrigen = existing?.tipoOrigen || "HERO";

  const dialog = document.createElement("sl-dialog");
  dialog.label = isEdit ? "Editar fila de comisión" : "Nueva fila de comisión";
  dialog.className = "fc-modal";
  dialog.innerHTML = `
    <div class="fc-form">
      <div>
        <sl-input
          id="fc-f-carrier"
          label="Carrier"
          placeholder="Ej. FGLIFE, CIGNA, AMERITAS..."
          value="${escapeHtmlAttr(existing?.carrier || "")}"
          list="fc-carrier-suggestions"
          autocomplete="off"
          clearable
          required>
        </sl-input>
        <datalist id="fc-carrier-suggestions">
          ${carriersExistentes.map(c => `<option value="${escapeHtmlAttr(c)}"></option>`).join("")}
        </datalist>
      </div>

      <div class="fc-form-row">
        <div class="fc-native-field">
          <label for="fc-f-origen" class="fc-native-label">Tipo de origen</label>
          <select id="fc-f-origen" class="fc-native-select" required>
            ${TIPOS_ORIGEN.map(t => `<option value="${t}" ${t === initialOrigen ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>

        <sl-input
          id="fc-f-tasa"
          label="Tasa (%)"
          type="number"
          step="0.01"
          min="0"
          placeholder="Ej. 115"
          value="${existing?.tasa != null ? toPctNumber(existing.tasa) : ""}"
          required>
        </sl-input>
      </div>

      <div id="fc-f-agente-wrap" style="display:${initialOrigen === "AGENTES" ? "" : "none"};">
        <sl-input
          id="fc-f-agente"
          label="Agente"
          placeholder="Nombre del agente"
          value="${escapeHtmlAttr(existing?.agente || "")}"
          clearable>
        </sl-input>
        <div class="fc-form-hint">Requerido cuando el origen es AGENTES.</div>
      </div>

      <sl-textarea
        id="fc-f-notas"
        label="Notas"
        placeholder="Chargebacks, observaciones, fecha de cambio de tasa..."
        rows="3"
        resize="auto"
        value="${escapeHtmlAttr(existing?.notas || "")}">
      </sl-textarea>
    </div>

    <sl-button slot="footer" id="fc-f-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="fc-f-save" variant="primary">
      <i data-lucide="${isEdit ? "save" : "plus"}" slot="prefix" style="width:14px;height:14px;"></i>
      ${isEdit ? "Guardar cambios" : "Agregar fila"}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  const carrierInp = dialog.querySelector("#fc-f-carrier");
  const origenSel = dialog.querySelector("#fc-f-origen");
  const tasaInp = dialog.querySelector("#fc-f-tasa");
  const agenteWrap = dialog.querySelector("#fc-f-agente-wrap");
  const agenteInp = dialog.querySelector("#fc-f-agente");
  const notasInp = dialog.querySelector("#fc-f-notas");

  function updateAgenteVisibility() {
    const isAgentes = origenSel.value === "AGENTES";
    agenteWrap.style.display = isAgentes ? "" : "none";
    if (!isAgentes) agenteInp.value = "";
  }
  origenSel.addEventListener("change", updateAgenteVisibility);

  // Cerrar SOLO con la X o Escape — clicks en backdrop o en dropdowns
  // que se renderizan fuera del dialog NO deben cerrarlo.
  dialog.addEventListener("sl-request-close", (e) => {
    if (e.detail.source !== "close-button" && e.detail.source !== "keyboard") {
      e.preventDefault();
    }
  });

  dialog.addEventListener("sl-after-show", () => {
    updateAgenteVisibility();
    carrierInp.focus();
  });
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#fc-f-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#fc-f-save").addEventListener("click", async () => {
    const carrier = (carrierInp.value || "").trim();
    const tipoOrigen = origenSel.value;
    const agente = (agenteInp.value || "").trim();
    const tasaPctRaw = (tasaInp.value || "").trim();
    const notas = (notasInp.value || "").trim();

    if (!carrier) { carrierInp.focus(); heroToast.error("El carrier es obligatorio."); return; }
    if (!TIPOS_ORIGEN.includes(tipoOrigen)) { heroToast.error("Tipo de origen inválido."); return; }
    if (!tasaPctRaw) { tasaInp.focus(); heroToast.error("La tasa es obligatoria."); return; }

    const tasaPct = Number(tasaPctRaw);
    if (!isFinite(tasaPct) || tasaPct < 0) { tasaInp.focus(); heroToast.error("La tasa debe ser un número ≥ 0."); return; }
    if (tipoOrigen === "AGENTES" && !agente) {
      agenteInp.focus();
      heroToast.error("Cuando el origen es AGENTES, el nombre del agente es obligatorio.");
      return;
    }

    const tasaDecimal = Math.round((tasaPct / 100) * 100000) / 100000;
    const carrierNorm = carrier.toUpperCase();

    const payload = {
      carrier: carrierNorm,
      tipoOrigen,
      agente: tipoOrigen === "AGENTES" ? agente : "",
      tasa: tasaDecimal,
      notas,
      actualizadoPor: currentUserEmail,
      actualizadoEn: serverTimestamp()
    };

    try {
      if (isEdit) {
        await updateDoc(doc(db, COMISIONES_COL, existing.id), payload);
        const idx = comisionesData.findIndex(r => r.id === existing.id);
        const updated = { ...comisionesData[idx], ...payload };
        if (idx >= 0) comisionesData[idx] = updated;
        if (fcTable) fcTable.updateRow(existing.id, updated);
        logEvent(ACTIONS.FINANZAS_COMISION_EDIT, carrierNorm, {
          tipoOrigen, agente: payload.agente || null, tasa: tasaDecimal,
          from: { carrier: existing.carrier, tipoOrigen: existing.tipoOrigen, tasa: existing.tasa }
        });
        showFcStatus(`✓ ${carrierNorm} actualizado`);
      } else {
        payload.creadoPor = currentUserEmail;
        payload.creadoEn = serverTimestamp();
        const ref = await addDoc(collection(db, COMISIONES_COL), payload);
        const newRow = { id: ref.id, ...payload };
        comisionesData.push(newRow);
        if (fcTable) fcTable.addRow(newRow);
        logEvent(ACTIONS.FINANZAS_COMISION_ADD, carrierNorm, {
          tipoOrigen, agente: payload.agente || null, tasa: tasaDecimal
        });
        showFcStatus(`✓ ${carrierNorm} agregado`);
      }
      updateTotal();
      dialog.hide();
    } catch (e) {
      heroToast.error("No se pudo guardar: " + e.message);
    }
  });

  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

function uniqueCarriers() {
  const set = new Set();
  comisionesData.forEach(r => { if (r.carrier) set.add(r.carrier); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}


// ═══════════════════════════════════════════════════════════
// BROKERS
// ═══════════════════════════════════════════════════════════
const BROKERS_COL = "finanzas-brokers";

let brokersData = [];        // [{ id, nombre, email, telefono, notas, ... }]
let fbTable = null;
let brokersInited = false;
const fbFilter = { text: "", tipo: "all" };


function bindBrokersStaticHandlers() {
  const search = document.getElementById("fb-search");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", (e) => {
      fbFilter.text = e.target.value.toLowerCase().trim();
      applyFbFilters();
    });
  }

  const addBtn = document.getElementById("fb-add-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => {
      if (!brokersInited) initBrokersPanel();
      openBrokerModal(null);
    });
  }

  // Chips de filtro por tipo (Todos · Agencias · Brokers/Agentes)
  document.querySelectorAll('[data-fb-tipo]').forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll('[data-fb-tipo]').forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      fbFilter.tipo = chip.dataset.fbTipo;
      applyFbFilters();
    });
  });
}

function bindBrokersLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="brokers"]').forEach(b => {
    if (b.dataset.fbBound) return;
    b.dataset.fbBound = "1";
    b.addEventListener("click", () => {
      if (!brokersInited) initBrokersPanel();
    });
  });
}

async function initBrokersPanel() {
  if (brokersInited) return;
  brokersInited = true;
  try {
    if (!fbTable) initFbTable();
    await loadBrokers();
    fbTable.setData(brokersData);
    updateBrokersTotal();
  } catch (e) {
    console.error("Error inicializando Brokers:", e);
    brokersInited = false;
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de la colección "${BROKERS_COL}". Verifica las reglas en Firebase Console.`
      : `No se pudo cargar Brokers:\n${e?.message || e}`;
    heroToast.error(msg, { duration: 6000 });
  }
  if (window.refreshIcons) window.refreshIcons();
}

async function loadBrokers() {
  const q = query(collection(db, BROKERS_COL), orderBy("nombre", "asc"));
  const snap = await getDocs(q);
  brokersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function initFbTable() {
  fbTable = new Tabulator("#fb-table", {
    index: "id",
    data: [],
    layout: "fitColumns",
    height: "560px",
    pagination: true,
    paginationSize: 25,
    paginationSizeSelector: [10, 25, 50, 100],
    initialSort: [{ column: "nombre", dir: "asc" }],
    placeholder: "Aún no hay agencias ni brokers. Agrega el primero con el botón “Nueva agencia/broker”.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "registros", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Tipo",
        field: "tipo",
        width: 130,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue() || "agencia";
          const cls = v === "broker" ? "broker" : "agencia";
          return `<span class="fb-tipo-badge fb-tipo-${cls}">${escapeHtml(TIPO_DEST_LABEL[v] || v)}</span>`;
        }
      },
      {
        title: "Nombre",
        field: "nombre",
        minWidth: 180,
        sorter: "string",
        formatter: (cell) => `<strong>${escapeHtml(cell.getValue() || "—")}</strong>`
      },
      {
        title: "Email",
        field: "email",
        minWidth: 220,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          if (!v) return `<span class="fc-empty">—</span>`;
          return `<a href="mailto:${escapeHtmlAttr(v)}" class="fc-link">${escapeHtml(v)}</a>`;
        }
      },
      {
        title: "Teléfono",
        field: "telefono",
        width: 160,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? escapeHtml(v) : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Observaciones",
        field: "notas",
        minWidth: 200,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<div class="fc-notes-cell" title="${escapeHtmlAttr(v)}">${escapeHtml(v)}</div>` : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "",
        field: "_actions",
        width: 90,
        hozAlign: "center",
        headerSort: false,
        formatter: (cell) => {
          const r = cell.getRow().getData();
          return `<div class="fc-actions">
            <button class="fc-act-btn fc-edit" data-id="${escapeHtmlAttr(r.id)}" title="Editar">✎</button>
            <button class="fc-act-btn fc-del" data-id="${escapeHtmlAttr(r.id)}" title="Eliminar">✕</button>
          </div>`;
        }
      }
    ]
  });

  const tableEl = document.getElementById("fb-table");
  tableEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".fc-edit");
    const delBtn = e.target.closest(".fc-del");
    if (editBtn) onEditBroker(editBtn.dataset.id);
    else if (delBtn) onDeleteBroker(delBtn.dataset.id);
  });

  fbTable.on("dataFiltered", updateBrokersTotal);
  fbTable.on("dataLoaded", updateBrokersTotal);
}

function applyFbFilters() {
  if (!fbTable) return;
  fbTable.setFilter((row) => {
    if (fbFilter.tipo !== "all") {
      const t = row.tipo || "agencia";
      if (t !== fbFilter.tipo) return false;
    }
    if (fbFilter.text) {
      const haystack = `${row.nombre || ""} ${row.email || ""} ${row.telefono || ""} ${row.notas || ""}`.toLowerCase();
      if (!haystack.includes(fbFilter.text)) return false;
    }
    return true;
  });
}

function updateBrokersTotal() {
  const el = document.getElementById("fb-total");
  if (!el || !fbTable) return;
  const visible = fbTable.getDataCount("active");
  const total = brokersData.length;
  const rotulo = (n) => `${n} registro${n === 1 ? "" : "s"}`;
  el.textContent = visible === total ? rotulo(total) : `${visible} de ${total}`;
}

function onEditBroker(id) {
  const row = brokersData.find(r => r.id === id);
  if (!row) return;
  openBrokerModal(row);
}

async function onDeleteBroker(id) {
  const row = brokersData.find(r => r.id === id);
  if (!row) return;
  const label = TIPO_DEST_LABEL[row.tipo || "agencia"];
  const ok = await heroConfirm({
    title: `Eliminar ${label.toLowerCase()}`,
    message: `¿Eliminar ${label.toLowerCase()} "${row.nombre}"? Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, BROKERS_COL, id));
  } catch (e) {
    heroToast.error("No se pudo eliminar: " + e.message);
    return;
  }

  logEvent(ACTIONS.FINANZAS_BROKER_DELETE, row.nombre || id, {
    tipo: row.tipo || null, email: row.email || null
  });

  brokersData = brokersData.filter(r => r.id !== id);
  if (fbTable) fbTable.deleteRow(id);
  updateBrokersTotal();
  showFbStatus(`✓ ${label} ${row.nombre || "?"} eliminada`);
}

function openBrokerModal(existing) {
  const isEdit = !!existing;
  const initialTipo = existing?.tipo || "agencia";

  const dialog = document.createElement("sl-dialog");
  dialog.label = isEdit ? "Editar destinatario" : "Nuevo destinatario";
  dialog.className = "fc-modal";
  dialog.innerHTML = `
    <div class="fc-form">
      <div class="fc-native-field">
        <label class="fc-native-label">Tipo</label>
        <div class="fb-tipo-radios">
          <label class="fb-tipo-radio ${initialTipo === "agencia" ? "is-active" : ""}">
            <input type="radio" name="fb-f-tipo" value="agencia" ${initialTipo === "agencia" ? "checked" : ""}>
            <span>Agencia</span>
            <small>Family paga a la agencia; luego se distribuye internamente.</small>
          </label>
          <label class="fb-tipo-radio ${initialTipo === "broker" ? "is-active" : ""}">
            <input type="radio" name="fb-f-tipo" value="broker" ${initialTipo === "broker" ? "checked" : ""}>
            <span>Broker / Agente</span>
            <small>Individual — se paga directo al agente o broker.</small>
          </label>
        </div>
      </div>

      <sl-input
        id="fb-f-nombre"
        label="Nombre"
        placeholder="Ej. ENSURE, FRIENDS, KHAN..."
        value="${escapeHtmlAttr(existing?.nombre || "")}"
        autocomplete="off"
        clearable
        required>
      </sl-input>

      <sl-input
        id="fb-f-email"
        label="Email (opcional)"
        type="email"
        placeholder="contacto@ejemplo.com"
        value="${escapeHtmlAttr(existing?.email || "")}"
        help-text="Si está presente, se usa por defecto al enviar reportes."
        autocomplete="off"
        clearable>
      </sl-input>

      <sl-input
        id="fb-f-telefono"
        label="Teléfono (opcional)"
        placeholder="+1 555 1234"
        value="${escapeHtmlAttr(existing?.telefono || "")}"
        autocomplete="off"
        clearable>
      </sl-input>

      <sl-textarea
        id="fb-f-notas"
        label="Observaciones (opcional)"
        placeholder="Ej. 'esta agencia genera siempre el 100% de lo que entra'..."
        rows="3"
        resize="auto"
        value="${escapeHtmlAttr(existing?.notas || "")}">
      </sl-textarea>
    </div>

    <sl-button slot="footer" id="fb-f-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="fb-f-save" variant="primary">
      <i data-lucide="${isEdit ? "save" : "plus"}" slot="prefix" style="width:14px;height:14px;"></i>
      ${isEdit ? "Guardar cambios" : "Agregar"}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  const nombreInp = dialog.querySelector("#fb-f-nombre");
  const emailInp = dialog.querySelector("#fb-f-email");
  const telInp = dialog.querySelector("#fb-f-telefono");
  const notasInp = dialog.querySelector("#fb-f-notas");
  const tipoRadios = dialog.querySelectorAll('input[name="fb-f-tipo"]');

  // Toggle visual del radio activo
  tipoRadios.forEach(r => r.addEventListener("change", () => {
    dialog.querySelectorAll(".fb-tipo-radio").forEach(l => l.classList.toggle("is-active", l.querySelector("input").checked));
  }));

  dialog.addEventListener("sl-request-close", (e) => {
    if (e.detail.source !== "close-button" && e.detail.source !== "keyboard") {
      e.preventDefault();
    }
  });

  dialog.addEventListener("sl-after-show", () => nombreInp.focus());
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#fb-f-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#fb-f-save").addEventListener("click", async () => {
    const nombre = (nombreInp.value || "").trim();
    const email = (emailInp.value || "").trim();
    const telefono = (telInp.value || "").trim();
    const notas = (notasInp.value || "").trim();
    const tipoChecked = dialog.querySelector('input[name="fb-f-tipo"]:checked');
    const tipo = tipoChecked ? tipoChecked.value : "agencia";

    if (!nombre) { nombreInp.focus(); heroToast.error("El nombre es obligatorio."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInp.focus();
      heroToast.error("El email no tiene un formato válido.");
      return;
    }

    const nombreNorm = nombre.toUpperCase();

    const payload = {
      nombre: nombreNorm,
      tipo,
      email,
      telefono,
      notas,
      actualizadoPor: currentUserEmail,
      actualizadoEn: serverTimestamp()
    };

    try {
      if (isEdit) {
        await updateDoc(doc(db, BROKERS_COL, existing.id), payload);
        const idx = brokersData.findIndex(r => r.id === existing.id);
        const updated = { ...brokersData[idx], ...payload };
        if (idx >= 0) brokersData[idx] = updated;
        if (fbTable) fbTable.updateRow(existing.id, updated);
        logEvent(ACTIONS.FINANZAS_BROKER_EDIT, nombreNorm, {
          tipo, email: email || null,
          from: { nombre: existing.nombre, tipo: existing.tipo || null, email: existing.email || null }
        });
        showFbStatus(`✓ ${nombreNorm} actualizado`);
      } else {
        payload.creadoPor = currentUserEmail;
        payload.creadoEn = serverTimestamp();
        const ref = await addDoc(collection(db, BROKERS_COL), payload);
        const newRow = { id: ref.id, ...payload };
        brokersData.push(newRow);
        if (fbTable) fbTable.addRow(newRow);
        logEvent(ACTIONS.FINANZAS_BROKER_ADD, nombreNorm, { tipo, email: email || null });
        showFbStatus(`✓ ${nombreNorm} agregado`);
      }
      updateBrokersTotal();
      dialog.hide();
    } catch (e) {
      heroToast.error("No se pudo guardar: " + e.message);
    }
  });

  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

let fbStatusTimeout = null;
function showFbStatus(msg) {
  const el = document.getElementById("fb-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  if (fbStatusTimeout) clearTimeout(fbStatusTimeout);
  fbStatusTimeout = setTimeout(() => el.classList.remove("visible"), 3000);
}


// ═══════════════════════════════════════════════════════════
// INGRESOS — captura (modal)
// La lista completa con Tabulator vendrá en la próxima entrega.
// ═══════════════════════════════════════════════════════════
const INGRESOS_COL = "finanzas-ingresos";
const TIPOS_PAGO = ["LIFE", "SUPP", "ACA", "MEDICARE", "OTROS"];
const CATEGORIAS = ["COMISSION", "OVERRIDES", "HERO"];
const MESES_ABREV = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

// Tipo de destinatario de un payout: agencia (paga a una agencia; Family) o broker (individual/agente)
const TIPOS_DESTINATARIO = ["agencia", "broker"];
const TIPO_DEST_LABEL = { agencia: "Agencia", broker: "Broker/Agente" };

// Catálogo de carriers — editable desde el dropdown del modal de ingreso.
// Se persiste en finanzas-config/carriers.list. El array de abajo es solo el seed.
const CARRIERS_DEFAULT = [
  "Aetna", "Aetna ACA", "Agility", "Ambetter ACA", "Amerigroup", "Anthem Blue Cross",
  "Cigna", "Ameritas", "AGA", "Careington", "CarePoint",
  "Elevance", "FG Life", "Health Family", "Health Sun", "Humana",
  "Loyal", "Manhattan Life", "Molina", "Mutual of Omaha", "National Life",
  "Oscar", "Senior Life", "Signa", "Solis", "Standard Life",
  "Sunshine Health", "United Health Care", "Wellcare"
];
let carriersList = null; // cache en memoria

// Lista por defecto de "Descripción depósito" (los carriers).
// Se guarda/lee de finanzas-config/descripciones; este array es solo
// el seed inicial si el doc no existe.
const DESC_DEPOSITO_DEFAULT = [
  "CAREPOINT", "AGILITY", "AMERITAS LIFE", "HEALTHFAMILY", "MANHATTAN LIFE",
  "AETNALIFE", "LIFE INSURANCE", "FGLIFE", "SENIOR LIFE", "OTROS",
  "CIGNA - LOYAL", "ELEVANCE", "UNITED HEALTH CARE", "HEALTH SUN",
  "NATIONAL LIFE", "MUTUAL OF OMAHA", "STANDARD LIFE", "SOLIS"
];

let descDepositoList = null; // cache en memoria

async function loadDescDepositoList() {
  if (descDepositoList) return descDepositoList;
  try {
    const ref = doc(db, "finanzas-config", "descripciones");
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data().deposito)) {
      descDepositoList = snap.data().deposito;
    } else {
      // Seed inicial — primera vez que se abre el modal
      descDepositoList = [...DESC_DEPOSITO_DEFAULT];
      await setDoc(ref, { deposito: descDepositoList });
    }
  } catch (e) {
    console.warn("No se pudo cargar la lista de descripciones:", e.message);
    descDepositoList = [...DESC_DEPOSITO_DEFAULT];
  }
  return descDepositoList;
}

async function addDescDepositoToList(rawValue) {
  const value = rawValue.trim().toUpperCase();
  if (!value) throw new Error("El nombre no puede estar vacío.");
  if (descDepositoList.includes(value)) throw new Error(`"${value}" ya está en la lista.`);
  descDepositoList = [...descDepositoList, value];
  try {
    await setDoc(doc(db, "finanzas-config", "descripciones"), { deposito: descDepositoList });
  } catch (e) {
    descDepositoList = descDepositoList.filter(v => v !== value); // revertir
    throw new Error("No se pudo guardar en Firestore: " + e.message);
  }
  return value;
}

// Carrier catalog — mismo patrón que descDepositoList.
async function loadCarriersList() {
  if (carriersList) return carriersList;
  try {
    const ref = doc(db, "finanzas-config", "carriers");
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data().list)) {
      carriersList = snap.data().list;
    } else {
      carriersList = [...CARRIERS_DEFAULT];
      await setDoc(ref, { list: carriersList });
    }
  } catch (e) {
    console.warn("No se pudo cargar carriers:", e.message);
    carriersList = [...CARRIERS_DEFAULT];
  }
  return carriersList;
}

async function addCarrierToList(rawValue) {
  const value = rawValue.trim();
  if (!value) throw new Error("El nombre no puede estar vacío.");
  const dupCI = carriersList.some(c => c.toLowerCase() === value.toLowerCase());
  if (dupCI) throw new Error(`"${value}" ya está en la lista.`);
  carriersList = [...carriersList, value].sort((a, b) => a.localeCompare(b, "es"));
  try {
    await setDoc(doc(db, "finanzas-config", "carriers"), { list: carriersList });
  } catch (e) {
    carriersList = carriersList.filter(v => v !== value); // revertir
    throw new Error("No se pudo guardar en Firestore: " + e.message);
  }
  return value;
}

// Estado de la Lista de Ingresos
let ingresosData = [];
let fiTable = null;
let ingresosInited = false;
const fiFilter = { text: "", periodo: "all", tipo: "all", categoria: "all", carrier: "all", broker: "all", fromDate: null, toDate: null };
let fiCustomPickers = null; // { fp1, fp2 }

function bindIngresosStaticHandlers() {
  const btn = document.getElementById("fi-add-btn");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => openIngresoModal(null));
  }

  const search = document.getElementById("fi-search");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", (e) => {
      fiFilter.text = e.target.value.toLowerCase().trim();
      applyFiFilters();
    });
  }

  // Filtros dropdown — periodo, tipo, categoria, carrier, broker
  ["periodo", "tipo", "categoria", "carrier", "broker"].forEach(key => {
    const sel = document.getElementById(`fi-filter-${key}`);
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = "1";
      sel.addEventListener("change", (e) => {
        fiFilter[key] = e.target.value;
        if (key === "periodo") toggleFiCustomRange(e.target.value === "custom");
        applyFiFilters();
      });
    }
  });
}

function toggleFiCustomRange(show) {
  const wrap = document.getElementById("fi-custom-range");
  if (!wrap) return;
  wrap.hidden = !show;
  if (show) ensureFiCustomPickers();
}

function ensureFiCustomPickers() {
  if (fiCustomPickers) return;
  const fromEl = document.getElementById("fi-date-from");
  const toEl = document.getElementById("fi-date-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;

  // Default: año actual completo (donde está la mayoría de la data)
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);

  const fp1 = flatpickr(fromEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: yearStart,
    onChange: ([d]) => {
      fiFilter.fromDate = d ? startOfDay(d) : null;
      if (d && fp2) fp2.set("minDate", d);
      applyFiFilters();
    }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: today,
    onChange: ([d]) => {
      fiFilter.toDate = d ? endOfDay(d) : null;
      if (d && fp1) fp1.set("maxDate", d);
      applyFiFilters();
    }
  });
  fiCustomPickers = { fp1, fp2 };

  // Aplicar los defaults iniciales como filtro
  fiFilter.fromDate = startOfDay(yearStart);
  fiFilter.toDate = endOfDay(today);
}

function bindIngresosLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="ingresos"]').forEach(b => {
    if (b.dataset.fiBound) return;
    b.dataset.fiBound = "1";
    b.addEventListener("click", () => {
      if (!ingresosInited) initIngresosPanel();
    });
  });
}

async function initIngresosPanel() {
  if (ingresosInited) return;
  ingresosInited = true;
  try {
    // Cargar brokers/agencias y carriers en paralelo para poblar filtros
    if (brokersData.length === 0) {
      try { await loadBrokers(); } catch (_) {}
    }
    try { await loadCarriersList(); } catch (_) {}
    if (!fiTable) initFiTable();
    await loadIngresos();
    fiTable.setData(ingresosData);
    populateBrokerFilter();
    populateCarrierFilter();
    updateIngresosSummary();
  } catch (e) {
    console.error("Error inicializando Ingresos:", e);
    ingresosInited = false;
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de "${INGRESOS_COL}". Verifica las reglas en Firebase Console.`
      : `No se pudo cargar la Lista de Ingresos:\n${e?.message || e}`;
    heroToast.error(msg, { duration: 6000 });
  }
  if (window.refreshIcons) window.refreshIcons();
}

async function loadIngresos() {
  const q = query(collection(db, INGRESOS_COL), orderBy("fecha", "desc"));
  const snap = await getDocs(q);
  ingresosData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function populateBrokerFilter() {
  const sel = document.getElementById("fi-filter-broker");
  if (!sel) return;
  const current = sel.value;
  // Agrupamos por tipo para que el destinatario sea navegable.
  const agencias = brokersData.filter(b => (b.tipo || "agencia") === "agencia")
    .map(b => b.nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
  const brokers = brokersData.filter(b => b.tipo === "broker")
    .map(b => b.nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
  const optGroup = (label, arr) => arr.length
    ? `<optgroup label="${escapeHtmlAttr(label)}">` + arr.map(n =>
        `<option value="${escapeHtmlAttr(n)}" ${n === current ? "selected" : ""}>${escapeHtml(n)}</option>`
      ).join("") + `</optgroup>`
    : "";
  sel.innerHTML = `<option value="all">Todos</option>` +
    optGroup("Agencias", agencias) + optGroup("Brokers/Agentes", brokers);
}

function populateCarrierFilter() {
  const sel = document.getElementById("fi-filter-carrier");
  if (!sel) return;
  const current = sel.value;
  // Combina el catálogo con los carriers que aparezcan en los datos (por si hay algún legacy).
  const set = new Set();
  (carriersList || []).forEach(c => set.add(c));
  ingresosData.forEach(r => { if (r.carrier) set.add(r.carrier); });
  const list = [...set].sort((a, b) => a.localeCompare(b, "es"));
  sel.innerHTML = `<option value="all">Todos</option>` +
    `<option value="__none__" ${current === "__none__" ? "selected" : ""}>(Sin carrier)</option>` +
    list.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === current ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
}

function initFiTable() {
  fiTable = new Tabulator("#fi-table", {
    index: "id",
    data: [],
    layout: "fitColumns",
    height: "560px",
    pagination: true,
    paginationSize: 25,
    paginationSizeSelector: [10, 25, 50, 100],
    initialSort: [{ column: "fecha", dir: "desc" }],
    placeholder: "No hay ingresos aún. Registra el primero con el botón “Nuevo ingreso”.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "ingresos", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Fecha",
        field: "fecha",
        width: 110,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? formatFechaUS(v) : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Desc. depósito",
        field: "descripcionDeposito",
        minWidth: 160,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<strong>${escapeHtml(v)}</strong>` : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Carrier",
        field: "carrier",
        width: 140,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<span class="fi-carrier-badge">${escapeHtml(v)}</span>` : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Categoría",
        field: "categoria",
        width: 130,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue() || "";
          if (!v) return `<span class="fc-empty">—</span>`;
          return `<span class="fi-cat-badge fi-cat-${escapeHtmlAttr(v)}">${escapeHtml(v)}</span>`;
        }
      },
      {
        title: "Tipo",
        field: "tipoPago",
        width: 100,
        sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? escapeHtml(v) : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Monto",
        field: "monto",
        width: 120,
        hozAlign: "right",
        headerHozAlign: "right",
        sorter: "number",
        formatter: (cell) => `<span class="fi-cell-money">${formatMoney(cell.getValue())}</span>`
      },
      {
        title: "Pagado",
        field: "pagado",
        width: 120,
        hozAlign: "right",
        headerHozAlign: "right",
        sorter: "number",
        formatter: (cell) => `<span class="fi-cell-money">${formatMoney(cell.getValue())}</span>`
      },
      {
        title: "Ganancia",
        field: "ganancia",
        width: 130,
        hozAlign: "right",
        headerHozAlign: "right",
        sorter: "number",
        formatter: (cell) => {
          const v = cell.getValue() || 0;
          const neg = v < 0 ? " negative" : "";
          return `<span class="fi-cell-money fi-cell-ganancia${neg}">${formatMoney(v)}</span>`;
        }
      },
      {
        title: "Payouts",
        field: "payouts",
        width: 90,
        hozAlign: "center",
        headerHozAlign: "center",
        headerSort: false,
        formatter: (cell) => {
          const arr = cell.getValue();
          const n = Array.isArray(arr) ? arr.length : 0;
          return n > 0 ? `<strong>${n}</strong>` : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "",
        field: "_actions",
        width: 120,
        hozAlign: "center",
        headerSort: false,
        formatter: (cell) => {
          const r = cell.getRow().getData();
          const hasPayouts = Array.isArray(r.payouts) && r.payouts.length > 0;
          // Tag verde si TODOS los payouts ya tienen emailSentAt
          const allSent = hasPayouts && r.payouts.every(p => p && p.emailSentAt);
          const emailBtnCls = "fc-act-btn fc-email" + (allSent ? " sent" : "");
          const emailTitle = allSent ? "Reportes enviados — reenviar" : "Enviar reporte a brokers";
          return `<div class="fc-actions">
            ${hasPayouts ? `<button class="${emailBtnCls}" data-id="${escapeHtmlAttr(r.id)}" title="${emailTitle}">✉</button>` : ""}
            <button class="fc-act-btn fc-edit" data-id="${escapeHtmlAttr(r.id)}" title="Editar">✎</button>
            <button class="fc-act-btn fc-del" data-id="${escapeHtmlAttr(r.id)}" title="Eliminar">✕</button>
          </div>`;
        }
      }
    ]
  });

  // Click en celda → editar (excepto si clickearon los botones)
  fiTable.on("cellClick", (e, cell) => {
    if (e.target.closest(".fc-actions")) return; // los botones manejan su propio click
    const row = cell.getRow().getData();
    openIngresoModal(row);
  });

  // Delegación para ✉, ✎ y ✕
  const tableEl = document.getElementById("fi-table");
  tableEl.addEventListener("click", (e) => {
    const emailBtn = e.target.closest(".fc-email");
    const editBtn = e.target.closest(".fc-edit");
    const delBtn = e.target.closest(".fc-del");
    if (emailBtn) { e.stopPropagation(); onEmailIngreso(emailBtn.dataset.id); }
    else if (editBtn) { e.stopPropagation(); onEditIngreso(editBtn.dataset.id); }
    else if (delBtn) { e.stopPropagation(); onDeleteIngreso(delBtn.dataset.id); }
  });

  // dataFiltered(filters, rows) → usamos los rows filtrados directamente en vez
  // de getData("active"), que puede llegar stale en el primer cambio de filtro.
  fiTable.on("dataFiltered", (_filters, rows) => {
    const data = Array.isArray(rows) ? rows.map(r => r.getData()) : null;
    updateIngresosSummary(data);
    updateIngresosPageInfo(data);
  });
  fiTable.on("dataLoaded", () => { updateIngresosSummary(); updateIngresosPageInfo(); });
  fiTable.on("pageLoaded", () => updateIngresosPageInfo());
}

// ─── Filtros ──────────────────────────────
function applyFiFilters() {
  if (!fiTable) return;
  fiTable.setFilter((row) => {
    if (fiFilter.tipo !== "all" && row.tipoPago !== fiFilter.tipo) return false;
    if (fiFilter.categoria !== "all" && row.categoria !== fiFilter.categoria) return false;
    if (fiFilter.periodo !== "all" && !matchesPeriodo(row.fecha, fiFilter.periodo)) return false;
    if (fiFilter.carrier !== "all") {
      if (fiFilter.carrier === "__none__") {
        if (row.carrier) return false;
      } else if (row.carrier !== fiFilter.carrier) {
        return false;
      }
    }
    if (fiFilter.broker !== "all") {
      const hasBroker = Array.isArray(row.payouts) && row.payouts.some(p => p.broker === fiFilter.broker);
      if (!hasBroker) return false;
    }
    if (fiFilter.text) {
      const hay = `${row.descripcionDeposito || ""} ${row.descripcionTransaccion || ""} ${row.carrier || ""} ${row.notas || ""}`.toLowerCase();
      if (!hay.includes(fiFilter.text)) return false;
    }
    return true;
  });
  // Actualizar summary de inmediato — dataFiltered puede llegar tarde en el primer cambio
  updateIngresosSummary();
  updateIngresosPageInfo();
}

function matchesPeriodo(fecha, periodo, fromDate = null, toDate = null) {
  if (!fecha) return false;
  const d = new Date(fecha + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  const m = d.getMonth();
  const cY = new Date().getFullYear();
  // Meses del año actual: valores "m-01" ... "m-12"
  if (typeof periodo === "string" && periodo.startsWith("m-")) {
    const targetMonth = parseInt(periodo.slice(2), 10) - 1;
    if (isNaN(targetMonth) || targetMonth < 0 || targetMonth > 11) return true;
    return y === cY && m === targetMonth;
  }
  if (periodo === "custom") {
    // Si el caller no pasó rango explícito, caemos al de fiFilter (compat con
    // el filtro de Ingresos que ya lo pasa vía este fallback).
    const from = fromDate || fiFilter.fromDate;
    const to = toDate || fiFilter.toDate;
    if (!from || !to) return true;
    return d >= from && d <= to;
  }
  return true;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function updateIngresosSummary(data) {
  const totalEl = document.getElementById("fi-sum-total");
  const brutoEl = document.getElementById("fi-sum-bruto");
  const pagadoEl = document.getElementById("fi-sum-pagado");
  const gananciaEl = document.getElementById("fi-sum-ganancia");
  if (!totalEl || !fiTable) return;

  // Preferimos la data ya filtrada que nos pasa Tabulator vía dataFiltered;
  // sino, caemos a getData("active") (que puede estar stale en el primer cambio).
  const visibleRows = Array.isArray(data) ? data : fiTable.getData("active");
  const total = visibleRows.length;
  const bruto = visibleRows.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
  const pagado = visibleRows.reduce((s, r) => s + (parseFloat(r.pagado) || 0), 0);
  const ganancia = visibleRows.reduce((s, r) => s + (parseFloat(r.ganancia) || 0), 0);

  totalEl.textContent = `${total}`;
  brutoEl.textContent = formatMoney(bruto);
  pagadoEl.textContent = formatMoney(pagado);
  gananciaEl.textContent = formatMoney(ganancia);
  gananciaEl.classList.toggle("negative", ganancia < 0);
}

function updateIngresosPageInfo(data) {
  const infoEl = document.getElementById("fi-page-info");
  if (!infoEl || !fiTable) return;

  const visibleRows = Array.isArray(data) ? data : fiTable.getData("active");
  const total = visibleRows.length;
  const pageSize = (typeof fiTable.getPageSize === "function" ? fiTable.getPageSize() : 25) || 25;
  const currentPage = (typeof fiTable.getPage === "function" ? fiTable.getPage() : 1) || 1;
  const maxPage = (typeof fiTable.getPageMax === "function" ? fiTable.getPageMax() : 1) || 1;

  if (total === 0 || maxPage <= 1) {
    infoEl.hidden = true;
    return;
  }
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  infoEl.textContent = `Mostrando ${start}–${end} de ${total} · Página ${currentPage} de ${maxPage}`;
  infoEl.hidden = false;
}

// ─── Edit / Delete ────────────────────────
function onEditIngreso(id) {
  const row = ingresosData.find(r => r.id === id);
  if (!row) return;
  openIngresoModal(row);
}

async function onDeleteIngreso(id) {
  const row = ingresosData.find(r => r.id === id);
  if (!row) return;
  const fechaTxt = row.fecha ? formatFechaUS(row.fecha) : "?";
  const label = `${fechaTxt} · ${row.descripcionDeposito || "?"} · ${formatMoney(row.monto)}`;
  const ok = await heroConfirm({
    title: "Eliminar ingreso",
    message: `¿Eliminar este ingreso? ${label}. Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, INGRESOS_COL, id));
  } catch (e) {
    heroToast.error("No se pudo eliminar: " + e.message);
    return;
  }

  logEvent(ACTIONS.FINANZAS_INGRESO_DELETE, row.fecha || id, {
    monto: row.monto, descDep: row.descripcionDeposito || null
  });

  ingresosData = ingresosData.filter(r => r.id !== id);
  if (fiTable) fiTable.deleteRow(id);
  updateIngresosSummary();
  showFiStatus(`✓ Ingreso eliminado`);
}

function formatFechaUS(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return yyyyMmDd || "";
  const [y, m, d] = yyyyMmDd.split("-");
  return `${m}/${d}/${y}`;
}

// ─── Email reports a brokers ──────────────
// El botón ✉ tiene dos modos según cuántos payouts tenga el ingreso:
//   - 1 payout: confirm nativo + envío directo (atajo para el caso común).
//   - 2+ payouts: modal con la lista de payouts, cada uno con su botón
//     "Enviar"/"Reenviar". Es el modal completo.
// El envío real lo hace el Worker (POST /finanzas/send-report); el frontend
// solo prepara payload, muestra estado y marca emailSentAt/emailSentTo en el
// payout al confirmar.
async function onEmailIngreso(id) {
  const row = ingresosData.find(r => r.id === id);
  if (!row) { showFiStatus("Ingreso no encontrado."); return; }
  if (!Array.isArray(row.payouts) || row.payouts.length === 0) {
    showFiStatus("Este ingreso no tiene payouts."); return;
  }
  // Asegura que tenemos los brokers cargados para resolver email por nombre.
  if (brokersData.length === 0) {
    try { await loadBrokers(); } catch (e) { console.warn("brokers load:", e); }
  }

  // Atajo: 1 payout → mini-dialog con email editable + envío directo.
  if (row.payouts.length === 1) {
    openSingleEmailDialog(row);
    return;
  }

  openEmailReportDialog(row);
}

// Regex laxo para sanity-check de email cliente (Resend hará la validación real).
function looksLikeEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

function openSingleEmailDialog(ingreso, payoutIdx = 0) {
  const payout = ingreso.payouts[payoutIdx];
  if (!payout) { showFiStatus("Payout no encontrado."); return; }
  const broker = brokersData.find(b => b.nombre === payout.broker) || { nombre: payout.broker || "", email: "" };
  const wasSent = !!payout.emailSentAt;
  const prefillEmail = broker.email || payout.emailSentTo || "";
  const fechaTxt = ingreso.fecha ? formatFechaUS(ingreso.fecha) : "—";

  const dialog = document.createElement("sl-dialog");
  dialog.label = (wasSent ? "Reenviar" : "Enviar") + " reporte de comisión";
  dialog.className = "fi-email-modal fi-email-single";
  dialog.innerHTML = `
    <div class="fi-em-body">
      <div class="fi-em-intro">
        <div class="fi-em-desc">${escapeHtml(ingreso.descripcionDeposito || "—")}</div>
        <div class="fi-em-meta">
          <span>${escapeHtml(fechaTxt)}</span>
          <span class="fi-em-meta-dot">·</span>
          <span>${escapeHtml(ingreso.tipoPago || "")}</span>
          <span class="fi-em-meta-dot">·</span>
          <span>${formatMoney(ingreso.monto)}</span>
        </div>
      </div>

      <div class="fi-em-single-payout">
        <div class="fi-em-single-broker">
          <span class="fi-em-single-broker-lbl">Broker</span>
          <span class="fi-em-single-broker-val">${escapeHtml(broker.nombre || "(sin broker)")}</span>
        </div>
        <div class="fi-em-single-saldo">
          <span class="fi-em-single-saldo-lbl">Payout</span>
          <span class="fi-em-single-saldo-val">${formatMoney(payout.saldo)}</span>
        </div>
      </div>

      <sl-input
        id="fi-em-single-email"
        label="Enviar a"
        type="email"
        placeholder="broker@ejemplo.com"
        value="${escapeHtmlAttr(prefillEmail)}"
        help-text="Pre-llenado con el email del broker si existe. Puedes cambiarlo solo para este envío."
        clearable
        required>
      </sl-input>

      ${wasSent ? `<div class="fi-em-resend-note">Este reporte ya fue enviado el ${escapeHtml(formatFechaUS((payout.emailSentAt || "").slice(0, 10)))} a <strong>${escapeHtml(payout.emailSentTo || "")}</strong>.</div>` : ""}

      <div class="fi-em-status" id="fi-em-single-status"></div>
    </div>
    <sl-button slot="footer" class="fi-em-cancel-btn" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" class="fi-em-confirm-btn" variant="primary">${wasSent ? "Reenviar" : "Enviar"}</sl-button>
  `;

  document.body.appendChild(dialog);
  dialog.show();

  const emailInput = dialog.querySelector("#fi-em-single-email");
  const statusEl = dialog.querySelector("#fi-em-single-status");
  const confirmBtn = dialog.querySelector(".fi-em-confirm-btn");
  const cancelBtn = dialog.querySelector(".fi-em-cancel-btn");

  cancelBtn.addEventListener("click", () => dialog.hide());
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  confirmBtn.addEventListener("click", async () => {
    const email = String(emailInput.value || "").trim();
    if (!looksLikeEmail(email)) {
      statusEl.className = "fi-em-status error";
      statusEl.textContent = "Email inválido. Verifica el formato.";
      emailInput.focus();
      return;
    }
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = "Enviando…";
    statusEl.className = "fi-em-status";
    statusEl.textContent = "";
    try {
      await sendIngresoEmail(ingreso, payoutIdx, { nombre: broker.nombre, email });
      statusEl.className = "fi-em-status success";
      statusEl.textContent = `✓ Reporte enviado a ${email}`;
      showFiStatus(`✓ Reporte enviado a ${email}`);
      setTimeout(() => dialog.hide(), 900);
    } catch (err) {
      statusEl.className = "fi-em-status error";
      statusEl.textContent = "✕ " + (err?.message || "No se pudo enviar");
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = wasSent ? "Reenviar" : "Enviar";
    }
  });
}

function openEmailReportDialog(ingreso) {
  const dialog = document.createElement("sl-dialog");
  dialog.label = "Enviar reporte a brokers";
  dialog.className = "fi-email-modal";

  const rowsHtml = ingreso.payouts.map((p, i) => {
    const broker = brokersData.find(b => b.nombre === p.broker);
    const prefill = broker?.email || p.emailSentTo || "";
    const sent = !!p.emailSentAt;
    const sentDate = sent ? formatFechaUS((p.emailSentAt || "").slice(0, 10)) : "";
    const statusTag = sent
      ? `<span class="fi-em-sent-tag">Enviado · ${escapeHtml(sentDate)}</span>`
      : "";
    return `
      <div class="fi-em-row${sent ? " sent" : ""}" data-idx="${i}">
        <div class="fi-em-row-main">
          <div class="fi-em-broker">${escapeHtml(p.broker || "(sin broker)")}</div>
          <input
            type="email"
            class="fi-em-email-input"
            data-idx="${i}"
            value="${escapeHtmlAttr(prefill)}"
            placeholder="broker@ejemplo.com"
            autocomplete="off"
          />
        </div>
        <div class="fi-em-row-side">
          <div class="fi-em-saldo">${formatMoney(p.saldo)}</div>
          <div class="fi-em-status-cell">${statusTag}</div>
          <button type="button" class="fi-em-send-btn" data-idx="${i}">
            ${sent ? "Reenviar" : "Enviar"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  dialog.innerHTML = `
    <div class="fi-em-body">
      <div class="fi-em-intro">
        <div class="fi-em-desc">${escapeHtml(ingreso.descripcionDeposito || "—")}</div>
        <div class="fi-em-meta">
          <span>${formatFechaUS(ingreso.fecha)}</span>
          <span class="fi-em-meta-dot">·</span>
          <span>${escapeHtml(ingreso.tipoPago || "")}</span>
          <span class="fi-em-meta-dot">·</span>
          <span>${formatMoney(ingreso.monto)}</span>
        </div>
      </div>
      <div class="fi-em-list">${rowsHtml}</div>
      <div class="fi-em-status" id="fi-em-modal-status"></div>
    </div>
    <sl-button slot="footer" class="fi-em-close-btn" variant="default">Cerrar</sl-button>
  `;

  document.body.appendChild(dialog);
  dialog.show();
  dialog.querySelector(".fi-em-close-btn").addEventListener("click", () => dialog.hide());
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelectorAll(".fi-em-send-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const payout = ingreso.payouts[idx];
      const broker = brokersData.find(b => b.nombre === payout.broker)
                  || { nombre: payout.broker || "", email: "" };
      const statusEl = dialog.querySelector("#fi-em-modal-status");
      const inputEl = dialog.querySelector(`.fi-em-email-input[data-idx="${idx}"]`);
      const email = String(inputEl?.value || "").trim();
      const wasSent = !!payout.emailSentAt;

      if (!looksLikeEmail(email)) {
        statusEl.className = "fi-em-status error";
        statusEl.textContent = "Email inválido para " + (broker.nombre || "este payout") + ".";
        inputEl?.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = "Enviando…";
      statusEl.className = "fi-em-status";
      statusEl.textContent = "";

      try {
        await sendIngresoEmail(ingreso, idx, { nombre: broker.nombre, email });
        const rowEl = dialog.querySelector(`.fi-em-row[data-idx="${idx}"]`);
        rowEl.classList.add("sent");
        const cellEl = rowEl.querySelector(".fi-em-status-cell");
        const nowTxt = formatFechaUS(new Date().toISOString().slice(0, 10));
        cellEl.innerHTML = `<span class="fi-em-sent-tag">Enviado · ${escapeHtml(nowTxt)}</span>`;
        btn.textContent = "Reenviar";
        statusEl.className = "fi-em-status success";
        statusEl.textContent = "✓ Reporte enviado a " + email;
      } catch (err) {
        statusEl.className = "fi-em-status error";
        statusEl.textContent = "✕ " + (err?.message || "No se pudo enviar el reporte");
        btn.textContent = wasSent ? "Reenviar" : "Enviar";
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function sendIngresoEmail(ingreso, payoutIdx, broker) {
  const payout = ingreso.payouts[payoutIdx];
  if (!payout) throw new Error("Payout no encontrado");
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión activa");

  let idToken;
  try { idToken = await user.getIdToken(); }
  catch (e) { throw new Error("No se pudo obtener tu sesión: " + (e.message || e)); }

  const payload = {
    idToken,
    ingreso: {
      fecha: ingreso.fecha || "",
      mes: ingreso.mes || "",
      descripcionDeposito: ingreso.descripcionDeposito || "",
      tipoPago: ingreso.tipoPago || "",
      categoria: ingreso.categoria || "",
      monto: Number(ingreso.monto) || 0,
    },
    payout: {
      broker: payout.broker || "",
      saldo: Number(payout.saldo) || 0,
      reporteFile: payout.reporteFile || "",
    },
    broker: { nombre: broker.nombre || "", email: broker.email || "" },
  };

  let resp;
  try {
    resp = await fetch(FINANZAS_WORKER_URL + "/finanzas/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error("Red caída: " + (e.message || e));
  }
  let data = {};
  try { data = await resp.json(); } catch (_) {}
  if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));

  // Persistir emailSentAt en el payout del doc Firestore.
  const now = new Date().toISOString();
  const newPayouts = ingreso.payouts.map((p, i) =>
    i === payoutIdx ? { ...p, emailSentAt: now, emailSentTo: broker.email } : p
  );
  try {
    await updateDoc(doc(db, INGRESOS_COL, ingreso.id), {
      payouts: newPayouts,
      actualizadoPor: user.email,
      actualizadoEn: serverTimestamp(),
    });
  } catch (e) {
    // El email salió, pero falló persistir el flag. Lo notamos sin romper la UX.
    console.warn("payout flag persist failed:", e);
  }

  // Sincronizar estado local + Tabulator
  const idx = ingresosData.findIndex(r => r.id === ingreso.id);
  if (idx >= 0) {
    ingresosData[idx].payouts = newPayouts;
    ingreso.payouts = newPayouts; // mutamos también el ref pasado al modal
    if (fiTable) {
      try { fiTable.updateRow(ingreso.id, { payouts: newPayouts }); } catch (_) {}
    }
  }

  // Audit log
  logEvent(ACTIONS.FINANZAS_EMAIL_SEND, broker.email, {
    ingresoId: ingreso.id,
    fecha: ingreso.fecha || "",
    descripcionDeposito: ingreso.descripcionDeposito || "",
    broker: broker.nombre,
    saldo: Number(payout.saldo) || 0,
    resendId: data.id || null,
  });

  return data;
}


// ═══════════════════════════════════════════════════════════
// REPORTES DE PAGO — CRUD Firestore + tabla + wizard
// ═══════════════════════════════════════════════════════════
// Un reporte agrupa payouts de varios ingresos destinados a un mismo
// destinatario (agencia o broker/agente) para consolidar el pago real.
// Numeración: RP-YYYY-### con correlativo anual guardado en
// finanzas-config/reportes-contador vía runTransaction.
const REPORTES_COL = "finanzas-reportes-pago";
const REPORTES_CONTADOR_DOC = "reportes-contador";
const REPORTE_ESTADOS = ["borrador", "enviado", "pagado"];
const REPORTE_ESTADO_LABEL = { borrador: "Borrador", enviado: "Enviado", pagado: "Pagado" };

let reportesData = [];
let frTable = null;
let reportesInited = false;
const frFilter = { text: "", estado: "all", destinatario: "all", periodo: "all", fromDate: null, toDate: null };
let frCustomPickers = null;

function bindReportesStaticHandlers() {
  const addBtn = document.getElementById("fr-add-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => openReporteWizard(null));
  }
  const search = document.getElementById("fr-search");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", (e) => {
      frFilter.text = e.target.value.toLowerCase().trim();
      applyFrFilters();
    });
  }
  ["estado", "destinatario", "periodo"].forEach(key => {
    const sel = document.getElementById(`fr-filter-${key}`);
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = "1";
      sel.addEventListener("change", (e) => {
        frFilter[key] = e.target.value;
        if (key === "periodo") toggleFrCustomRange(e.target.value === "custom");
        applyFrFilters();
      });
    }
  });
}

function toggleFrCustomRange(show) {
  const wrap = document.getElementById("fr-custom-range");
  if (!wrap) return;
  wrap.hidden = !show;
  if (show) ensureFrCustomPickers();
}

function ensureFrCustomPickers() {
  if (frCustomPickers) return;
  const fromEl = document.getElementById("fr-date-from");
  const toEl = document.getElementById("fr-date-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const fp1 = flatpickr(fromEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: yearStart,
    onChange: ([d]) => { frFilter.fromDate = d ? startOfDay(d) : null; if (d && fp2) fp2.set("minDate", d); applyFrFilters(); }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: today,
    onChange: ([d]) => { frFilter.toDate = d ? endOfDay(d) : null; if (d && fp1) fp1.set("maxDate", d); applyFrFilters(); }
  });
  frCustomPickers = { fp1, fp2 };
  frFilter.fromDate = startOfDay(yearStart);
  frFilter.toDate = endOfDay(today);
}

function bindReportesLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="reportes"]').forEach(b => {
    if (b.dataset.frBound) return;
    b.dataset.frBound = "1";
    b.addEventListener("click", () => {
      if (!reportesInited) initReportesPanel();
    });
  });
}

async function initReportesPanel() {
  if (reportesInited) return;
  reportesInited = true;
  try {
    if (brokersData.length === 0) { try { await loadBrokers(); } catch (_) {} }
    if (!frTable) initFrTable();
    await loadReportes();
    frTable.setData(reportesData);
    populateReporteDestinatarioFilter();
    updateReportesSummary();
  } catch (e) {
    console.error("Error inicializando Reportes:", e);
    reportesInited = false;
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de "${REPORTES_COL}". Verifica las reglas en Firebase Console.`
      : `No se pudo cargar Reportes:\n${e?.message || e}`;
    heroToast.error(msg, { duration: 6000 });
  }
  if (window.refreshIcons) window.refreshIcons();
}

async function loadReportes() {
  const q = query(collection(db, REPORTES_COL), orderBy("fechaGeneracion", "desc"));
  const snap = await getDocs(q);
  reportesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function populateReporteDestinatarioFilter() {
  const sel = document.getElementById("fr-filter-destinatario");
  if (!sel) return;
  const current = sel.value;
  const set = new Set();
  reportesData.forEach(r => { if (r.destinatarioNombre) set.add(r.destinatarioNombre); });
  const list = [...set].sort((a, b) => a.localeCompare(b, "es"));
  const opts = [`<option value="all">Todos</option>`]
    .concat(list.map(t => `<option value="${escapeHtmlAttr(t)}" ${t === current ? "selected" : ""}>${escapeHtml(t)}</option>`))
    .join("");
  sel.innerHTML = opts;
}

function estadoBadge(estado) {
  const label = REPORTE_ESTADO_LABEL[estado] || estado || "—";
  const cls = `fr-badge fr-badge-${estado || "borrador"}`;
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function initFrTable() {
  frTable = new Tabulator("#fr-table", {
    index: "id",
    data: [],
    layout: "fitColumns",
    height: "560px",
    pagination: true,
    paginationSize: 25,
    paginationSizeSelector: [10, 25, 50, 100],
    initialSort: [{ column: "fechaGeneracion", dir: "desc" }],
    placeholder: "Aún no hay reportes de pago. Crea el primero con el botón “Nuevo reporte”.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "reportes", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "# Reporte", field: "numeroReporte", width: 140, sorter: "string",
        formatter: (cell) => `<strong>${escapeHtml(cell.getValue() || "—")}</strong>`
      },
      {
        title: "Fecha", field: "fechaGeneracion", width: 110, sorter: "string",
        formatter: (cell) => {
          const v = cell.getValue();
          if (!v) return `<span class="fc-empty">—</span>`;
          const iso = typeof v === "string" ? v.slice(0, 10) : (v.toDate ? v.toDate().toISOString().slice(0, 10) : "");
          return iso ? formatFechaUS(iso) : `<span class="fc-empty">—</span>`;
        }
      },
      {
        title: "Destinatario", field: "destinatarioNombre", minWidth: 200, sorter: "string",
        formatter: (cell) => {
          const r = cell.getRow().getData();
          const tipo = r.destinatarioTipo === "broker" ? "Broker" : "Agencia";
          const cls = r.destinatarioTipo === "broker" ? "broker" : "agencia";
          return `<div class="fr-dest"><strong>${escapeHtml(cell.getValue() || "—")}</strong><span class="fb-tipo-badge fb-tipo-${cls}">${tipo}</span></div>`;
        }
      },
      {
        title: "Periodo", field: "periodo", width: 170, headerSort: false,
        formatter: (cell) => {
          const p = cell.getValue();
          if (!p || !p.desde || !p.hasta) return `<span class="fc-empty">—</span>`;
          return `<span class="fr-periodo">${formatFechaUS(p.desde)} → ${formatFechaUS(p.hasta)}</span>`;
        }
      },
      {
        title: "# Ingresos", field: "ingresos", width: 100, hozAlign: "center", headerHozAlign: "center", headerSort: false,
        formatter: (cell) => {
          const arr = cell.getValue();
          return Array.isArray(arr) ? String(arr.length) : "0";
        }
      },
      {
        title: "Total", field: "totalPayout", width: 140, hozAlign: "right", headerHozAlign: "right", sorter: "number",
        formatter: (cell) => `<span class="fi-cell-money">${formatMoney(cell.getValue())}</span>`
      },
      {
        title: "Estado", field: "estado", width: 120, sorter: "string",
        formatter: (cell) => estadoBadge(cell.getValue())
      },
      {
        title: "", field: "_actions", width: 130, hozAlign: "center", headerSort: false,
        formatter: (cell) => {
          const r = cell.getRow().getData();
          const canEdit = r.estado === "borrador";
          return `<div class="fc-actions">
            <button class="fc-act-btn fr-view" data-id="${escapeHtmlAttr(r.id)}" title="Ver reporte">👁</button>
            ${canEdit ? `<button class="fc-act-btn fc-edit" data-id="${escapeHtmlAttr(r.id)}" title="Editar">✎</button>` : ""}
            ${canEdit ? `<button class="fc-act-btn fc-del" data-id="${escapeHtmlAttr(r.id)}" title="Eliminar">✕</button>` : ""}
          </div>`;
        }
      }
    ]
  });

  const tableEl = document.getElementById("fr-table");
  tableEl.addEventListener("click", (e) => {
    const viewBtn = e.target.closest(".fr-view");
    const editBtn = e.target.closest(".fc-edit");
    const delBtn = e.target.closest(".fc-del");
    if (viewBtn) { e.stopPropagation(); onViewReporte(viewBtn.dataset.id); }
    else if (editBtn) { e.stopPropagation(); onEditReporte(editBtn.dataset.id); }
    else if (delBtn) { e.stopPropagation(); onDeleteReporte(delBtn.dataset.id); }
  });

  frTable.on("dataFiltered", (_filters, rows) => {
    const data = Array.isArray(rows) ? rows.map(r => r.getData()) : null;
    updateReportesSummary(data);
  });
  frTable.on("dataLoaded", () => updateReportesSummary());
}

function applyFrFilters() {
  if (!frTable) return;
  frTable.setFilter((row) => {
    if (frFilter.estado !== "all" && row.estado !== frFilter.estado) return false;
    if (frFilter.destinatario !== "all" && row.destinatarioNombre !== frFilter.destinatario) return false;
    if (frFilter.periodo !== "all") {
      const iso = row.fechaGeneracion && typeof row.fechaGeneracion === "string"
        ? row.fechaGeneracion.slice(0, 10)
        : (row.fechaGeneracion?.toDate ? row.fechaGeneracion.toDate().toISOString().slice(0, 10) : "");
      if (!matchesPeriodo(iso, frFilter.periodo, frFilter.fromDate, frFilter.toDate)) return false;
    }
    if (frFilter.text) {
      const hay = `${row.numeroReporte || ""} ${row.destinatarioNombre || ""} ${row.referenciaPago || ""} ${row.notas || ""}`.toLowerCase();
      if (!hay.includes(frFilter.text)) return false;
    }
    return true;
  });
  updateReportesSummary();
}

function updateReportesSummary(data) {
  const totalEl = document.getElementById("fr-sum-total");
  const montoEl = document.getElementById("fr-sum-monto");
  if (!totalEl || !frTable) return;
  const visibleRows = Array.isArray(data) ? data : frTable.getData("active");
  const total = visibleRows.length;
  const monto = visibleRows.reduce((s, r) => s + (parseFloat(r.totalPayout) || 0), 0);
  totalEl.textContent = String(total);
  montoEl.textContent = formatMoney(monto);
}

// ─── Correlativo transaccional RP-YYYY-### ────────────────
// Corre en runTransaction para evitar colisiones si dos usuarios generan
// reportes al mismo tiempo. El doc guarda { year, seq } y avanza a partir
// del año actual (reinicia a 1 si cambia el año).
async function nextNumeroReporte() {
  const ref = doc(db, "finanzas-config", REPORTES_CONTADOR_DOC);
  const currentYear = new Date().getFullYear();
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    let next;
    if (!snap.exists()) {
      next = { year: currentYear, seq: 1 };
    } else {
      const data = snap.data() || {};
      if (data.year === currentYear) next = { year: currentYear, seq: (Number(data.seq) || 0) + 1 };
      else next = { year: currentYear, seq: 1 };
    }
    tx.set(ref, next);
    return next.seq;
  });
  return `RP-${currentYear}-${String(seq).padStart(3, "0")}`;
}

// ─── Handlers de acciones (placeholders skeleton) ──────────
// El wizard completo y las acciones view/edit/delete llegan en el próximo
// commit — de momento avisamos al usuario para que sepa que está en construcción.
async function openReporteWizard(_existing) {
  heroToast.info("El wizard de generación de reportes llega en el próximo bump. Skeleton listo, wizard en construcción.", { duration: 4500 });
}

function onViewReporte(_id) {
  heroToast.info("Vista de detalle en construcción.", { duration: 3000 });
}

function onEditReporte(_id) {
  heroToast.info("Edición en construcción.", { duration: 3000 });
}

function onDeleteReporte(_id) {
  heroToast.info("Eliminación en construcción.", { duration: 3000 });
}

let frStatusTimeout = null;
// eslint-disable-next-line no-unused-vars
function showFrStatus(msg) {
  const el = document.getElementById("fr-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  if (frStatusTimeout) clearTimeout(frStatusTimeout);
  frStatusTimeout = setTimeout(() => el.classList.remove("visible"), 3000);
}


// ═══════════════════════════════════════════════════════════
// DASHBOARD — KPIs + gráficos con Chart.js
// ═══════════════════════════════════════════════════════════
let fdInited = false;
const fdCharts = {};
const fdState = { periodo: "all", fromDate: null, toDate: null };
let fdCustomPickers = null;

const FD_PALETTE = ["#06a3b6", "#22a06b", "#e8a317", "#0891a3", "#9333ea",
                    "#c0392b", "#0065F3", "#1e8456", "#946614", "#5b21b6",
                    "#7f1d1d", "#0a3d4a"];

function bindDashboardStaticHandlers() {
  const periodSel = document.getElementById("fd-period");
  if (periodSel && !periodSel.dataset.bound) {
    periodSel.dataset.bound = "1";
    periodSel.addEventListener("change", (e) => {
      fdState.periodo = e.target.value;
      toggleFdCustomRange(e.target.value === "custom");
      if (fdInited) renderDashboard();
    });
  }

  const refreshBtn = document.getElementById("fd-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", async () => {
      try {
        await loadIngresos();
        // Si la lista ya estaba inicializada, refresca también su tabla
        if (fiTable) { fiTable.setData(ingresosData); updateIngresosSummary(); }
        renderDashboard();
      } catch (e) {
        heroToast.error("No se pudo actualizar: " + e.message);
      }
    });
  }
}

function bindDashboardLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="dashboard"]').forEach(b => {
    if (b.dataset.fdBound) return;
    b.dataset.fdBound = "1";
    b.addEventListener("click", () => {
      if (!fdInited) initDashboardPanel();
    });
  });
}

async function initDashboardPanel() {
  if (fdInited) return;
  fdInited = true;
  try {
    if (ingresosData.length === 0) await loadIngresos();
    renderDashboard();
  } catch (e) {
    console.error("Error inicializando Dashboard:", e);
    fdInited = false;
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de "${INGRESOS_COL}". Verifica las reglas.`
      : `No se pudo cargar el Dashboard:\n${e?.message || e}`;
    heroToast.error(msg, { duration: 6000 });
  }
}

function filterByPeriodo(rows, periodo, fromDate = null, toDate = null) {
  if (periodo === "all") return rows;
  const cY = new Date().getFullYear();

  return rows.filter(r => {
    if (!r.fecha) return false;
    const d = new Date(r.fecha + "T00:00:00");
    if (isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const m = d.getMonth();
    if (typeof periodo === "string" && periodo.startsWith("m-")) {
      const targetMonth = parseInt(periodo.slice(2), 10) - 1;
      if (isNaN(targetMonth) || targetMonth < 0 || targetMonth > 11) return true;
      return y === cY && m === targetMonth;
    }
    if (periodo === "custom") {
      if (!fromDate || !toDate) return true;
      return d >= fromDate && d <= toDate;
    }
    return true;
  });
}

function toggleFdCustomRange(show) {
  const wrap = document.getElementById("fd-custom-range");
  if (!wrap) return;
  wrap.hidden = !show;
  if (show) ensureFdCustomPickers();
}

function ensureFdCustomPickers() {
  if (fdCustomPickers) return;
  const fromEl = document.getElementById("fd-date-from");
  const toEl = document.getElementById("fd-date-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;

  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);

  const fp1 = flatpickr(fromEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: yearStart,
    onChange: ([d]) => {
      fdState.fromDate = d ? startOfDay(d) : null;
      if (d && fp2) fp2.set("minDate", d);
      if (fdInited) renderDashboard();
    }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es",
    dateFormat: "m/d/Y",
    defaultDate: today,
    onChange: ([d]) => {
      fdState.toDate = d ? endOfDay(d) : null;
      if (d && fp1) fp1.set("maxDate", d);
      if (fdInited) renderDashboard();
    }
  });
  fdCustomPickers = { fp1, fp2 };

  fdState.fromDate = startOfDay(yearStart);
  fdState.toDate = endOfDay(today);
}

function renderDashboard() {
  const data = filterByPeriodo(ingresosData, fdState.periodo, fdState.fromDate, fdState.toDate);

  // KPIs
  const bruto = data.reduce((s, r) => s + (Number(r.monto) || 0), 0);
  const pagado = data.reduce((s, r) => s + (Number(r.pagado) || 0), 0);
  const ganancia = data.reduce((s, r) => s + (Number(r.ganancia) || 0), 0);
  const count = data.length;
  const withPayouts = data.filter(r => Array.isArray(r.payouts) && r.payouts.length > 0).length;

  setText("fd-kpi-bruto", formatMoney(bruto));
  setText("fd-kpi-pagado", formatMoney(pagado));
  setText("fd-kpi-ganancia", formatMoney(ganancia));
  const gananciaEl = document.getElementById("fd-kpi-ganancia");
  if (gananciaEl) gananciaEl.classList.toggle("negative", ganancia < 0);
  setText("fd-kpi-count", String(count));
  setText("fd-kpi-count-sub", `${withPayouts} con payouts`);

  // Charts
  renderMonthlyChart(data);
  renderCategoriaChart(data);
  renderCarriersChart(data);
  renderBrokersChart(data);
}

function destroyChart(key) {
  if (fdCharts[key]) {
    fdCharts[key].destroy();
    delete fdCharts[key];
  }
}

function setEmpty(key, isEmpty) {
  const el = document.getElementById(`fd-chart-${key}-empty`);
  if (el) el.style.display = isEmpty ? "" : "none";
}

function monthSortKey(mesStr) {
  // "ENE 2026" → 2026.01 (sortable number)
  if (!mesStr) return 0;
  const [m, y] = mesStr.split(" ");
  const idx = MESES_ABREV.indexOf(m);
  if (idx < 0) return 0;
  return parseInt(y, 10) * 100 + (idx + 1);
}

function getChartTextColor() {
  return document.body.dataset.theme === "dark" ? "#e8f4f6" : "#0a3d4a";
}
function getChartGridColor() {
  return document.body.dataset.theme === "dark" ? "rgba(255,255,255,.08)" : "rgba(10,61,74,.10)";
}

function renderMonthlyChart(data) {
  destroyChart("monthly");
  const byMonth = {};
  for (const r of data) {
    if (!r.mes) continue;
    if (!byMonth[r.mes]) byMonth[r.mes] = { bruto: 0, ganancia: 0 };
    byMonth[r.mes].bruto += Number(r.monto) || 0;
    byMonth[r.mes].ganancia += Number(r.ganancia) || 0;
  }
  const meses = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  setEmpty("monthly", meses.length === 0);
  if (meses.length === 0) return;

  const ctx = document.getElementById("fd-chart-monthly");
  fdCharts.monthly = new Chart(ctx, {
    type: "line",
    data: {
      labels: meses,
      datasets: [
        {
          label: "Bruto",
          data: meses.map(m => byMonth[m].bruto),
          borderColor: "#06a3b6",
          backgroundColor: "rgba(6,163,182,.10)",
          tension: 0.3,
          fill: true,
          borderWidth: 2.5
        },
        {
          label: "Ganancia",
          data: meses.map(m => byMonth[m].ganancia),
          borderColor: "#22a06b",
          backgroundColor: "rgba(34,160,107,.10)",
          tension: 0.3,
          fill: true,
          borderWidth: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: getChartTextColor(), font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() } },
        y: {
          ticks: { color: getChartTextColor(), callback: v => formatMoneyShort(v) },
          grid: { color: getChartGridColor() },
          beginAtZero: true
        }
      }
    }
  });
}

function renderCategoriaChart(data) {
  destroyChart("categoria");
  const byCat = {};
  for (const r of data) {
    const cat = r.categoria || "—";
    byCat[cat] = (byCat[cat] || 0) + (Number(r.monto) || 0);
  }
  const labels = Object.keys(byCat);
  setEmpty("categoria", labels.length === 0);
  if (labels.length === 0) return;

  const colorMap = { COMISSION: "#22a06b", OVERRIDES: "#e8a317", HERO: "#06a3b6" };
  const colors = labels.map(l => colorMap[l] || "#64748b");

  const ctx = document.getElementById("fd-chart-categoria");
  fdCharts.categoria = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: labels.map(l => byCat[l]), backgroundColor: colors, borderWidth: 2, borderColor: document.body.dataset.theme === "dark" ? "#0f2a33" : "#fff" }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { color: getChartTextColor(), font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${formatMoney(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderCarriersChart(data) {
  destroyChart("carriers");
  const byCarrier = {};
  for (const r of data) {
    const c = r.descripcionDeposito || "—";
    byCarrier[c] = (byCarrier[c] || 0) + (Number(r.monto) || 0);
  }
  const sorted = Object.entries(byCarrier).sort((a, b) => b[1] - a[1]).slice(0, 10);
  setEmpty("carriers", sorted.length === 0);
  if (sorted.length === 0) return;

  const ctx = document.getElementById("fd-chart-carriers");
  fdCharts.carriers = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([c]) => c),
      datasets: [{
        label: "Bruto",
        data: sorted.map(([, v]) => v),
        backgroundColor: "rgba(6,163,182,.7)",
        borderColor: "#06a3b6",
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => formatMoney(ctx.parsed.x) } }
      },
      scales: {
        x: { ticks: { color: getChartTextColor(), callback: v => formatMoneyShort(v) }, grid: { color: getChartGridColor() }, beginAtZero: true },
        y: { ticks: { color: getChartTextColor(), font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

function renderBrokersChart(data) {
  destroyChart("brokers");
  const byBroker = {};
  for (const r of data) {
    if (!Array.isArray(r.payouts)) continue;
    for (const p of r.payouts) {
      const b = p.broker || "—";
      byBroker[b] = (byBroker[b] || 0) + (Number(p.saldo) || 0);
    }
  }
  // Top 8 brokers + "Otros" si hay más
  let entries = Object.entries(byBroker).sort((a, b) => b[1] - a[1]);
  if (entries.length > 8) {
    const top = entries.slice(0, 8);
    const otros = entries.slice(8).reduce((s, [, v]) => s + v, 0);
    entries = [...top, ["Otros", otros]];
  }
  setEmpty("brokers", entries.length === 0);
  if (entries.length === 0) return;

  const ctx = document.getElementById("fd-chart-brokers");
  fdCharts.brokers = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: entries.map(([b]) => b),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => FD_PALETTE[i % FD_PALETTE.length]),
        borderWidth: 2,
        borderColor: document.body.dataset.theme === "dark" ? "#0f2a33" : "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { position: "right", labels: { color: getChartTextColor(), font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${formatMoney(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatMoneyShort(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}


// ═══════════════════════════════════════════════════════════
// COMPARATIVAS — 3 gráficos: bar agrupado mes a mes,
// líneas por tipoPago, stacked bar de payouts por broker.
// ═══════════════════════════════════════════════════════════
let fcompInited = false;
const fcompCharts = {};
const fcompState = { periodo: "all", fromDate: null, toDate: null };
let fcompCustomPickers = null;

function bindComparativasStaticHandlers() {
  const periodSel = document.getElementById("fcomp-period");
  if (periodSel && !periodSel.dataset.bound) {
    periodSel.dataset.bound = "1";
    periodSel.addEventListener("change", (e) => {
      fcompState.periodo = e.target.value;
      toggleFcompCustomRange(e.target.value === "custom");
      if (fcompInited) renderComparativas();
    });
  }
}

function bindComparativasLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="comparativas"]').forEach(b => {
    if (b.dataset.fcompBound) return;
    b.dataset.fcompBound = "1";
    b.addEventListener("click", () => {
      if (!fcompInited) initComparativasPanel();
    });
  });
}

async function initComparativasPanel() {
  if (fcompInited) return;
  fcompInited = true;
  try {
    if (ingresosData.length === 0) await loadIngresos();
    renderComparativas();
  } catch (e) {
    console.error("Error inicializando Comparativas:", e);
    fcompInited = false;
    heroToast.error(`No se pudo cargar Comparativas: ${e?.message || e}`, { duration: 6000 });
  }
}

function toggleFcompCustomRange(show) {
  const wrap = document.getElementById("fcomp-custom-range");
  if (!wrap) return;
  wrap.hidden = !show;
  if (show) ensureFcompCustomPickers();
}

function ensureFcompCustomPickers() {
  if (fcompCustomPickers) return;
  const fromEl = document.getElementById("fcomp-date-from");
  const toEl = document.getElementById("fcomp-date-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const fp1 = flatpickr(fromEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: yearStart,
    onChange: ([d]) => { fcompState.fromDate = d ? startOfDay(d) : null; if (d && fp2) fp2.set("minDate", d); if (fcompInited) renderComparativas(); }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: today,
    onChange: ([d]) => { fcompState.toDate = d ? endOfDay(d) : null; if (d && fp1) fp1.set("maxDate", d); if (fcompInited) renderComparativas(); }
  });
  fcompCustomPickers = { fp1, fp2 };
  fcompState.fromDate = startOfDay(yearStart);
  fcompState.toDate = endOfDay(today);
}

function renderComparativas() {
  const data = filterByPeriodo(ingresosData, fcompState.periodo, fcompState.fromDate, fcompState.toDate);
  renderCompMonthlyBars(data);
  renderCompTipoLines(data);
  renderCompBrokerStack(data);
}

function destroyFcompChart(key) {
  if (fcompCharts[key]) { fcompCharts[key].destroy(); delete fcompCharts[key]; }
}

function renderCompMonthlyBars(data) {
  destroyFcompChart("bars");
  const byMonth = {};
  for (const r of data) {
    if (!r.mes) continue;
    if (!byMonth[r.mes]) byMonth[r.mes] = { bruto: 0, pagado: 0, ganancia: 0 };
    byMonth[r.mes].bruto += Number(r.monto) || 0;
    byMonth[r.mes].pagado += Number(r.pagado) || 0;
    byMonth[r.mes].ganancia += Number(r.ganancia) || 0;
  }
  const meses = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  setFcompEmpty("bars", meses.length === 0);
  if (meses.length === 0) return;

  fcompCharts.bars = new Chart(document.getElementById("fcomp-chart-bars"), {
    type: "bar",
    data: {
      labels: meses,
      datasets: [
        { label: "Bruto", data: meses.map(m => byMonth[m].bruto), backgroundColor: "rgba(6,163,182,.75)", borderColor: "#06a3b6", borderWidth: 1, borderRadius: 4 },
        { label: "Pagado", data: meses.map(m => byMonth[m].pagado), backgroundColor: "rgba(232,163,23,.75)", borderColor: "#e8a317", borderWidth: 1, borderRadius: 4 },
        { label: "Ganancia", data: meses.map(m => byMonth[m].ganancia), backgroundColor: "rgba(34,160,107,.75)", borderColor: "#22a06b", borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: commonBarLineOpts({ stacked: false, tooltip: "money" })
  });
}

function renderCompTipoLines(data) {
  destroyFcompChart("tipo");
  const TIPOS = ["LIFE", "SUPP", "ACA", "MEDICARE", "OTROS"];
  const COLOR_TIPO = { LIFE: "#06a3b6", SUPP: "#9333ea", ACA: "#c0392b", MEDICARE: "#e8a317", OTROS: "#5b21b6" };

  const byMonthTipo = {};
  for (const r of data) {
    if (!r.mes) continue;
    if (!byMonthTipo[r.mes]) byMonthTipo[r.mes] = {};
    const t = r.tipoPago || "OTROS";
    byMonthTipo[r.mes][t] = (byMonthTipo[r.mes][t] || 0) + (Number(r.monto) || 0);
  }
  const meses = Object.keys(byMonthTipo).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  setFcompEmpty("tipo", meses.length === 0);
  if (meses.length === 0) return;

  const datasets = TIPOS.map(t => ({
    label: t,
    data: meses.map(m => byMonthTipo[m][t] || 0),
    borderColor: COLOR_TIPO[t],
    backgroundColor: COLOR_TIPO[t] + "22",
    tension: 0.3,
    borderWidth: 2,
    fill: false
  }));

  fcompCharts.tipo = new Chart(document.getElementById("fcomp-chart-tipo"), {
    type: "line",
    data: { labels: meses, datasets },
    options: commonBarLineOpts({ stacked: false, tooltip: "money" })
  });
}

function renderCompBrokerStack(data) {
  destroyFcompChart("brokers");
  const byMonthBroker = {};
  const allBrokers = new Set();
  for (const r of data) {
    if (!r.mes || !Array.isArray(r.payouts) || !r.payouts.length) continue;
    if (!byMonthBroker[r.mes]) byMonthBroker[r.mes] = {};
    for (const p of r.payouts) {
      const b = p.broker || "—";
      allBrokers.add(b);
      byMonthBroker[r.mes][b] = (byMonthBroker[r.mes][b] || 0) + (Number(p.saldo) || 0);
    }
  }
  const meses = Object.keys(byMonthBroker).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  setFcompEmpty("brokers", meses.length === 0);
  if (meses.length === 0) return;

  // Tomar top brokers globalmente y agrupar el resto en "Otros"
  const brokerTotals = {};
  for (const m of meses) {
    for (const [b, v] of Object.entries(byMonthBroker[m])) {
      brokerTotals[b] = (brokerTotals[b] || 0) + v;
    }
  }
  const topN = 7;
  const topBrokers = Object.entries(brokerTotals).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([b]) => b);
  const useBrokers = topBrokers.length < allBrokers.size ? [...topBrokers, "Otros"] : topBrokers;

  const datasets = useBrokers.map((b, i) => ({
    label: b,
    data: meses.map(m => {
      if (b === "Otros") {
        return Object.entries(byMonthBroker[m] || {})
          .filter(([k]) => !topBrokers.includes(k))
          .reduce((s, [, v]) => s + v, 0);
      }
      return byMonthBroker[m]?.[b] || 0;
    }),
    backgroundColor: FD_PALETTE[i % FD_PALETTE.length],
    borderWidth: 0
  }));

  fcompCharts.brokers = new Chart(document.getElementById("fcomp-chart-brokers"), {
    type: "bar",
    data: { labels: meses, datasets },
    options: commonBarLineOpts({ stacked: true, tooltip: "money" })
  });
}

function commonBarLineOpts({ stacked = false, tooltip = "money" } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: getChartTextColor(), font: { size: 12 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y ?? ctx.parsed)}` } }
    },
    scales: {
      x: { stacked, ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() } },
      y: { stacked, beginAtZero: true, ticks: { color: getChartTextColor(), callback: v => formatMoneyShort(v) }, grid: { color: getChartGridColor() } }
    }
  };
}

function setFcompEmpty(key, isEmpty) {
  const el = document.getElementById(`fcomp-chart-${key}-empty`);
  if (el) el.style.display = isEmpty ? "" : "none";
}


// ═══════════════════════════════════════════════════════════
// EXPORTAR — Formulario único personalizable (v2.12)
// ═══════════════════════════════════════════════════════════
// Un solo formulario con: dataset (ingresos/payouts) + filtros
// combinables + selección de columnas + formato (CSV/XLSX) + preview
// de conteo. El resumen ejecutivo (print) queda separado abajo.

let fexpInited = false;
let fexpCustomPickers = null;

// Definición de columnas por dataset. La clave del objeto es el `id` interno;
// `label` va al header del archivo; `get(row)` extrae el valor. `money` indica
// si el formato del cell en xlsx debe ser moneda.
const FEXP_COL_DEFS = {
  ingresos: [
    { id: "fecha",              label: "Fecha",                 get: r => r.fecha ? formatFechaUS(r.fecha) : "" },
    { id: "mes",                label: "Mes",                   get: r => r.mes || "" },
    { id: "tipoPago",           label: "Tipo de pago",          get: r => r.tipoPago || "" },
    { id: "categoria",          label: "Categoría",             get: r => r.categoria || "" },
    { id: "carrier",            label: "Carrier",               get: r => r.carrier || "" },
    { id: "descDep",            label: "Descripción depósito",  get: r => r.descripcionDeposito || "" },
    { id: "descTrans",          label: "Descripción transacción", get: r => r.descripcionTransaccion || "" },
    { id: "monto",              label: "Monto",                 get: r => Number(r.monto) || 0, money: true },
    { id: "pagado",             label: "Pagado",                get: r => Number(r.pagado) || 0, money: true },
    { id: "ganancia",           label: "Ganancia",              get: r => Number(r.ganancia) || 0, money: true },
    { id: "payoutCount",        label: "# Payouts",             get: r => Array.isArray(r.payouts) ? r.payouts.length : 0 },
    { id: "notas",              label: "Notas",                 get: r => r.notas || "" },
    { id: "creadoPor",          label: "Creado por",            get: r => r.creadoPor || "" },
    { id: "archivoOriginal",    label: "Archivo original",      get: r => r.archivoOriginalDriveUrl || "" }
  ],
  payouts: [
    { id: "fechaIngreso",       label: "Fecha ingreso",         get: r => r._ingreso.fecha ? formatFechaUS(r._ingreso.fecha) : "" },
    { id: "mes",                label: "Mes",                   get: r => r._ingreso.mes || "" },
    { id: "descDep",            label: "Desc. depósito",        get: r => r._ingreso.descripcionDeposito || "" },
    { id: "categoria",          label: "Categoría",             get: r => r._ingreso.categoria || "" },
    { id: "carrier",            label: "Carrier",               get: r => r._ingreso.carrier || "" },
    { id: "montoIngreso",       label: "Monto ingreso",         get: r => Number(r._ingreso.monto) || 0, money: true },
    { id: "tipoDest",           label: "Tipo destinatario",     get: r => TIPO_DEST_LABEL[r.tipo || "agencia"] || (r.tipo || "agencia") },
    { id: "destinatario",       label: "Destinatario",          get: r => r.broker || "" },
    { id: "saldo",              label: "Saldo (payout)",        get: r => Number(r.saldo) || 0, money: true },
    { id: "reporteFile",        label: "Reporte file",          get: r => r.reporteFile || "" },
    { id: "emailSentTo",        label: "Email enviado a",       get: r => r.emailSentTo || "" },
    { id: "emailSentAt",        label: "Fecha envío",           get: r => r.emailSentAt ? formatFechaUS(String(r.emailSentAt).slice(0, 10)) : "" }
  ]
};

const fexpState = {
  dataset: "ingresos",
  periodo: "all",
  fromDate: null,
  toDate: null,
  tiposPago: new Set(TIPOS_PAGO),
  categorias: new Set(CATEGORIAS),
  carriers: new Set(),         // se llena tras loadCarriersList
  destTipo: "all",             // "all" | "agencia" | "broker"
  destinatarios: new Set(),    // se llena tras loadBrokers
  columns: new Set(FEXP_COL_DEFS.ingresos.map(c => c.id)),
  formato: "xlsx",
  currentStep: 1
};

// Definición del wizard: qué pasos aplican para cada dataset
function isStepApplicable(step, dataset) {
  if (dataset === "ingresos" && step === 5) return false;
  return true;
}
function getApplicableSteps(dataset) {
  return [1, 2, 3, 4, 5, 6, 7].filter(s => isStepApplicable(s, dataset));
}

function bindExportarStaticHandlers() {
  // Los handlers se bindean al cargar el DOM (todo el HTML del tab ya existe).
  const periodSel = document.getElementById("fexp-period");
  if (periodSel && !periodSel.dataset.bound) {
    periodSel.dataset.bound = "1";
    periodSel.addEventListener("change", (e) => {
      fexpState.periodo = e.target.value;
      toggleFexpCustomRange(e.target.value === "custom");
      renderPreview();
    });
  }

  const printBtn = document.getElementById("fexp-print-report");
  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "1";
    printBtn.addEventListener("click", generatePrintReport);
  }

  const dlBtn = document.getElementById("fexp-download");
  if (dlBtn && !dlBtn.dataset.bound) {
    dlBtn.dataset.bound = "1";
    dlBtn.addEventListener("click", doExport);
  }

  // Navegación del wizard
  const backBtn = document.getElementById("fexp-back");
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "1";
    backBtn.addEventListener("click", prevStep);
  }
  const nextBtn = document.getElementById("fexp-next");
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = "1";
    nextBtn.addEventListener("click", nextStep);
  }

  // Barra de progreso — permite volver a un paso ya visitado
  document.querySelectorAll('.fexp-progress-step').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", () => {
      const target = parseInt(el.dataset.step, 10);
      if (!isNaN(target) && target < fexpState.currentStep && isStepApplicable(target, fexpState.dataset)) {
        gotoStep(target);
      }
    });
  });

  // Radios dataset
  document.querySelectorAll('#fexp-dataset-radios input[type="radio"]').forEach(r => {
    if (r.dataset.bound) return;
    r.dataset.bound = "1";
    r.addEventListener("change", () => {
      fexpState.dataset = r.value;
      document.querySelectorAll('#fexp-dataset-radios .fexp-radio').forEach(l => {
        l.classList.toggle("is-active", l.dataset.dataset === r.value);
      });
      // Reset columns a todas por default para el nuevo dataset
      fexpState.columns = new Set(FEXP_COL_DEFS[fexpState.dataset].map(c => c.id));
      renderExportColumns();
      updateExportFieldVisibility();
      // Actualiza la barra de progreso (algunos pasos se marcan skipped)
      updateProgressBar();
      renderPreview();
    });
  });

  // Radios destTipo
  document.querySelectorAll('#fexp-destTipo-radios input[type="radio"]').forEach(r => {
    if (r.dataset.bound) return;
    r.dataset.bound = "1";
    r.addEventListener("change", () => {
      fexpState.destTipo = r.value;
      document.querySelectorAll('#fexp-destTipo-radios .fexp-radio-compact').forEach(l => {
        l.classList.toggle("is-active", l.querySelector("input").checked);
      });
      renderDestinatarioChips();
      renderPreview();
    });
  });

  // Radios formato
  document.querySelectorAll('#fexp-formato-radios input[type="radio"]').forEach(r => {
    if (r.dataset.bound) return;
    r.dataset.bound = "1";
    r.addEventListener("change", () => {
      fexpState.formato = r.value;
      document.querySelectorAll('#fexp-formato-radios .fexp-radio-compact').forEach(l => {
        l.classList.toggle("is-active", l.querySelector("input").checked);
      });
      renderPreview();
    });
  });

  // Botones "Marcar todo" / "Ninguna" de columnas
  const btnAll = document.getElementById("fexp-cols-all");
  if (btnAll && !btnAll.dataset.bound) {
    btnAll.dataset.bound = "1";
    btnAll.addEventListener("click", () => {
      fexpState.columns = new Set(FEXP_COL_DEFS[fexpState.dataset].map(c => c.id));
      renderExportColumns();
      renderPreview();
    });
  }
  const btnNone = document.getElementById("fexp-cols-none");
  if (btnNone && !btnNone.dataset.bound) {
    btnNone.dataset.bound = "1";
    btnNone.addEventListener("click", () => {
      fexpState.columns = new Set();
      renderExportColumns();
      renderPreview();
    });
  }

  // Botones "Marcar todos" para chips
  document.querySelectorAll('.fexp-chip-all').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      toggleAllChips(btn.dataset.target);
    });
  });
}

// ─── Wizard: navegación entre pasos ────────────────────────
function gotoStep(step) {
  fexpState.currentStep = step;
  // Mostrar solo el panel activo
  document.querySelectorAll(".fexp-panel").forEach(p => {
    const isActive = parseInt(p.dataset.step, 10) === step;
    p.classList.toggle("is-active", isActive);
    p.hidden = !isActive;
  });
  updateProgressBar();
  updateNavButtons();
  updateExportFieldVisibility();
  if (window.refreshIcons) window.refreshIcons();
}

function nextStep() {
  const applicable = getApplicableSteps(fexpState.dataset);
  const idx = applicable.indexOf(fexpState.currentStep);
  if (idx < 0 || idx >= applicable.length - 1) return;
  gotoStep(applicable[idx + 1]);
}

function prevStep() {
  const applicable = getApplicableSteps(fexpState.dataset);
  const idx = applicable.indexOf(fexpState.currentStep);
  if (idx <= 0) return;
  gotoStep(applicable[idx - 1]);
}

function updateProgressBar() {
  const applicable = getApplicableSteps(fexpState.dataset);
  const currentIdx = applicable.indexOf(fexpState.currentStep);
  document.querySelectorAll(".fexp-progress-step").forEach(el => {
    const step = parseInt(el.dataset.step, 10);
    const stepApplicable = isStepApplicable(step, fexpState.dataset);
    const stepIdx = applicable.indexOf(step);
    el.classList.remove("is-active", "is-done", "is-skipped");
    if (!stepApplicable) el.classList.add("is-skipped");
    else if (step === fexpState.currentStep) el.classList.add("is-active");
    else if (stepIdx >= 0 && stepIdx < currentIdx) el.classList.add("is-done");
  });
  // Conectores entre steps
  const stepsEls = [...document.querySelectorAll("#fexp-progress > *")];
  for (let i = 0; i < stepsEls.length; i++) {
    if (stepsEls[i].classList.contains("fexp-progress-conn")) {
      // Verifica el step anterior (i-1). Si is-done → conn is-done
      const prev = stepsEls[i - 1];
      stepsEls[i].classList.toggle("is-done", prev && prev.classList.contains("is-done"));
    }
  }
}

function updateNavButtons() {
  const applicable = getApplicableSteps(fexpState.dataset);
  const idx = applicable.indexOf(fexpState.currentStep);
  const isFirst = idx === 0;
  const isLast = idx === applicable.length - 1;

  const backBtn = document.getElementById("fexp-back");
  const nextBtn = document.getElementById("fexp-next");
  const dlBtn = document.getElementById("fexp-download");
  if (backBtn) backBtn.disabled = isFirst;
  if (nextBtn) nextBtn.hidden = isLast;
  if (dlBtn) dlBtn.hidden = !isLast;
}

function bindExportarLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="exportar"]').forEach(b => {
    if (b.dataset.fexpBound) return;
    b.dataset.fexpBound = "1";
    b.addEventListener("click", () => {
      if (!fexpInited) initExportarPanel();
    });
  });
}

async function initExportarPanel() {
  if (fexpInited) return;
  fexpInited = true;
  try {
    if (ingresosData.length === 0) await loadIngresos();
    try { await loadCarriersList(); } catch (_) {}
    try { await loadBrokers(); } catch (_) {}
    // Poblar sets con todos los valores disponibles (default: todos incluidos)
    fexpState.carriers = new Set(carriersList || []);
    fexpState.destinatarios = new Set(brokersData.map(b => b.nombre));
    renderExportChips();
    renderExportColumns();
    updateExportFieldVisibility();
    gotoStep(1);
    renderPreview();
  } catch (e) {
    console.error("Error inicializando Exportar:", e);
    fexpInited = false;
    heroToast.error(`No se pudo cargar Exportar: ${e?.message || e}`, { duration: 6000 });
  }
}

function toggleFexpCustomRange(show) {
  const wrap = document.getElementById("fexp-custom-range");
  if (!wrap) return;
  wrap.hidden = !show;
  if (show) ensureFexpCustomPickers();
}

function ensureFexpCustomPickers() {
  if (fexpCustomPickers) return;
  const fromEl = document.getElementById("fexp-date-from");
  const toEl = document.getElementById("fexp-date-to");
  if (!fromEl || !toEl || typeof flatpickr === "undefined") return;
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const fp1 = flatpickr(fromEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: yearStart,
    onChange: ([d]) => { fexpState.fromDate = d ? startOfDay(d) : null; if (d && fp2) fp2.set("minDate", d); renderPreview(); }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: today,
    onChange: ([d]) => { fexpState.toDate = d ? endOfDay(d) : null; if (d && fp1) fp1.set("maxDate", d); renderPreview(); }
  });
  fexpCustomPickers = { fp1, fp2 };
  fexpState.fromDate = startOfDay(yearStart);
  fexpState.toDate = endOfDay(today);
}

// ─── Chips multiselect ───────────────────────────────────
function renderExportChips() {
  renderChipGroup("fexp-chips-tipoPago", TIPOS_PAGO, fexpState.tiposPago);
  renderChipGroup("fexp-chips-categoria", CATEGORIAS, fexpState.categorias);
  renderChipGroup("fexp-chips-carrier", [...carriersList].sort((a, b) => a.localeCompare(b, "es")), fexpState.carriers);
  renderDestinatarioChips();
  renderChipGroup("fexp-chips-tipoGasto", [...tiposGastoList].sort((a, b) => a.localeCompare(b, "es")), fexpState.tiposGasto);
}

function renderDestinatarioChips() {
  let names;
  if (fexpState.destTipo === "agencia") {
    names = brokersData.filter(b => (b.tipo || "agencia") === "agencia").map(b => b.nombre);
  } else if (fexpState.destTipo === "broker") {
    names = brokersData.filter(b => b.tipo === "broker").map(b => b.nombre);
  } else {
    names = brokersData.map(b => b.nombre);
  }
  names.sort((a, b) => a.localeCompare(b, "es"));
  // Preservar las selecciones que sigan siendo válidas; agregar los nuevos por default marcados
  const validSet = new Set(names);
  const previous = fexpState.destinatarios;
  const newSelection = new Set();
  names.forEach(n => { if (previous.has(n) || !previous.size) newSelection.add(n); });
  // Si el estado previo estaba lleno, mantenemos todo marcado
  if (previous.size === 0 || [...previous].every(n => validSet.has(n))) {
    // OK, mantén el filtrado
  }
  fexpState.destinatarios = new Set(names.filter(n => previous.has(n)));
  if (fexpState.destinatarios.size === 0) {
    // Si nada quedó, marca todos por default para no dejar vacío
    fexpState.destinatarios = new Set(names);
  }
  renderChipGroup("fexp-chips-destinatario", names, fexpState.destinatarios);
}

function renderChipGroup(elId, values, selectedSet) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!values || values.length === 0) {
    el.innerHTML = `<span class="fexp-chips-empty">Sin opciones disponibles</span>`;
    return;
  }
  el.innerHTML = values.map(v => {
    const isActive = selectedSet.has(v);
    return `<span class="fexp-chip${isActive ? " is-active" : ""}" data-value="${escapeHtmlAttr(v)}">${escapeHtml(v)}</span>`;
  }).join("");
  el.querySelectorAll(".fexp-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const v = chip.dataset.value;
      if (selectedSet.has(v)) selectedSet.delete(v);
      else selectedSet.add(v);
      chip.classList.toggle("is-active");
      renderPreview();
    });
  });
}

function toggleAllChips(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chips = el.querySelectorAll(".fexp-chip");
  const allActive = [...chips].every(c => c.classList.contains("is-active"));
  const targetSetName = {
    "fexp-chips-tipoPago": "tiposPago",
    "fexp-chips-categoria": "categorias",
    "fexp-chips-carrier": "carriers",
    "fexp-chips-destinatario": "destinatarios",
    "fexp-chips-tipoGasto": "tiposGasto"
  }[elId];
  const targetSet = fexpState[targetSetName];
  if (allActive) {
    targetSet.clear();
    chips.forEach(c => c.classList.remove("is-active"));
  } else {
    chips.forEach(c => {
      c.classList.add("is-active");
      targetSet.add(c.dataset.value);
    });
  }
  renderPreview();
}

// ─── Columnas ────────────────────────────────────────────
function renderExportColumns() {
  const el = document.getElementById("fexp-cols");
  if (!el) return;
  const cols = FEXP_COL_DEFS[fexpState.dataset];
  el.innerHTML = cols.map(c => {
    const checked = fexpState.columns.has(c.id) ? "checked" : "";
    return `
      <label class="fexp-col">
        <input type="checkbox" value="${escapeHtmlAttr(c.id)}" ${checked}>
        <span>${escapeHtml(c.label)}</span>
      </label>
    `;
  }).join("");
  el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) fexpState.columns.add(cb.value);
      else fexpState.columns.delete(cb.value);
      renderPreview();
    });
  });
}

// ─── Visibilidad de campos según dataset ─────────────────
// Sin datasets con paneles alternos hoy — se deja el hook por si vuelven a aparecer.
function updateExportFieldVisibility() {
  document.querySelectorAll("[data-scope]").forEach(f => {
    const scopes = f.dataset.scope.split(/\s+/);
    const visible = scopes.includes(fexpState.dataset);
    if (f.tagName === "H3" || f.tagName === "P") f.hidden = !visible;
    else f.style.display = visible ? "" : "none";
  });
}

// ─── Preview persistente ──────────────────────────────────
// Actualiza filename, badges de filtros aplicados, tabla mock con 3 filas
// ficticias y el contador de registros reales que se exportarán.
function renderPreview() {
  const dataset = fexpState.dataset;
  const rows = getFilteredData();
  const activeCols = FEXP_COL_DEFS[dataset].filter(c => fexpState.columns.has(c.id));

  // Filename
  const ext = fexpState.formato === "csv" ? "csv" : "xlsx";
  const filenameEl = document.getElementById("fexp-preview-filename");
  if (filenameEl) filenameEl.textContent = `hero-finanzas-${dataset}-${slugify(periodoLabel())}.${ext}`;

  // Contador
  const countEl = document.getElementById("fexp-preview-count");
  if (countEl) countEl.textContent = `${rows.length} ${dataset === "payouts" ? "payouts" : "ingresos"}`;
  const finalCountEl = document.getElementById("fexp-final-count");
  if (finalCountEl) finalCountEl.innerHTML = `<strong>${rows.length}</strong> ${dataset === "payouts" ? "payouts" : "ingresos"}`;

  // Badges de filtros aplicados
  renderPreviewBadges();

  // Tabla mock
  renderPreviewTable(activeCols, dataset);
}

function renderPreviewBadges() {
  const el = document.getElementById("fexp-preview-badges");
  if (!el) return;
  const badges = [];
  // Periodo
  badges.push({ icon: "calendar", label: periodoLabel() });
  // Tipos de pago
  const tp = [...fexpState.tiposPago];
  if (tp.length === 0) badges.push({ icon: "x-circle", label: "Sin tipos de pago" });
  else if (tp.length < TIPOS_PAGO.length) badges.push({ icon: "credit-card", label: tp.join(", ") });
  // Categorías
  const cat = [...fexpState.categorias];
  if (cat.length === 0) badges.push({ icon: "x-circle", label: "Sin categorías" });
  else if (cat.length < CATEGORIAS.length) badges.push({ icon: "layers", label: cat.join(", ") });
  // Carriers
  const totalCarriers = (carriersList || []).length;
  const car = [...fexpState.carriers];
  if (totalCarriers > 0 && car.length < totalCarriers) {
    const label = car.length === 0 ? "Sin carriers" : (car.length > 3 ? `${car.length} carriers` : car.join(", "));
    badges.push({ icon: "briefcase", label });
  }
  if (fexpState.dataset === "payouts") {
    if (fexpState.destTipo !== "all") {
      badges.push({ icon: "users-round", label: fexpState.destTipo === "agencia" ? "Solo Agencias" : "Solo Brokers/Agentes" });
    }
    const dst = [...fexpState.destinatarios];
    const totalDst = brokersData.length;
    if (totalDst > 0 && dst.length < totalDst) {
      const label = dst.length === 0 ? "Sin destinatarios" : (dst.length > 3 ? `${dst.length} destinatarios` : dst.join(", "));
      badges.push({ icon: "user", label });
    }
  }

  if (badges.length === 0) {
    el.innerHTML = `<span class="fexp-preview-badge-empty">Sin filtros aplicados</span>`;
  } else {
    el.innerHTML = badges.map(b => `
      <span class="fexp-preview-badge">
        <i data-lucide="${b.icon}"></i>${escapeHtml(b.label)}
      </span>
    `).join("");
  }
  if (window.refreshIcons) window.refreshIcons();
}

// Genera valores ficticios por columna para la vista previa.
function mockValueFor(colId, dataset, rowIdx) {
  const MOCK = {
    ingresos: {
      fecha: ["01/15/2026", "01/22/2026", "02/03/2026"],
      mes: ["ENE 2026", "ENE 2026", "FEB 2026"],
      tipoPago: ["LIFE", "SUPP", "ACA"],
      categoria: ["COMISSION", "COMISSION", "OVERRIDES"],
      carrier: ["Aetna", "Cigna", "Ambetter ACA"],
      descDep: ["AETNALIFE", "CIGNA - LOYAL", "HEALTHFAMILY"],
      descTrans: ["ACH DEPOSIT 12345", "ACH DEPOSIT 67890", "ACH DEPOSIT 11223"],
      monto: ["$1,234.56", "$820.15", "$2,458.00"],
      pagado: ["$800.00", "$0.00", "$1,220.00"],
      ganancia: ["$434.56", "$820.15", "$1,238.00"],
      payoutCount: ["2", "0", "3"],
      notas: ["—", "—", "revisar chargeback"],
      creadoPor: ["gilbana@…", "gilbana@…", "gilbana@…"],
      archivoOriginal: ["F&G_Statement_…", "Cigna_Report_…", "Health_Fam_…"]
    },
    payouts: {
      fechaIngreso: ["01/15/2026", "01/22/2026", "02/03/2026"],
      mes: ["ENE 2026", "ENE 2026", "FEB 2026"],
      descDep: ["AETNALIFE", "AETNALIFE", "HEALTHFAMILY"],
      categoria: ["COMISSION", "COMISSION", "OVERRIDES"],
      carrier: ["Aetna", "Aetna", "Ambetter ACA"],
      montoIngreso: ["$1,234.56", "$1,234.56", "$2,458.00"],
      tipoDest: ["Agencia", "Broker/Agente", "Agencia"],
      destinatario: ["ENSURE", "Juan Pérez", "KHAN FINANCIAL"],
      saldo: ["$500.00", "$300.00", "$1,220.00"],
      reporteFile: ["PACA-045_…", "—", "PACA-091_…"],
      emailSentTo: ["ensure@…", "—", "khan@…"],
      emailSentAt: ["01/16/2026", "—", "02/04/2026"]
    }
  };
  const table = MOCK[dataset] || {};
  const arr = table[colId];
  if (Array.isArray(arr) && arr[rowIdx] != null) return arr[rowIdx];
  return "…";
}

function renderPreviewTable(activeCols, dataset) {
  const table = document.getElementById("fexp-preview-table");
  if (!table) return;
  if (activeCols.length === 0) {
    table.innerHTML = `<tbody><tr><td class="fexp-preview-empty">No hay columnas seleccionadas — nada que mostrar.</td></tr></tbody>`;
    return;
  }
  const header = `<thead><tr>${activeCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>`;
  const bodyRows = [0, 1, 2].map((i) => {
    const cells = activeCols.map(c => `<td>${escapeHtml(mockValueFor(c.id, dataset, i))}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const ghost = `<tr class="is-ghost"><td colspan="${activeCols.length}">… y así hasta ${document.getElementById("fexp-preview-count")?.textContent || "todos los registros"}</td></tr>`;
  table.innerHTML = header + `<tbody>${bodyRows}${ghost}</tbody>`;
}

// ─── Filtrado + conteo ───────────────────────────────────
function getFilteredIngresos() {
  return ingresosData.filter(r => {
    if (fexpState.periodo !== "all" && !matchesPeriodo(r.fecha, fexpState.periodo, fexpState.fromDate, fexpState.toDate)) return false;
    if (fexpState.tiposPago.size > 0 && !fexpState.tiposPago.has(r.tipoPago)) return false;
    if (fexpState.categorias.size > 0 && !fexpState.categorias.has(r.categoria)) return false;
    if (fexpState.carriers.size > 0 && r.carrier && !fexpState.carriers.has(r.carrier)) return false;
    return true;
  });
}

function getFilteredPayouts() {
  const rows = [];
  const ingFiltered = getFilteredIngresos();
  for (const ing of ingFiltered) {
    if (!Array.isArray(ing.payouts) || ing.payouts.length === 0) continue;
    for (const p of ing.payouts) {
      const t = p.tipo || "agencia";
      if (fexpState.destTipo !== "all" && t !== fexpState.destTipo) continue;
      if (fexpState.destinatarios.size > 0 && p.broker && !fexpState.destinatarios.has(p.broker)) continue;
      rows.push({ ...p, _ingreso: ing });
    }
  }
  return rows;
}

function getFilteredData() {
  if (fexpState.dataset === "ingresos") return getFilteredIngresos();
  if (fexpState.dataset === "payouts") return getFilteredPayouts();
  return [];
}

// Retorna los datos originales para el print report (mantiene compat).
function exportarData() {
  return getFilteredIngresos();
}

// ─── Descarga ─────────────────────────────────────────────
function doExport() {
  const rows = getFilteredData();
  if (rows.length === 0) { heroToast.info("No hay registros que coincidan con los filtros."); return; }
  const activeCols = FEXP_COL_DEFS[fexpState.dataset].filter(c => fexpState.columns.has(c.id));
  if (activeCols.length === 0) { heroToast.error("Selecciona al menos una columna."); return; }

  const header = activeCols.map(c => c.label);
  const body = rows.map(r => activeCols.map(c => c.get(r)));
  const filename = `hero-finanzas-${fexpState.dataset}-${slugify(periodoLabel())}`;

  if (fexpState.formato === "csv") {
    downloadCSV(`${filename}.csv`, [header, ...body]);
    return;
  }

  // XLSX
  if (!ensureSheetJS()) return;
  const aoa = [header, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Aplicar formato moneda en columnas correspondientes
  const moneyLetters = [];
  activeCols.forEach((c, i) => {
    if (c.money) moneyLetters.push(XLSX.utils.encode_col(i));
  });
  for (let i = 2; i <= aoa.length; i++) {
    for (const L of moneyLetters) {
      const cell = ws[L + i];
      if (cell) cell.z = '"$"#,##0.00';
    }
  }
  // Anchos razonables (heurística ligera por label)
  ws["!cols"] = activeCols.map(c => ({ wch: Math.max(c.label.length + 2, c.money ? 12 : 16) }));
  const wb = XLSX.utils.book_new();
  const sheetName = { ingresos: "Ingresos", payouts: "Payouts" }[fexpState.dataset];
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function periodoLabel() {
  const cY = new Date().getFullYear();
  const MESES_FULL = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  if (typeof fexpState.periodo === "string" && fexpState.periodo.startsWith("m-")) {
    const idx = parseInt(fexpState.periodo.slice(2), 10) - 1;
    if (idx >= 0 && idx < 12) return `${MESES_FULL[idx]} ${cY}`;
  }
  const labels = { all: "Todo", custom: "Personalizado" };
  if (fexpState.periodo === "custom" && fexpState.fromDate && fexpState.toDate) {
    return `${formatDateShort(fexpState.fromDate)}–${formatDateShort(fexpState.toDate)}`;
  }
  return labels[fexpState.periodo] || "Periodo";
}

function formatDateShort(d) {
  if (!d) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[áéíóú]/g, m => ({á:"a",é:"e",í:"i",ó:"o",ú:"u"}[m]))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureSheetJS() {
  if (typeof XLSX === "undefined") {
    heroToast.info("La librería para generar Excel (SheetJS) aún no cargó. Espera un segundo y vuelve a intentar.", { duration: 5000 });
    return false;
  }
  return true;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const bom = "﻿"; // UTF-8 BOM para que Excel abra los acentos bien
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function generatePrintReport() {
  const data = exportarData();
  if (!data.length) { heroToast.info("No hay ingresos en el periodo seleccionado."); return; }

  // Aggregate por mes
  const byMonth = {};
  for (const r of data) {
    const m = r.mes || "—";
    if (!byMonth[m]) byMonth[m] = { count: 0, bruto: 0, pagado: 0, ganancia: 0 };
    byMonth[m].count += 1;
    byMonth[m].bruto += Number(r.monto) || 0;
    byMonth[m].pagado += Number(r.pagado) || 0;
    byMonth[m].ganancia += Number(r.ganancia) || 0;
  }
  const meses = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));

  const totalBruto = data.reduce((s, r) => s + (Number(r.monto) || 0), 0);
  const totalPagado = data.reduce((s, r) => s + (Number(r.pagado) || 0), 0);
  const totalGanancia = data.reduce((s, r) => s + (Number(r.ganancia) || 0), 0);
  const totalCount = data.length;

  const now = new Date();
  const fechaGen = formatFechaUS(now.toISOString().slice(0, 10));

  const html = `
    <div class="fpr-header">
      <div class="fpr-brand">
        <img src="icons/favicon-hero.png" alt="Hero">
        <div>
          <h1>Hero Insurance USA</h1>
          <div class="fpr-sub">Hero Hub · Módulo de Finanzas</div>
        </div>
      </div>
      <div class="fpr-meta">
        <strong>${escapeHtml(periodoLabel())}</strong><br>
        Generado: ${fechaGen}<br>
        Por: ${escapeHtml(currentUserEmail || "—")}
      </div>
    </div>

    <h2 class="fpr-title">Resumen Ejecutivo</h2>
    <div class="fpr-period">Totales del periodo seleccionado</div>

    <div class="fpr-kpis">
      <div class="fpr-kpi"><div class="fpr-kpi-label">Bruto</div><div class="fpr-kpi-value">${formatMoney(totalBruto)}</div></div>
      <div class="fpr-kpi"><div class="fpr-kpi-label">Pagado</div><div class="fpr-kpi-value">${formatMoney(totalPagado)}</div></div>
      <div class="fpr-kpi fpr-kpi-highlight"><div class="fpr-kpi-label">Ganancia</div><div class="fpr-kpi-value">${formatMoney(totalGanancia)}</div></div>
      <div class="fpr-kpi"><div class="fpr-kpi-label">Ingresos</div><div class="fpr-kpi-value">${totalCount}</div></div>
    </div>

    <div class="fpr-section-title">Breakdown mes a mes</div>
    <table class="fpr-table">
      <thead>
        <tr><th>Mes</th><th># Ingresos</th><th class="num">Bruto</th><th class="num">Pagado</th><th class="num">Ganancia</th></tr>
      </thead>
      <tbody>
        ${meses.map(m => `
          <tr>
            <td>${escapeHtml(m)}</td>
            <td>${byMonth[m].count}</td>
            <td class="num">${formatMoney(byMonth[m].bruto)}</td>
            <td class="num">${formatMoney(byMonth[m].pagado)}</td>
            <td class="num">${formatMoney(byMonth[m].ganancia)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr><td>Total</td><td>${totalCount}</td><td class="num">${formatMoney(totalBruto)}</td><td class="num">${formatMoney(totalPagado)}</td><td class="num">${formatMoney(totalGanancia)}</td></tr>
      </tfoot>
    </table>

    <div class="fpr-footer">
      Documento generado automáticamente por Hero Hub.
      Las cifras corresponden a los registros de la colección <code>finanzas-ingresos</code> al momento de la generación.
    </div>
  `;

  const report = document.getElementById("fexp-print-report");
  report.innerHTML = html;
  window.print();
}

async function openIngresoModal(existing, opts = {}) {
  const isEdit = !!existing;
  // Modo por defecto: LECTURA al abrir un existente, EDICIÓN al crear uno nuevo.
  let mode = isEdit ? (opts.mode || "view") : "edit";

  // Asegura brokers/agencias + descripciones + carriers cargados
  if (brokersData.length === 0) {
    try { await loadBrokers(); } catch (e) { console.warn("No se pudieron cargar brokers:", e.message); }
  }
  await loadDescDepositoList();
  await loadCarriersList();

  const initialFecha = existing?.fecha || todayISO();
  const initialTipoPago = existing?.tipoPago || "LIFE";
  const initialCategoria = existing?.categoria || "COMISSION";
  const initialCarrier = existing?.carrier || "";
  // Snapshot de payouts para poder cancelar edición y volver al original
  const originalPayouts = isEdit && Array.isArray(existing.payouts)
    ? existing.payouts.map(p => ({ ...p }))
    : [];

  const dialog = document.createElement("sl-dialog");
  dialog.className = "fi-modal fi-mode-" + mode;
  dialog.dataset.mode = mode;
  const setDialogLabel = () => {
    dialog.label = mode === "view" ? "Detalle del ingreso" : (isEdit ? "Editar ingreso" : "Nuevo ingreso");
  };
  setDialogLabel();

  dialog.innerHTML = `
    <div class="fc-form">

      <!-- Barra de acciones superior (solo visible en modo lectura) -->
      <div class="fi-view-topbar" ${mode === "view" ? "" : "hidden"}>
        <button type="button" class="fi-edit-btn" title="Editar este ingreso">
          <i data-lucide="pencil" style="width:14px;height:14px;"></i>
          Editar
        </button>
      </div>

      <div class="fi-section-title">Información básica</div>

      <div class="fi-row-3">
        <div class="fc-native-field">
          <label for="fi-f-fecha" class="fc-native-label">
            Fecha
            <span class="fi-mes-pill" id="fi-mes-pill"></span>
          </label>
          <input type="date" id="fi-f-fecha" class="fc-native-date fi-edit-only" value="${initialFecha}" required>
          <div class="fc-native-static fi-view-only" id="fi-f-fecha-static">${escapeHtml(formatFechaUS(initialFecha))}</div>
        </div>
        <div class="fc-native-field">
          <label for="fi-f-tipopago" class="fc-native-label">Tipo de pago</label>
          <select id="fi-f-tipopago" class="fc-native-select" required>
            ${TIPOS_PAGO.map(t => `<option value="${t}" ${t === initialTipoPago ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="fc-native-field">
          <label for="fi-f-categoria" class="fc-native-label">Categoría</label>
          <select id="fi-f-categoria" class="fc-native-select" required>
            ${CATEGORIAS.map(c => `<option value="${c}" ${c === initialCategoria ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="fi-row-2">
        <div class="fc-native-field">
          <label for="fi-f-carrier" class="fc-native-label">Carrier</label>
          <select id="fi-f-carrier" class="fc-native-select">
            <option value="">— Selecciona —</option>
            ${carriersList.map(c =>
              `<option value="${escapeHtmlAttr(c)}" ${c === initialCarrier ? "selected" : ""}>${escapeHtml(c)}</option>`
            ).join("")}
            <option value="__add_new__" class="fi-add-new-option">+ Agregar nuevo...</option>
          </select>
          <div id="fi-add-carrier-wrap" class="fi-add-inline" style="display:none;">
            <input type="text" id="fi-add-carrier-input" class="fi-add-inline-input" placeholder="Ej. Blue Cross" autocomplete="off">
            <button type="button" id="fi-add-carrier-save" class="fi-add-inline-save">Guardar</button>
            <button type="button" id="fi-add-carrier-cancel" class="fi-add-inline-cancel" title="Cancelar">✕</button>
          </div>
        </div>
        <sl-input
          id="fi-f-monto"
          label="Monto ($)"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value="${existing?.monto != null ? existing.monto : ""}"
          required>
        </sl-input>
      </div>

      <div class="fc-native-field">
        <label for="fi-f-descDeposito" class="fc-native-label">Descripción depósito</label>
        <select id="fi-f-descDeposito" class="fc-native-select">
          <option value="">— Selecciona —</option>
          ${descDepositoList.map(v =>
            `<option value="${escapeHtmlAttr(v)}" ${v === existing?.descripcionDeposito ? "selected" : ""}>${escapeHtml(v)}</option>`
          ).join("")}
          <option value="__add_new__" class="fi-add-new-option">+ Agregar nuevo...</option>
        </select>
        <div id="fi-add-desc-deposito-wrap" class="fi-add-inline" style="display:none;">
          <input type="text" id="fi-add-desc-deposito-input" class="fi-add-inline-input" placeholder="Ej. NUEVO CARRIER" autocomplete="off">
          <button type="button" id="fi-add-desc-deposito-save" class="fi-add-inline-save">Guardar</button>
          <button type="button" id="fi-add-desc-deposito-cancel" class="fi-add-inline-cancel" title="Cancelar">✕</button>
        </div>
      </div>

      <sl-input
        id="fi-f-descTransaccion"
        label="Descripción transacción"
        placeholder="Ej. ACH DEPOSIT 12345"
        value="${escapeHtmlAttr(existing?.descripcionTransaccion || "")}"
        clearable>
      </sl-input>

      <sl-input
        id="fi-f-driveUrl"
        label="Archivo original (URL de Drive)"
        placeholder="https://drive.google.com/..."
        value="${escapeHtmlAttr(existing?.archivoOriginalDriveUrl || "")}"
        help-text="Por ahora pega la URL manualmente. Pronto: upload directo desde aquí."
        clearable>
      </sl-input>

      <div class="fi-section-title">Payouts</div>

      <div id="fi-payouts-list" class="fi-payouts-list"></div>
      <p id="fi-payouts-empty" class="fi-payouts-empty" style="display:none;">
        Sin payouts. Si Hero retiene el 100% del depósito (categoría HERO), déjalo así.
      </p>

      <button type="button" id="fi-add-payout" class="fi-add-payout-btn" ${mode === "view" ? "hidden" : ""}>
        <i data-lucide="plus" style="width:14px;height:14px;"></i>
        Agregar payout
      </button>

      <div class="fi-section-title">Resumen</div>

      <div class="fi-summary">
        <div class="fi-summary-item">
          <span class="fi-summary-label">Total pagado</span>
          <span class="fi-summary-value" id="fi-summary-pagado">$0.00</span>
        </div>
        <div class="fi-summary-item">
          <span class="fi-summary-label">Ganancia Hero</span>
          <span class="fi-summary-value fi-ganancia" id="fi-summary-ganancia">$0.00</span>
        </div>
      </div>

      <sl-textarea
        id="fi-f-notas"
        label="Notas"
        placeholder="Observaciones, chargebacks, etc."
        rows="2"
        resize="auto"
        value="${escapeHtmlAttr(existing?.notas || "")}">
      </sl-textarea>

    </div>

    <!-- Footer: acciones cambian según modo -->
    <sl-button slot="footer" class="fi-btn-close" variant="default" style="${mode === "edit" ? "display:none;" : ""}">Cerrar</sl-button>
    <sl-button slot="footer" class="fi-btn-cancel-edit" variant="default" style="${mode === "view" ? "display:none;" : ""}">Cancelar</sl-button>
    <sl-button slot="footer" class="fi-btn-save" variant="primary" style="${mode === "view" ? "display:none;" : ""}">
      <i data-lucide="${isEdit ? "save" : "plus"}" slot="prefix" style="width:14px;height:14px;"></i>
      ${isEdit ? "Guardar cambios" : "Registrar ingreso"}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  // Refs
  const fechaInp = dialog.querySelector("#fi-f-fecha");
  const mesPill = dialog.querySelector("#fi-mes-pill");
  const tipoPagoSel = dialog.querySelector("#fi-f-tipopago");
  const categoriaSel = dialog.querySelector("#fi-f-categoria");
  const carrierSel = dialog.querySelector("#fi-f-carrier");
  const montoInp = dialog.querySelector("#fi-f-monto");
  const descDepSel = dialog.querySelector("#fi-f-descDeposito");
  const descTransInp = dialog.querySelector("#fi-f-descTransaccion");
  const driveUrlInp = dialog.querySelector("#fi-f-driveUrl");
  const notasInp = dialog.querySelector("#fi-f-notas");
  const payoutsListEl = dialog.querySelector("#fi-payouts-list");
  const payoutsEmptyEl = dialog.querySelector("#fi-payouts-empty");
  const addPayoutBtn = dialog.querySelector("#fi-add-payout");
  const pagadoEl = dialog.querySelector("#fi-summary-pagado");
  const gananciaEl = dialog.querySelector("#fi-summary-ganancia");

  // ─── Mes derivado de la fecha + mirror de fecha para modo view ───
  const fechaStaticEl = dialog.querySelector("#fi-f-fecha-static");
  function updateMes() {
    const mes = deriveMes(fechaInp.value);
    mesPill.textContent = mes;
    mesPill.style.display = mes ? "" : "none";
    if (fechaStaticEl) fechaStaticEl.textContent = fechaInp.value ? formatFechaUS(fechaInp.value) : "—";
  }
  fechaInp.addEventListener("change", updateMes);
  fechaInp.addEventListener("input", updateMes);
  updateMes();

  // ─── Cálculo de resumen (pagado + ganancia) ───
  function recalcSummary() {
    const monto = parseFloat(montoInp.value) || 0;
    const saldos = Array.from(payoutsListEl.querySelectorAll(".fi-pf-saldo, .fi-pf-saldo-view"))
      .map(inp => parseFloat(inp.value || inp.dataset.value || 0) || 0);
    const pagado = saldos.reduce((s, v) => s + v, 0);
    const ganancia = monto - pagado;
    pagadoEl.textContent = formatMoney(pagado);
    gananciaEl.textContent = formatMoney(ganancia);
    gananciaEl.classList.toggle("negative", ganancia < 0);
  }
  montoInp.addEventListener("sl-input", recalcSummary);
  montoInp.addEventListener("input", recalcSummary);

  // ─── Helpers para render de destinatarios en dropdown (agrupados por tipo) ───
  function destinatariosOptions(selected) {
    const agencias = brokersData.filter(b => (b.tipo || "agencia") === "agencia")
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const brokers = brokersData.filter(b => b.tipo === "broker")
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const opt = (b) => `<option value="${escapeHtmlAttr(b.nombre)}" data-tipo="${b.tipo || "agencia"}" ${b.nombre === selected ? "selected" : ""}>${escapeHtml(b.nombre)}</option>`;
    return `<option value="">— Selecciona —</option>` +
      (agencias.length ? `<optgroup label="Agencias">${agencias.map(opt).join("")}</optgroup>` : "") +
      (brokers.length ? `<optgroup label="Brokers/Agentes">${brokers.map(opt).join("")}</optgroup>` : "");
  }

  // ─── Renderiza una fila de payout (versión EDIT) ───
  function addPayoutRowEdit(payout) {
    payoutsEmptyEl.style.display = "none";

    const tipoInicial = payout?.tipo || "agencia";
    const row = document.createElement("div");
    row.className = "fi-payout-row";
    row.innerHTML = `
      <div class="fi-payout-tipo">
        <label class="fi-payout-tipo-radio ${tipoInicial === "agencia" ? "is-active" : ""}">
          <input type="radio" name="fi-pf-tipo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}" value="agencia" ${tipoInicial === "agencia" ? "checked" : ""} class="fi-pf-tipo">
          <span>Agencia</span>
        </label>
        <label class="fi-payout-tipo-radio ${tipoInicial === "broker" ? "is-active" : ""}">
          <input type="radio" value="broker" ${tipoInicial === "broker" ? "checked" : ""} class="fi-pf-tipo">
          <span>Broker/Agente</span>
        </label>
      </div>
      <div class="fc-native-field">
        <label class="fc-native-label">Destinatario</label>
        <select class="fc-native-select fi-pf-broker">
          ${destinatariosOptions(payout?.broker)}
        </select>
      </div>
      <sl-input class="fi-pf-reporte" label="Reporte (URL)" placeholder="https://..." size="small" value="${escapeHtmlAttr(payout?.reporteFile || "")}"></sl-input>
      <sl-input class="fi-pf-saldo" label="Saldo ($)" type="number" step="0.01" min="0" size="small" value="${payout?.saldo != null ? payout.saldo : ""}"></sl-input>
      <button type="button" class="fi-pf-remove" title="Quitar payout">✕</button>
    `;

    // Radios en el mismo grupo (por si el name colisiona con otras rows)
    const radioName = "fi-pf-tipo-" + Math.random().toString(36).slice(2, 10);
    row.querySelectorAll('input[type="radio"].fi-pf-tipo').forEach(r => {
      r.name = radioName;
      r.addEventListener("change", () => {
        row.querySelectorAll(".fi-payout-tipo-radio").forEach(l =>
          l.classList.toggle("is-active", l.querySelector("input").checked)
        );
        // Al cambiar tipo, si el destinatario actual no corresponde al tipo, resetear
        const brokerSel = row.querySelector(".fi-pf-broker");
        const opt = brokerSel.selectedOptions[0];
        const optTipo = opt?.dataset?.tipo;
        const newTipo = r.value;
        if (opt && opt.value && optTipo && optTipo !== newTipo) {
          brokerSel.value = "";
        }
      });
    });

    const saldoInp = row.querySelector(".fi-pf-saldo");
    saldoInp.addEventListener("sl-input", recalcSummary);
    saldoInp.addEventListener("input", recalcSummary);

    row.querySelector(".fi-pf-remove").addEventListener("click", () => {
      row.remove();
      if (payoutsListEl.children.length === 0) payoutsEmptyEl.style.display = "";
      recalcSummary();
    });

    payoutsListEl.appendChild(row);
  }

  // ─── Renderiza una fila de payout (versión VIEW / read-only con acción ✉) ───
  function addPayoutRowView(payout, idx) {
    payoutsEmptyEl.style.display = "none";

    const tipo = payout?.tipo || "agencia";
    const tipoClass = tipo === "broker" ? "broker" : "agencia";
    const tipoLabel = TIPO_DEST_LABEL[tipo] || tipo;
    const reporteVal = payout?.reporteFile || "";
    const reporteHtml = reporteVal
      ? (/^https?:\/\//i.test(reporteVal)
          ? `<a href="${escapeHtmlAttr(reporteVal)}" target="_blank" rel="noopener" class="fc-link">🔗 Ver reporte</a>`
          : escapeHtml(reporteVal))
      : `<span class="fc-empty">—</span>`;
    const sentTxt = payout?.emailSentAt
      ? `<span class="fi-view-sent">Enviado · ${escapeHtml(formatFechaUS(String(payout.emailSentAt).slice(0, 10)))}</span>`
      : `<span class="fi-view-sent-none">Sin enviar</span>`;
    const emailBtnTitle = payout?.emailSentAt ? "Reenviar reporte" : "Enviar reporte por email";

    const row = document.createElement("div");
    row.className = "fi-payout-row-view";
    row.dataset.idx = idx;
    row.innerHTML = `
      <div class="fi-view-payout-head">
        <span class="fb-tipo-badge fb-tipo-${tipoClass}">${escapeHtml(tipoLabel)}</span>
        <span class="fi-view-broker">${escapeHtml(payout?.broker || "(sin destinatario)")}</span>
        <button type="button" class="fi-view-email-btn" title="${escapeHtmlAttr(emailBtnTitle)}" data-idx="${idx}">
          <i data-lucide="mail" style="width:14px;height:14px;"></i>
          <span>${payout?.emailSentAt ? "Reenviar" : "Enviar"}</span>
        </button>
      </div>
      <div class="fi-view-payout-body">
        <div class="fi-view-field"><span class="fi-view-label">Reporte:</span> ${reporteHtml}</div>
        <div class="fi-view-field"><span class="fi-view-label">Saldo:</span> <span class="fi-pf-saldo-view" data-value="${payout?.saldo != null ? payout.saldo : 0}">${formatMoney(payout?.saldo)}</span></div>
        <div class="fi-view-field"><span class="fi-view-label">Estado:</span> ${sentTxt}</div>
      </div>
    `;
    payoutsListEl.appendChild(row);
  }

  // ─── Renderiza todos los payouts según el modo actual ───
  function renderPayouts(payouts) {
    payoutsListEl.innerHTML = "";
    if (!Array.isArray(payouts) || payouts.length === 0) {
      payoutsEmptyEl.style.display = "";
      recalcSummary();
      if (window.refreshIcons) window.refreshIcons();
      return;
    }
    payoutsEmptyEl.style.display = "none";
    if (mode === "view") {
      payouts.forEach((p, i) => addPayoutRowView(p, i));
    } else {
      payouts.forEach(p => addPayoutRowEdit(p));
    }
    recalcSummary();
    if (window.refreshIcons) window.refreshIcons();
  }

  // ─── Recolecta los payouts editados desde el DOM ───
  function collectPayoutsFromDom() {
    return Array.from(payoutsListEl.querySelectorAll(".fi-payout-row")).map(r => {
      const tipoInp = r.querySelector('input[type="radio"].fi-pf-tipo:checked');
      const tipo = tipoInp ? tipoInp.value : "agencia";
      const broker = (r.querySelector(".fi-pf-broker").value || "").trim();
      const reporteFile = (r.querySelector(".fi-pf-reporte").value || "").trim();
      const saldo = parseFloat(r.querySelector(".fi-pf-saldo").value);
      // Preservar emailSentAt/emailSentTo si existían en el payout original (por índice)
      return { tipo, broker, reporteFile, saldo };
    });
  }

  addPayoutBtn.addEventListener("click", () => addPayoutRowEdit(null));

  // Render inicial según modo
  renderPayouts(originalPayouts);

  // ─── Dropdown "Descripción depósito" + "+ Agregar nuevo" ───
  const addWrap = dialog.querySelector("#fi-add-desc-deposito-wrap");
  const addInp = dialog.querySelector("#fi-add-desc-deposito-input");
  const addSaveBtn = dialog.querySelector("#fi-add-desc-deposito-save");
  const addCancelBtn = dialog.querySelector("#fi-add-desc-deposito-cancel");

  function rebuildDescDepOptions(selectedValue) {
    const current = descDepSel.value;
    descDepSel.innerHTML = `
      <option value="">— Selecciona —</option>
      ${descDepositoList.map(v =>
        `<option value="${escapeHtmlAttr(v)}" ${v === (selectedValue || current) ? "selected" : ""}>${escapeHtml(v)}</option>`
      ).join("")}
      <option value="__add_new__" class="fi-add-new-option">+ Agregar nuevo...</option>
    `;
  }

  descDepSel.addEventListener("change", () => {
    if (descDepSel.value === "__add_new__") {
      addWrap.style.display = "";
      addInp.focus();
      descDepSel.value = "";
    }
  });

  async function commitNewDescDep() {
    const raw = addInp.value;
    if (!raw.trim()) { addInp.focus(); return; }
    addSaveBtn.disabled = true;
    try {
      const added = await addDescDepositoToList(raw);
      rebuildDescDepOptions(added);
      addInp.value = "";
      addWrap.style.display = "none";
    } catch (e) {
      heroToast.error(e.message);
    } finally {
      addSaveBtn.disabled = false;
    }
  }
  addSaveBtn.addEventListener("click", commitNewDescDep);
  addInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitNewDescDep(); }
    if (e.key === "Escape") { addInp.value = ""; addWrap.style.display = "none"; }
  });
  addCancelBtn.addEventListener("click", () => {
    addInp.value = "";
    addWrap.style.display = "none";
  });

  // ─── Dropdown "Carrier" + "+ Agregar nuevo" (mismo patrón) ───
  const carrierAddWrap = dialog.querySelector("#fi-add-carrier-wrap");
  const carrierAddInp = dialog.querySelector("#fi-add-carrier-input");
  const carrierAddSave = dialog.querySelector("#fi-add-carrier-save");
  const carrierAddCancel = dialog.querySelector("#fi-add-carrier-cancel");

  function rebuildCarrierOptions(selectedValue) {
    const current = carrierSel.value;
    carrierSel.innerHTML = `
      <option value="">— Selecciona —</option>
      ${carriersList.map(c =>
        `<option value="${escapeHtmlAttr(c)}" ${c === (selectedValue || current) ? "selected" : ""}>${escapeHtml(c)}</option>`
      ).join("")}
      <option value="__add_new__" class="fi-add-new-option">+ Agregar nuevo...</option>
    `;
  }

  carrierSel.addEventListener("change", () => {
    if (carrierSel.value === "__add_new__") {
      carrierAddWrap.style.display = "";
      carrierAddInp.focus();
      carrierSel.value = "";
    }
  });

  async function commitNewCarrier() {
    const raw = carrierAddInp.value;
    if (!raw.trim()) { carrierAddInp.focus(); return; }
    carrierAddSave.disabled = true;
    try {
      const added = await addCarrierToList(raw);
      rebuildCarrierOptions(added);
      carrierAddInp.value = "";
      carrierAddWrap.style.display = "none";
      // Refresca el filtro de la tabla también
      populateCarrierFilter();
    } catch (e) {
      heroToast.error(e.message);
    } finally {
      carrierAddSave.disabled = false;
    }
  }
  carrierAddSave.addEventListener("click", commitNewCarrier);
  carrierAddInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitNewCarrier(); }
    if (e.key === "Escape") { carrierAddInp.value = ""; carrierAddWrap.style.display = "none"; }
  });
  carrierAddCancel.addEventListener("click", () => {
    carrierAddInp.value = "";
    carrierAddWrap.style.display = "none";
  });

  // ─── Toggle read-only / editable en los inputs principales ───
  function applyReadOnlyState() {
    const readOnly = (mode === "view");
    // Shoelace inputs / textarea
    dialog.querySelectorAll('sl-input, sl-textarea').forEach(el => {
      if (readOnly) el.setAttribute("readonly", "");
      else el.removeAttribute("readonly");
    });
    // Native controls
    [fechaInp, tipoPagoSel, categoriaSel, carrierSel, descDepSel].forEach(el => {
      if (el) el.disabled = readOnly;
    });
    // Añadir "+ Agregar nuevo" solo tiene sentido editando
    if (readOnly) {
      carrierAddWrap.style.display = "none";
      addWrap.style.display = "none";
    }
  }

  // ─── Alterna entre modos view <-> edit ───
  function applyMode(newMode) {
    if (newMode !== "view" && newMode !== "edit") return;
    mode = newMode;
    dialog.dataset.mode = mode;
    dialog.className = "fi-modal fi-mode-" + mode;
    setDialogLabel();

    // Barra superior (Editar) solo en view
    const topbar = dialog.querySelector(".fi-view-topbar");
    if (topbar) topbar.hidden = (mode !== "view");
    // Botón agregar payout solo en edit
    addPayoutBtn.hidden = (mode !== "edit");
    // Footer: usar style.display para que Shoelace lo respete
    const setBtnVisible = (sel, visible) => {
      const el = dialog.querySelector(sel);
      if (el) el.style.display = visible ? "" : "none";
    };
    setBtnVisible(".fi-btn-close", mode === "view");
    setBtnVisible(".fi-btn-cancel-edit", mode === "edit");
    setBtnVisible(".fi-btn-save", mode === "edit");

    applyReadOnlyState();
    // Re-render payouts en el modo apropiado (usa snapshot original)
    renderPayouts(originalPayouts);
  }

  // Estado inicial de readonly
  applyReadOnlyState();

  // ─── Botón lápiz "Editar" → cambia a modo edit ───
  const editBtn = dialog.querySelector(".fi-edit-btn");
  if (editBtn) editBtn.addEventListener("click", () => applyMode("edit"));

  // ─── Botón "Cerrar" (modo view) → cierra el modal ───
  dialog.querySelector(".fi-btn-close").addEventListener("click", () => dialog.hide());

  // ─── Botón "Cancelar" (modo edit) → si isEdit vuelve a view, si no cierra ───
  dialog.querySelector(".fi-btn-cancel-edit").addEventListener("click", () => {
    if (isEdit) applyMode("view");
    else dialog.hide();
  });

  // ─── Botón ✉ en cada payout (modo view) → abre diálogo de envío ───
  payoutsListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".fi-view-email-btn");
    if (!btn || mode !== "view") return;
    const idx = Number(btn.dataset.idx);
    if (isNaN(idx)) return;
    // Aseguramos que ingreso.id + payouts estén en el objeto actual
    const ingRef = isEdit
      ? (ingresosData.find(r => r.id === existing.id) || existing)
      : existing;
    openSingleEmailDialog(ingRef, idx);
  });

  // ─── Cerrar solo con X o Escape ───
  dialog.addEventListener("sl-request-close", (e) => {
    if (e.detail.source !== "close-button" && e.detail.source !== "keyboard") {
      e.preventDefault();
    }
  });
  dialog.addEventListener("sl-after-show", () => {
    if (window.refreshIcons) window.refreshIcons();
    if (mode === "edit") fechaInp.focus();
  });
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  // ─── Guardar (solo aplica en modo edit) ───
  dialog.querySelector(".fi-btn-save").addEventListener("click", async () => {
    const fecha = (fechaInp.value || "").trim();
    const tipoPago = tipoPagoSel.value;
    const categoria = categoriaSel.value;
    const carrier = (carrierSel.value || "").trim();
    const monto = parseFloat(montoInp.value);
    const descDep = (descDepSel.value || "").trim();
    const descTrans = (descTransInp.value || "").trim();
    const driveUrl = (driveUrlInp.value || "").trim();
    const notas = (notasInp.value || "").trim();

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      fechaInp.focus();
      heroToast.error("La fecha es obligatoria.");
      return;
    }
    if (!TIPOS_PAGO.includes(tipoPago)) { heroToast.error("Tipo de pago inválido."); return; }
    if (!CATEGORIAS.includes(categoria)) { heroToast.error("Categoría inválida."); return; }
    if (!isFinite(monto) || monto < 0) {
      montoInp.focus();
      heroToast.error("El monto es obligatorio y debe ser ≥ 0.");
      return;
    }

    // Recolectar payouts editados + preservar emailSentAt de los originales (por índice)
    const payoutRows = Array.from(payoutsListEl.querySelectorAll(".fi-payout-row"));
    const payouts = [];
    for (let i = 0; i < payoutRows.length; i++) {
      const r = payoutRows[i];
      const tipoInp = r.querySelector('input[type="radio"].fi-pf-tipo:checked');
      const tipo = tipoInp ? tipoInp.value : "agencia";
      const brokerSel = r.querySelector(".fi-pf-broker");
      const reporteInp = r.querySelector(".fi-pf-reporte");
      const saldoInp = r.querySelector(".fi-pf-saldo");
      const broker = (brokerSel.value || "").trim();
      const reporteFile = (reporteInp.value || "").trim();
      const saldo = parseFloat(saldoInp.value);

      if (!broker) { brokerSel.focus(); heroToast.error("Cada payout debe tener un destinatario seleccionado."); return; }
      if (!isFinite(saldo) || saldo < 0) { saldoInp.focus(); heroToast.error(`Saldo inválido para ${broker}.`); return; }

      const payoutObj = { tipo, broker, reporteFile, saldo };
      // Preservar flags de envío del original en la misma posición si existían
      const orig = originalPayouts[i];
      if (orig && orig.emailSentAt) payoutObj.emailSentAt = orig.emailSentAt;
      if (orig && orig.emailSentTo) payoutObj.emailSentTo = orig.emailSentTo;
      payouts.push(payoutObj);
    }

    const pagado = payouts.reduce((s, p) => s + (p.saldo || 0), 0);
    const ganancia = monto - pagado;
    const mes = deriveMes(fecha);

    const payload = {
      fecha,
      mes,
      tipoPago,
      categoria,
      carrier,
      monto,
      descripcionDeposito: descDep,
      descripcionTransaccion: descTrans,
      archivoOriginalDriveUrl: driveUrl,
      payouts,
      pagado,
      ganancia,
      notas,
      actualizadoPor: currentUserEmail,
      actualizadoEn: serverTimestamp()
    };

    try {
      if (isEdit) {
        await updateDoc(doc(db, INGRESOS_COL, existing.id), payload);
        const idx = ingresosData.findIndex(r => r.id === existing.id);
        const updated = { ...ingresosData[idx], ...payload };
        if (idx >= 0) ingresosData[idx] = updated;
        if (fiTable) fiTable.updateRow(existing.id, updated);
        logEvent(ACTIONS.FINANZAS_INGRESO_EDIT, fecha, {
          monto, pagado, ganancia, tipoPago, categoria, carrier, payoutCount: payouts.length
        });
        showFiStatus(`✓ Ingreso de ${formatFechaUS(fecha)} actualizado`);
      } else {
        payload.creadoPor = currentUserEmail;
        payload.creadoEn = serverTimestamp();
        const ref = await addDoc(collection(db, INGRESOS_COL), payload);
        const newRow = { id: ref.id, ...payload };
        ingresosData.push(newRow);
        if (fiTable) fiTable.addRow(newRow, true);
        logEvent(ACTIONS.FINANZAS_INGRESO_ADD, fecha, {
          monto, pagado, ganancia, tipoPago, categoria, carrier, payoutCount: payouts.length
        });
        showFiStatus(`✓ Ingreso de ${formatFechaUS(fecha)} registrado · Ganancia ${formatMoney(ganancia)}`);
      }
      updateIngresosSummary();
      dialog.hide();
    } catch (e) {
      heroToast.error("No se pudo guardar: " + e.message);
    }
  });

  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}


// ─── Helpers de Ingresos ─────────────────────
function deriveMes(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "";
  const [year, month] = dateStr.split("-");
  const idx = parseInt(month, 10) - 1;
  if (idx < 0 || idx > 11) return "";
  return `${MESES_ABREV[idx]} ${year}`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const _moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function formatMoney(n) {
  return _moneyFmt.format(Number(n) || 0);
}

let fiStatusTimeout = null;
function showFiStatus(msg) {
  const el = document.getElementById("fi-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  if (fiStatusTimeout) clearTimeout(fiStatusTimeout);
  fiStatusTimeout = setTimeout(() => el.classList.remove("visible"), 4000);
}


// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function formatPct(decimal) {
  // 1.15 → "115.00%"
  const pct = decimal * 100;
  return `${pct.toFixed(2)}%`;
}
function toPctNumber(decimal) {
  // 1.15 → "115" (sin trailing zeros si es entero, dos decimales si no)
  const pct = decimal * 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}
function escapeHtmlAttr(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let fcStatusTimeout = null;
function showFcStatus(msg) {
  const el = document.getElementById("fc-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  if (fcStatusTimeout) clearTimeout(fcStatusTimeout);
  fcStatusTimeout = setTimeout(() => el.classList.remove("visible"), 3000);
}


// ═══════════════════════════════════════════════════════════
// IMPORTAR — Excel Ingresos + Excel URLs de reportes
// ═══════════════════════════════════════════════════════════
// Task 8. Dos cards independientes:
//   A) INGRESOS 2026.xlsx: importa los ingresos que no existan en Firestore
//      (match por fecha + descDep + monto)
//   B) URLS_INGRESOS_2026.xlsx: rellena `archivoOriginalDriveUrl` y
//      `payouts[N-1].reporteFile` en los ingresos que ya existan
//
// Match: cada URL trae (MES, ID, TIPO). El ID no es el ID de Firestore,
// pero apunta a una fila del otro Excel, de donde sacamos (fecha, descDep,
// monto) y con eso encontramos el ingreso en Firestore.

const MESES_TO_NUM = {
  "ENE": 1, "ENERO": 1, "FEB": 2, "FEBRERO": 2, "MAR": 3, "MARZO": 3,
  "ABRIL": 4, "ABR": 4, "MAY": 5, "MAYO": 5, "JUN": 6, "JUNIO": 6,
  "JUL": 7, "JULIO": 7, "AGO": 8, "AGOS": 8, "AGOSTO": 8,
  "SEP": 9, "SEPT": 9, "SEPTIEMBRE": 9, "OCT": 10, "OCTUBRE": 10,
  "NOV": 11, "NOVIEMBRE": 11, "DIC": 12, "DICIEMBRE": 12
};

const fimpState = {
  ingresosParsed: null,    // Array de ingresos normalizados desde el Excel
  ingresosDiff: null,      // { nuevos: [...], modificados: [{parsed, fsIngreso, diffs}], sinCambios: [...] }
  urlsParsed: null,        // Array de URLs {mes, id, fecha, tipo, nombre, url}
  urlsDiff: null           // { matched: [...], huerfanos: [...] }
};

function bindImportarStaticHandlers() {
  const iFile = document.getElementById("fimp-ingresos-file");
  if (iFile && !iFile.dataset.bound) {
    iFile.dataset.bound = "1";
    iFile.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleIngresosFile(f);
    });
  }
  const iApply = document.getElementById("fimp-ingresos-apply");
  if (iApply && !iApply.dataset.bound) {
    iApply.dataset.bound = "1";
    iApply.addEventListener("click", applyIngresosImport);
  }

  const uFile = document.getElementById("fimp-urls-file");
  if (uFile && !uFile.dataset.bound) {
    uFile.dataset.bound = "1";
    uFile.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleUrlsFile(f);
    });
  }
  const uApply = document.getElementById("fimp-urls-apply");
  if (uApply && !uApply.dataset.bound) {
    uApply.dataset.bound = "1";
    uApply.addEventListener("click", applyUrlsImport);
  }
}

function bindImportarLazyInit() {
  document.querySelectorAll('.admin-sidebar-link[data-tab="importar"]').forEach(b => {
    if (b.dataset.fimpBound) return;
    b.dataset.fimpBound = "1";
    b.addEventListener("click", async () => {
      // Asegura que los ingresos de Firestore estén cargados para hacer el diff
      if (ingresosData.length === 0) {
        try { await loadIngresos(); } catch (_) {}
      }
    });
  });
}

// ─── Helpers de normalización ─────────────────────────────
function parseFechaExcel(val) {
  if (!val) return null;
  // Date object (cellDates:true)
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // String
  const s = String(val).trim();
  // MM/DD/YYYY o MM/DD/YY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y = 2000 + y;
    return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  return null;
}

function parseMontoExcel(val) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[\s$,]/g, "").replace(/[()]/g, "-");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalizeDescDep(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function ingresoKey(fecha, descDep, monto) {
  return `${fecha}|${normalizeDescDep(descDep)}|${(Math.round(monto * 100) / 100).toFixed(2)}`;
}

// Normaliza un array de payouts para comparación (ignora broker/tipo que el Excel no
// puede saber, y compara reporteFile solo si NO es una URL — las URLs vienen del otro
// import y no deben perderse cuando el Excel dice el nombre de archivo original).
function payoutsFingerprint(payouts) {
  if (!Array.isArray(payouts)) return "";
  return payouts
    .map(p => {
      const saldo = (Math.round(Number(p?.saldo || 0) * 100) / 100).toFixed(2);
      const ref = String(p?.reporteFile || "").trim();
      // Si el reporteFile actual es URL (http), lo dejamos aparte y solo comparamos el saldo.
      const refKey = /^https?:\/\//i.test(ref) ? "<URL>" : ref.toLowerCase();
      return `${saldo}|${refKey}`;
    })
    .join(";");
}

// Compara una fila parseada del Excel contra su equivalente en Firestore. Devuelve
// { hasChanges, diffs: [{ campo, actual, nuevo }] }. Solo compara campos que el
// Excel de INGRESOS puede setear — carrier y archivoOriginalDriveUrl NO están en
// ese Excel y no se tocan (vienen del import de URLs o del modal manual).
function compareIngreso(excel, fs) {
  const diffs = [];
  const check = (campo, actual, nuevo) => {
    const a = String(actual == null ? "" : actual).trim();
    const n = String(nuevo == null ? "" : nuevo).trim();
    if (a !== n) diffs.push({ campo, actual: a, nuevo: n });
  };
  check("tipoPago", fs.tipoPago, excel.tipoPago);
  check("categoria", fs.categoria, excel.categoria);
  check("descripcionTransaccion", fs.descripcionTransaccion, excel.descripcionTransaccion);
  check("notas", fs.notas, excel.notas);

  const fpFs = payoutsFingerprint(fs.payouts);
  const fpEx = payoutsFingerprint(excel.payouts);
  if (fpFs !== fpEx) {
    const nFs = Array.isArray(fs.payouts) ? fs.payouts.length : 0;
    const nEx = Array.isArray(excel.payouts) ? excel.payouts.length : 0;
    diffs.push({
      campo: "payouts",
      actual: `${nFs} payout(s)`,
      nuevo: `${nEx} payout(s)`
    });
  }
  return { hasChanges: diffs.length > 0, diffs };
}

// Merge inteligente de payouts entre Excel (fuente) y Firestore (existente).
// Preserva `broker`, `tipo` y las URLs de `reporteFile` de Firestore (esas
// URLs vienen del import de URLs; el Excel de ingresos solo tiene nombres de
// archivo). Toma `saldo` y `reporteFile` (si no era URL) del Excel.
function mergePayouts(excelPayouts, fsPayouts) {
  const out = [];
  const ex = Array.isArray(excelPayouts) ? excelPayouts : [];
  const fs = Array.isArray(fsPayouts) ? fsPayouts : [];
  const len = Math.max(ex.length, fs.length);
  for (let i = 0; i < len; i++) {
    const e = ex[i];
    const f = fs[i];
    if (!e && f) { out.push({ ...f }); continue; } // Firestore extra — preservar
    if (e && !f) { out.push({ ...e }); continue; } // Excel extra — agregar
    if (!e && !f) continue;
    // Ambos existen: Excel manda para saldo; reporteFile preserva URL si aplica
    const fsRefIsUrl = /^https?:\/\//i.test(String(f.reporteFile || ""));
    out.push({
      tipo: f.tipo || e.tipo || "agencia",
      broker: f.broker || e.broker || "",
      reporteFile: fsRefIsUrl ? f.reporteFile : e.reporteFile,
      saldo: e.saldo
    });
  }
  return out;
}

function inferMesFromSheetName(name) {
  const s = String(name || "").toUpperCase().trim();
  const parts = s.split(/\s+/);
  const mesToken = parts[0];
  const yearToken = parts[1] ? parseInt(parts[1], 10) : new Date().getFullYear();
  const mesNum = MESES_TO_NUM[mesToken];
  if (!mesNum) return null;
  return { mes: mesNum, year: yearToken };
}

// ─── Parser del Excel de INGRESOS ─────────────────────────
function parseIngresosWorkbook(wb) {
  const results = [];
  for (const sheetName of wb.SheetNames) {
    const mesInfo = inferMesFromSheetName(sheetName);
    if (!mesInfo) continue; // hoja LIFE u otra
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    if (!aoa || aoa.length < 2) continue;

    // El Excel puede tener filas en blanco antes del header. Detectamos la
    // fila del header buscando la que empiece con "ID" en index 0.
    let headerRow = -1;
    for (let r = 0; r < Math.min(aoa.length, 20); r++) {
      if (String(aoa[r]?.[0] || "").trim().toUpperCase() === "ID") { headerRow = r; break; }
    }
    if (headerRow === -1) continue;
    const header = aoa[headerRow];

    // Encontrar índice de "PAGADO" para saber cuántos pares (rep, saldo)
    let pagadoIdx = -1;
    for (let i = 0; i < header.length; i++) {
      if (String(header[i] || "").trim().toUpperCase() === "PAGADO") { pagadoIdx = i; break; }
    }
    if (pagadoIdx === -1) continue;
    // Los payouts van de índice 8 hasta pagadoIdx-1, en pares (rep, saldo)
    const numPayouts = Math.max(0, Math.floor((pagadoIdx - 8) / 2));

    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const firstCell = row[0];
      if (!firstCell || String(firstCell).trim() === "" || String(firstCell).toUpperCase() === "TOTAL") continue;
      if (!row[1]) continue;

      const fecha = parseFechaExcel(row[1]);
      if (!fecha) continue;
      const tipoPago = String(row[2] || "").trim().toUpperCase();
      const categoria = String(row[3] || "").trim().toUpperCase();
      const descDep = String(row[4] || "").trim();
      const descTrans = String(row[5] || "").trim();
      const monto = parseMontoExcel(row[6]);
      const archivoOriginal = String(row[7] || "").trim();

      // Payouts — el Excel guarda chargebacks con signo negativo pero en
      // Firestore siempre se almacenan positivos (misma convención que la
      // migración anterior de 233 registros).
      const payouts = [];
      for (let p = 0; p < numPayouts; p++) {
        const repIdx = 8 + p * 2;
        const saldoIdx = 9 + p * 2;
        const rep = String(row[repIdx] || "").trim();
        const saldoRaw = parseMontoExcel(row[saldoIdx]);
        const saldo = Math.abs(saldoRaw);
        if (saldo > 0 || rep) {
          payouts.push({ tipo: "agencia", broker: "", reporteFile: rep, saldo });
        }
      }

      const pagado = payouts.reduce((s, p) => s + p.saldo, 0);
      const ganancia = monto - pagado;

      results.push({
        excelId: String(row[0]).padStart(2, "0"),
        excelMes: sheetName,
        fecha,
        mes: `${["", "ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"][mesInfo.mes]} ${mesInfo.year}`,
        tipoPago: TIPOS_PAGO.includes(tipoPago) ? tipoPago : "OTROS",
        categoria: CATEGORIAS.includes(categoria) ? categoria : "COMISSION",
        carrier: "",
        descripcionDeposito: descDep,
        descripcionTransaccion: descTrans,
        monto,
        archivoOriginalDriveUrl: "", // solo si viene URL en el otro Excel
        _archivoOriginalNombre: archivoOriginal, // temporal para debug/match
        payouts,
        pagado,
        ganancia,
        notas: String(row[header.length - 1] || "").trim()
      });
    }
  }
  return results;
}

// ─── Render del preview de import de ingresos (DOM API pura) ─────
function renderIngresosImportPreview(root, data) {
  const { parsed, nuevos, modificados, sinCambios } = data;
  const CAMPO_LABEL = {
    tipoPago: "Tipo pago",
    categoria: "Categoría",
    descripcionTransaccion: "Desc. transacción",
    notas: "Notas",
    payouts: "Payouts"
  };
  const shortenTxt = (s, n = 32) => {
    const t = String(s || "").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const stat = (label, value, valueClass) => {
    const wrap = el("div", "fimp-stat");
    wrap.appendChild(el("div", "fimp-stat-label", label));
    wrap.appendChild(el("div", "fimp-stat-value" + (valueClass ? " " + valueClass : ""), String(value)));
    return wrap;
  };

  root.hidden = false;
  while (root.firstChild) root.removeChild(root.firstChild);

  root.appendChild(el("div", "fimp-preview-title", "Resumen"));

  const stats = el("div", "fimp-preview-stats");
  stats.appendChild(stat("Total en Excel", parsed.length, "neu"));
  stats.appendChild(stat("Sin cambios", sinCambios.length));
  stats.appendChild(stat("Modificados", modificados.length, "warn"));
  stats.appendChild(stat("Nuevos a importar", nuevos.length, "pos"));
  root.appendChild(stats);

  const buildTable = (headers) => {
    const t = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const h of headers) trh.appendChild(el("th", null, h));
    thead.appendChild(trh);
    t.appendChild(thead);
    t.appendChild(document.createElement("tbody"));
    return t;
  };

  if (nuevos.length) {
    const det = el("div", "fimp-preview-details");
    det.appendChild(el("div", "fimp-preview-subtitle", "Nuevos (se crearán)"));
    const table = buildTable(["Mes", "Fecha", "Desc. depósito", "Monto"]);
    const tbody = table.querySelector("tbody");
    for (const n of nuevos.slice(0, 30)) {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", null, n.excelMes));
      tr.appendChild(el("td", null, formatFechaUS(n.fecha)));
      tr.appendChild(el("td", null, n.descripcionDeposito));
      tr.appendChild(el("td", null, formatMoney(n.monto)));
      tbody.appendChild(tr);
    }
    det.appendChild(table);
    if (nuevos.length > 30) {
      const p = el("p", "fimp-preview-hint", `Mostrando 30 de ${nuevos.length}. El resto se importa igual.`);
      det.appendChild(p);
    }
    root.appendChild(det);
  }

  if (modificados.length) {
    const det = el("div", "fimp-preview-details");
    det.appendChild(el("div", "fimp-preview-subtitle", "Modificados (se actualizarán)"));
    const table = buildTable(["Fecha", "Desc. depósito", "Campos que cambian"]);
    const tbody = table.querySelector("tbody");
    for (const m of modificados.slice(0, 30)) {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", null, formatFechaUS(m.parsed.fecha)));
      tr.appendChild(el("td", null, m.parsed.descripcionDeposito));
      const tdDiffs = document.createElement("td");
      for (const d of m.diffs) {
        const line = el("div", "fimp-diff-line");
        const strong = el("strong", null, (CAMPO_LABEL[d.campo] || d.campo) + ": ");
        const before = el("span", "fimp-diff-before", shortenTxt(d.actual) || "—");
        const arrow = document.createTextNode(" → ");
        const after = el("span", "fimp-diff-after", shortenTxt(d.nuevo) || "—");
        line.appendChild(strong);
        line.appendChild(before);
        line.appendChild(arrow);
        line.appendChild(after);
        tdDiffs.appendChild(line);
      }
      tr.appendChild(tdDiffs);
      tbody.appendChild(tr);
    }
    det.appendChild(table);
    if (modificados.length > 30) {
      const p = el("p", "fimp-preview-hint", `Mostrando 30 de ${modificados.length}. El resto se actualiza igual.`);
      det.appendChild(p);
    }
    root.appendChild(det);
  }

  if (!nuevos.length && !modificados.length) {
    root.appendChild(el("p", "fimp-preview-empty", "Todo el Excel ya está en Firestore sin cambios. Nada que importar."));
  }
}

// ─── Handler: subir Excel de ingresos ─────────────────────
async function handleIngresosFile(file) {
  const nameEl = document.getElementById("fimp-ingresos-filename");
  const previewEl = document.getElementById("fimp-ingresos-preview");
  const applyBtn = document.getElementById("fimp-ingresos-apply");
  const statusEl = document.getElementById("fimp-ingresos-status");
  if (nameEl) nameEl.textContent = file.name;
  if (statusEl) { statusEl.textContent = "Procesando..."; statusEl.className = "fimp-status"; }
  applyBtn.disabled = true;

  if (typeof XLSX === "undefined") {
    statusEl.textContent = "✕ La librería XLSX no está cargada aún, espera un segundo y reintenta.";
    statusEl.className = "fimp-status error";
    return;
  }

  try {
    // Asegurar que ingresos Firestore están cargados
    if (ingresosData.length === 0) await loadIngresos();

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const parsed = parseIngresosWorkbook(wb);
    if (!parsed.length) {
      statusEl.textContent = "✕ No se encontraron ingresos válidos en el Excel.";
      statusEl.className = "fimp-status error";
      return;
    }

    // Diff con Firestore — 3 categorías: nuevos, modificados y sin cambios
    const firestoreByKey = new Map();
    for (const r of ingresosData) {
      firestoreByKey.set(ingresoKey(r.fecha, r.descripcionDeposito, r.monto), r);
    }
    const nuevos = [];
    const modificados = []; // { parsed, fsIngreso, diffs }
    const sinCambios = [];
    for (const p of parsed) {
      const k = ingresoKey(p.fecha, p.descripcionDeposito, p.monto);
      const fs = firestoreByKey.get(k);
      if (!fs) { nuevos.push(p); continue; }
      const cmp = compareIngreso(p, fs);
      if (cmp.hasChanges) modificados.push({ parsed: p, fsIngreso: fs, diffs: cmp.diffs });
      else sinCambios.push(p);
    }

    fimpState.ingresosParsed = parsed;
    fimpState.ingresosDiff = { nuevos, modificados, sinCambios };

    // Render del preview con DOM API — evita inyección de HTML en descripciones
    // del Excel (que en la práctica escapamos igual, pero el approach es más seguro).
    renderIngresosImportPreview(previewEl, { parsed, nuevos, modificados, sinCambios });
    applyBtn.disabled = (nuevos.length + modificados.length) === 0;
    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = "✕ Error: " + (e?.message || e);
    statusEl.className = "fimp-status error";
    console.error(e);
  }
}

// ─── Apply: importar nuevos + actualizar modificados ────────
async function applyIngresosImport() {
  const statusEl = document.getElementById("fimp-ingresos-status");
  const applyBtn = document.getElementById("fimp-ingresos-apply");
  if (!fimpState.ingresosDiff) {
    statusEl.textContent = "No hay ingresos parseados.";
    return;
  }
  const { nuevos = [], modificados = [] } = fimpState.ingresosDiff;
  if (!nuevos.length && !modificados.length) {
    statusEl.textContent = "Nada que importar ni actualizar.";
    return;
  }

  const partes = [];
  if (nuevos.length) partes.push(`crear ${nuevos.length} nuevos`);
  if (modificados.length) partes.push(`actualizar ${modificados.length} existentes`);
  const okImport = await heroConfirm({
    title: "Importar ingresos",
    message: `¿Confirmas ${partes.join(" y ")}? Esta acción no se puede deshacer.`,
    confirmLabel: "Aplicar",
    variant: modificados.length ? "warning" : "primary"
  });
  if (!okImport) return;

  applyBtn.disabled = true;
  statusEl.className = "fimp-status";

  const BATCH_SIZE = 400;
  let inserted = 0;
  let updated = 0;

  try {
    // ── Fase 1: crear los nuevos ──
    for (let i = 0; i < nuevos.length; i += BATCH_SIZE) {
      const chunk = nuevos.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      const newDocs = [];
      for (const p of chunk) {
        const docRef = doc(collection(db, INGRESOS_COL));
        const payload = {
          fecha: p.fecha,
          mes: p.mes,
          tipoPago: p.tipoPago,
          categoria: p.categoria,
          carrier: p.carrier || "",
          monto: p.monto,
          descripcionDeposito: p.descripcionDeposito,
          descripcionTransaccion: p.descripcionTransaccion,
          archivoOriginalDriveUrl: p.archivoOriginalDriveUrl || "",
          payouts: p.payouts,
          pagado: p.pagado,
          ganancia: p.ganancia,
          notas: p.notas || "",
          creadoPor: currentUserEmail,
          creadoEn: serverTimestamp(),
          actualizadoPor: currentUserEmail,
          actualizadoEn: serverTimestamp(),
          origen: "import-excel"
        };
        batch.set(docRef, payload);
        newDocs.push({ id: docRef.id, ...payload, creadoEn: new Date(), actualizadoEn: new Date() });
      }
      await batch.commit();
      for (const nd of newDocs) {
        ingresosData.push(nd);
        if (fiTable) { try { fiTable.addRow(nd); } catch (_) {} }
        logEvent(ACTIONS.FINANZAS_INGRESO_ADD, nd.fecha, {
          origen: "import-excel", monto: nd.monto, tipoPago: nd.tipoPago, categoria: nd.categoria
        });
      }
      inserted += chunk.length;
      statusEl.textContent = `Creados ${inserted} de ${nuevos.length}...`;
    }

    // ── Fase 2: actualizar los modificados ──
    for (let i = 0; i < modificados.length; i += BATCH_SIZE) {
      const chunk = modificados.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      const updates = [];
      for (const m of chunk) {
        const p = m.parsed;
        const mergedPayouts = mergePayouts(p.payouts, m.fsIngreso.payouts);
        const pagado = mergedPayouts.reduce((s, x) => s + Number(x.saldo || 0), 0);
        const ganancia = p.monto - pagado;
        const patch = {
          tipoPago: p.tipoPago,
          categoria: p.categoria,
          descripcionTransaccion: p.descripcionTransaccion,
          notas: p.notas || "",
          payouts: mergedPayouts,
          pagado,
          ganancia,
          actualizadoPor: currentUserEmail,
          actualizadoEn: serverTimestamp()
        };
        batch.update(doc(db, INGRESOS_COL, m.fsIngreso.id), patch);
        updates.push({ id: m.fsIngreso.id, patch, fecha: m.fsIngreso.fecha, diffs: m.diffs });
      }
      await batch.commit();
      for (const u of updates) {
        const idx = ingresosData.findIndex(r => r.id === u.id);
        if (idx >= 0) {
          Object.assign(ingresosData[idx], u.patch, { actualizadoEn: new Date() });
          if (fiTable) { try { fiTable.updateRow(u.id, u.patch); } catch (_) {} }
        }
        logEvent(ACTIONS.FINANZAS_INGRESO_EDIT, u.fecha, {
          origen: "import-excel",
          campos: u.diffs.map(d => d.campo)
        });
      }
      updated += chunk.length;
      statusEl.textContent = `Actualizados ${updated} de ${modificados.length}...`;
    }

    // ── Cierre ──
    const resumen = [];
    if (inserted) resumen.push(`${inserted} creados`);
    if (updated) resumen.push(`${updated} actualizados`);
    statusEl.textContent = `✓ Import completado: ${resumen.join(" · ")}.`;
    statusEl.className = "fimp-status success";
    updateIngresosSummary();
    populateCarrierFilter();
    document.getElementById("fimp-ingresos-preview").hidden = true;
    document.getElementById("fimp-ingresos-filename").textContent = "Seleccionar archivo…";
    document.getElementById("fimp-ingresos-file").value = "";
    fimpState.ingresosDiff = null;
  } catch (e) {
    statusEl.textContent = `✕ Falló (creados ${inserted}, actualizados ${updated}): ${e.message}`;
    statusEl.className = "fimp-status error";
    console.error(e);
  } finally {
    applyBtn.disabled = false;
  }
}

// ─── Parser del Excel de URLs ─────────────────────────────
function parseUrlsWorkbook(wb) {
  // Espera hoja "URLS" con header: MES, ID, FECHA, TIPO, COL, FILA, NOMBRE VISIBLE, URL
  const ws = wb.Sheets["URLS"] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  if (aoa.length < 2) return [];
  const results = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || !row[0]) continue;
    const mes = String(row[0]).trim();
    const id = String(row[1] || "").padStart(2, "0");
    const fecha = parseFechaExcel(row[2]);
    const tipo = String(row[3] || "").trim().toUpperCase();
    const nombre = String(row[6] || "").trim();
    const url = String(row[7] || "").trim();
    if (!url || !url.startsWith("http")) continue;
    results.push({ mes, id, fecha, tipo, nombre, url });
  }
  return results;
}

// ─── Handler: subir Excel de URLs ─────────────────────────
async function handleUrlsFile(file) {
  const nameEl = document.getElementById("fimp-urls-filename");
  const previewEl = document.getElementById("fimp-urls-preview");
  const applyBtn = document.getElementById("fimp-urls-apply");
  const statusEl = document.getElementById("fimp-urls-status");
  if (nameEl) nameEl.textContent = file.name;
  if (statusEl) { statusEl.textContent = "Procesando..."; statusEl.className = "fimp-status"; }
  applyBtn.disabled = true;

  if (typeof XLSX === "undefined") {
    statusEl.textContent = "✕ La librería XLSX no está cargada.";
    statusEl.className = "fimp-status error";
    return;
  }
  if (!fimpState.ingresosParsed) {
    statusEl.textContent = "✕ Primero carga el Excel de INGRESOS 2026 arriba (necesario para el lookup por MES+ID).";
    statusEl.className = "fimp-status error";
    return;
  }

  try {
    if (ingresosData.length === 0) await loadIngresos();

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const urls = parseUrlsWorkbook(wb);
    fimpState.urlsParsed = urls;
    if (!urls.length) {
      statusEl.textContent = "✕ No se encontraron URLs válidas.";
      statusEl.className = "fimp-status error";
      return;
    }

    // Index de ingresos parseados del Excel por (mes, id)
    const idxByMesId = {};
    fimpState.ingresosParsed.forEach(p => {
      idxByMesId[`${p.excelMes}|${p.excelId}`] = p;
    });
    // Index de Firestore ingresos por key (fecha, descDep, monto)
    const idxFs = {};
    ingresosData.forEach(r => {
      idxFs[ingresoKey(r.fecha, r.descripcionDeposito, r.monto)] = r;
    });

    const matched = []; // { url, fsIngreso, tipoUrl (archivo|pago), payoutIdx }
    const huerfanos = []; // urls sin match
    for (const u of urls) {
      const excelRow = idxByMesId[`${u.mes}|${u.id}`];
      if (!excelRow) { huerfanos.push({ ...u, motivo: "no está en INGRESOS.xlsx" }); continue; }
      const fs = idxFs[ingresoKey(excelRow.fecha, excelRow.descripcionDeposito, excelRow.monto)];
      if (!fs) { huerfanos.push({ ...u, motivo: "no está en Firestore" }); continue; }
      if (u.tipo === "ARCHIVO ORIGINAL") {
        matched.push({ url: u, fsIngreso: fs, tipoUrl: "archivo", payoutIdx: null });
      } else if (/^PAGO\s+(\d+)/.test(u.tipo)) {
        const m = u.tipo.match(/^PAGO\s+(\d+)/);
        const payoutIdx = parseInt(m[1], 10) - 1;
        matched.push({ url: u, fsIngreso: fs, tipoUrl: "pago", payoutIdx });
      } else {
        huerfanos.push({ ...u, motivo: "tipo desconocido: " + u.tipo });
      }
    }

    fimpState.urlsDiff = { matched, huerfanos };
    const cntArchivo = matched.filter(m => m.tipoUrl === "archivo").length;
    const cntPago = matched.filter(m => m.tipoUrl === "pago").length;

    previewEl.hidden = false;
    previewEl.innerHTML = `
      <div class="fimp-preview-title">Resumen URLs</div>
      <div class="fimp-preview-stats">
        <div class="fimp-stat">
          <div class="fimp-stat-label">Total URLs</div>
          <div class="fimp-stat-value neu">${urls.length}</div>
        </div>
        <div class="fimp-stat">
          <div class="fimp-stat-label">Match a ingreso</div>
          <div class="fimp-stat-value pos">${matched.length}</div>
        </div>
        <div class="fimp-stat">
          <div class="fimp-stat-label">Archivo original</div>
          <div class="fimp-stat-value">${cntArchivo}</div>
        </div>
        <div class="fimp-stat">
          <div class="fimp-stat-label">Payouts</div>
          <div class="fimp-stat-value">${cntPago}</div>
        </div>
        <div class="fimp-stat">
          <div class="fimp-stat-label">Huérfanos</div>
          <div class="fimp-stat-value warn">${huerfanos.length}</div>
        </div>
      </div>
      ${huerfanos.length ? `
        <div class="fimp-preview-details">
          <table>
            <thead><tr><th>Mes</th><th>ID</th><th>Tipo</th><th>Motivo</th></tr></thead>
            <tbody>
              ${huerfanos.slice(0, 20).map(h => `
                <tr>
                  <td>${escapeHtml(h.mes)}</td>
                  <td>${escapeHtml(h.id)}</td>
                  <td>${escapeHtml(h.tipo)}</td>
                  <td>${escapeHtml(h.motivo)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          ${huerfanos.length > 20 ? `<p style="margin:8px 0 0;font-size:11.5px;color:rgba(15,23,42,0.5);">Mostrando 20 de ${huerfanos.length}.</p>` : ""}
        </div>
      ` : ""}
    `;

    applyBtn.disabled = matched.length === 0;
    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = "✕ Error: " + (e?.message || e);
    statusEl.className = "fimp-status error";
    console.error(e);
  }
}

// ─── Apply: actualizar URLs en los ingresos ─────────────────
async function applyUrlsImport() {
  const statusEl = document.getElementById("fimp-urls-status");
  const applyBtn = document.getElementById("fimp-urls-apply");
  if (!fimpState.urlsDiff || !fimpState.urlsDiff.matched.length) {
    statusEl.textContent = "No hay URLs para aplicar.";
    return;
  }
  const matched = fimpState.urlsDiff.matched;
  const okUrls = await heroConfirm({
    title: "Actualizar URLs",
    message: `¿Confirmas actualizar ${matched.length} URLs en Firestore? Esto puede sobreescribir URLs previas.`,
    confirmLabel: "Actualizar",
    variant: "warning"
  });
  if (!okUrls) return;

  applyBtn.disabled = true;
  statusEl.textContent = `Aplicando ${matched.length} URLs...`;
  statusEl.className = "fimp-status";

  // Agrupar por ingreso — un solo update por doc con todos los cambios
  const updatesPerDoc = {};
  for (const m of matched) {
    const id = m.fsIngreso.id;
    if (!updatesPerDoc[id]) {
      updatesPerDoc[id] = {
        fsIngreso: m.fsIngreso,
        archivoOriginalDriveUrl: m.fsIngreso.archivoOriginalDriveUrl || "",
        payouts: Array.isArray(m.fsIngreso.payouts) ? m.fsIngreso.payouts.map(p => ({ ...p })) : []
      };
    }
    const u = updatesPerDoc[id];
    if (m.tipoUrl === "archivo") {
      u.archivoOriginalDriveUrl = m.url.url;
    } else if (m.tipoUrl === "pago" && m.payoutIdx != null) {
      // Asegura el índice del payout
      while (u.payouts.length <= m.payoutIdx) {
        u.payouts.push({ tipo: "agencia", broker: "", reporteFile: "", saldo: 0 });
      }
      u.payouts[m.payoutIdx].reporteFile = m.url.url;
    }
  }

  const ids = Object.keys(updatesPerDoc);
  let done = 0;
  const BATCH_SIZE = 400;
  try {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        const up = updatesPerDoc[id];
        batch.update(doc(db, INGRESOS_COL, id), {
          archivoOriginalDriveUrl: up.archivoOriginalDriveUrl,
          payouts: up.payouts,
          actualizadoPor: currentUserEmail,
          actualizadoEn: serverTimestamp()
        });
      }
      await batch.commit();
      // Sync local
      for (const id of chunk) {
        const up = updatesPerDoc[id];
        const idx = ingresosData.findIndex(r => r.id === id);
        if (idx >= 0) {
          ingresosData[idx].archivoOriginalDriveUrl = up.archivoOriginalDriveUrl;
          ingresosData[idx].payouts = up.payouts;
          if (fiTable) { try { fiTable.updateRow(id, { archivoOriginalDriveUrl: up.archivoOriginalDriveUrl, payouts: up.payouts }); } catch (_) {} }
        }
        logEvent(ACTIONS.FINANZAS_INGRESO_EDIT, up.fsIngreso.fecha, {
          origen: "import-urls-excel",
          archivoOriginal: !!up.archivoOriginalDriveUrl,
          payoutUrls: up.payouts.filter(p => p.reporteFile).length
        });
      }
      done += chunk.length;
      statusEl.textContent = `Actualizado ${done} de ${ids.length} ingresos...`;
    }
    statusEl.textContent = `✓ Aplicado a ${done} ingresos.`;
    statusEl.className = "fimp-status success";
    document.getElementById("fimp-urls-preview").hidden = true;
    document.getElementById("fimp-urls-filename").textContent = "Seleccionar archivo…";
    document.getElementById("fimp-urls-file").value = "";
    fimpState.urlsDiff = null;
  } catch (e) {
    statusEl.textContent = `✕ Falló (${done}/${ids.length}): ${e.message}`;
    statusEl.className = "fimp-status error";
    console.error(e);
  } finally {
    applyBtn.disabled = false;
  }
}
