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
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { logEvent, ACTIONS } from "./audit-log.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

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
  bindDashboardStaticHandlers();
  bindDashboardLazyInit();
  bindComparativasStaticHandlers();
  bindComparativasLazyInit();
  bindExportarStaticHandlers();
  bindExportarLazyInit();
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
    alert(msg);
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
  if (!confirm(`¿Eliminar esta fila?\n\n${label}\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, COMISIONES_COL, id));
  } catch (e) {
    alert("Error al eliminar: " + e.message);
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

    if (!carrier) { alert("El carrier es obligatorio."); carrierInp.focus(); return; }
    if (!TIPOS_ORIGEN.includes(tipoOrigen)) { alert("Tipo de origen inválido."); return; }
    if (!tasaPctRaw) { alert("La tasa es obligatoria."); tasaInp.focus(); return; }

    const tasaPct = Number(tasaPctRaw);
    if (!isFinite(tasaPct) || tasaPct < 0) { alert("La tasa debe ser un número ≥ 0."); tasaInp.focus(); return; }
    if (tipoOrigen === "AGENTES" && !agente) {
      alert("Cuando el origen es AGENTES, el nombre del agente es obligatorio.");
      agenteInp.focus(); return;
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
      alert("Error al guardar: " + e.message);
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
const fbFilter = { text: "" };


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
    alert(msg);
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
    placeholder: "Aún no hay brokers. Agrega el primero con el botón “Nuevo broker”.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "brokers", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Broker",
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
  el.textContent = visible === total
    ? `${total} broker${total === 1 ? "" : "s"}`
    : `${visible} de ${total}`;
}

function onEditBroker(id) {
  const row = brokersData.find(r => r.id === id);
  if (!row) return;
  openBrokerModal(row);
}

async function onDeleteBroker(id) {
  const row = brokersData.find(r => r.id === id);
  if (!row) return;
  if (!confirm(`¿Eliminar al broker "${row.nombre}"?\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, BROKERS_COL, id));
  } catch (e) {
    alert("Error al eliminar: " + e.message);
    return;
  }

  logEvent(ACTIONS.FINANZAS_BROKER_DELETE, row.nombre || id, {
    email: row.email || null
  });

  brokersData = brokersData.filter(r => r.id !== id);
  if (fbTable) fbTable.deleteRow(id);
  updateBrokersTotal();
  showFbStatus(`✓ Broker ${row.nombre || "?"} eliminado`);
}

function openBrokerModal(existing) {
  const isEdit = !!existing;

  const dialog = document.createElement("sl-dialog");
  dialog.label = isEdit ? "Editar broker" : "Nuevo broker";
  dialog.className = "fc-modal";
  dialog.innerHTML = `
    <div class="fc-form">
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
        label="Email"
        type="email"
        placeholder="contacto@broker.com (opcional)"
        value="${escapeHtmlAttr(existing?.email || "")}"
        autocomplete="off"
        clearable>
      </sl-input>

      <sl-input
        id="fb-f-telefono"
        label="Teléfono"
        placeholder="+1 555 1234 (opcional)"
        value="${escapeHtmlAttr(existing?.telefono || "")}"
        autocomplete="off"
        clearable>
      </sl-input>

      <sl-textarea
        id="fb-f-notas"
        label="Notas"
        placeholder="Observaciones, condiciones especiales, fecha de alta..."
        rows="3"
        resize="auto"
        value="${escapeHtmlAttr(existing?.notas || "")}">
      </sl-textarea>
    </div>

    <sl-button slot="footer" id="fb-f-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="fb-f-save" variant="primary">
      <i data-lucide="${isEdit ? "save" : "plus"}" slot="prefix" style="width:14px;height:14px;"></i>
      ${isEdit ? "Guardar cambios" : "Agregar broker"}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  const nombreInp = dialog.querySelector("#fb-f-nombre");
  const emailInp = dialog.querySelector("#fb-f-email");
  const telInp = dialog.querySelector("#fb-f-telefono");
  const notasInp = dialog.querySelector("#fb-f-notas");

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

    if (!nombre) { alert("El nombre del broker es obligatorio."); nombreInp.focus(); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("El email no tiene un formato válido.");
      emailInp.focus(); return;
    }

    const nombreNorm = nombre.toUpperCase();

    const payload = {
      nombre: nombreNorm,
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
          email: email || null,
          from: { nombre: existing.nombre, email: existing.email || null }
        });
        showFbStatus(`✓ ${nombreNorm} actualizado`);
      } else {
        payload.creadoPor = currentUserEmail;
        payload.creadoEn = serverTimestamp();
        const ref = await addDoc(collection(db, BROKERS_COL), payload);
        const newRow = { id: ref.id, ...payload };
        brokersData.push(newRow);
        if (fbTable) fbTable.addRow(newRow);
        logEvent(ACTIONS.FINANZAS_BROKER_ADD, nombreNorm, { email: email || null });
        showFbStatus(`✓ ${nombreNorm} agregado`);
      }
      updateBrokersTotal();
      dialog.hide();
    } catch (e) {
      alert("Error al guardar: " + e.message);
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

// Estado de la Lista de Ingresos
let ingresosData = [];
let fiTable = null;
let ingresosInited = false;
const fiFilter = { text: "", periodo: "all", tipo: "all", categoria: "all", broker: "all", fromDate: null, toDate: null };
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

  // Filtros dropdown — periodo, tipo, categoria, broker
  ["periodo", "tipo", "categoria", "broker"].forEach(key => {
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
    // Cargar brokers en paralelo para poblar el filtro
    if (brokersData.length === 0) {
      try { await loadBrokers(); } catch (_) {}
    }
    if (!fiTable) initFiTable();
    await loadIngresos();
    fiTable.setData(ingresosData);
    populateBrokerFilter();
    updateIngresosSummary();
  } catch (e) {
    console.error("Error inicializando Ingresos:", e);
    ingresosInited = false;
    const msg = e?.code === "permission-denied" || /permission|insufficient/i.test(e?.message || "")
      ? `Firestore rechazó la lectura de "${INGRESOS_COL}". Verifica las reglas en Firebase Console.`
      : `No se pudo cargar la Lista de Ingresos:\n${e?.message || e}`;
    alert(msg);
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
  const names = brokersData.map(b => b.nombre).sort((a, b) => a.localeCompare(b, "es"));
  sel.innerHTML = `<option value="all">Todos</option>` +
    names.map(n => `<option value="${escapeHtmlAttr(n)}" ${n === current ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
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

  // Click en celda → editar (excepto si clickearon los botones)
  fiTable.on("cellClick", (e, cell) => {
    if (e.target.closest(".fc-actions")) return; // los botones manejan su propio click
    const row = cell.getRow().getData();
    openIngresoModal(row);
  });

  // Delegación para ✎ y ✕
  const tableEl = document.getElementById("fi-table");
  tableEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".fc-edit");
    const delBtn = e.target.closest(".fc-del");
    if (editBtn) { e.stopPropagation(); onEditIngreso(editBtn.dataset.id); }
    else if (delBtn) { e.stopPropagation(); onDeleteIngreso(delBtn.dataset.id); }
  });

  fiTable.on("dataFiltered", updateIngresosSummary);
  fiTable.on("dataLoaded", updateIngresosSummary);
}

// ─── Filtros ──────────────────────────────
function applyFiFilters() {
  if (!fiTable) return;
  fiTable.setFilter((row) => {
    if (fiFilter.tipo !== "all" && row.tipoPago !== fiFilter.tipo) return false;
    if (fiFilter.categoria !== "all" && row.categoria !== fiFilter.categoria) return false;
    if (fiFilter.periodo !== "all" && !matchesPeriodo(row.fecha, fiFilter.periodo)) return false;
    if (fiFilter.broker !== "all") {
      const hasBroker = Array.isArray(row.payouts) && row.payouts.some(p => p.broker === fiFilter.broker);
      if (!hasBroker) return false;
    }
    if (fiFilter.text) {
      const hay = `${row.descripcionDeposito || ""} ${row.descripcionTransaccion || ""} ${row.notas || ""}`.toLowerCase();
      if (!hay.includes(fiFilter.text)) return false;
    }
    return true;
  });
}

function matchesPeriodo(fecha, periodo) {
  if (!fecha) return false;
  const d = new Date(fecha + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const cY = now.getFullYear();
  const cM = now.getMonth();
  if (periodo === "this-month") return y === cY && m === cM;
  if (periodo === "last-month") {
    const lm = new Date(cY, cM - 1, 1);
    return y === lm.getFullYear() && m === lm.getMonth();
  }
  if (periodo === "this-year") return y === cY;
  if (periodo === "last-year") return y === cY - 1;
  if (periodo === "custom") {
    if (!fiFilter.fromDate || !fiFilter.toDate) return true;
    return d >= fiFilter.fromDate && d <= fiFilter.toDate;
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

function updateIngresosSummary() {
  const totalEl = document.getElementById("fi-sum-total");
  const brutoEl = document.getElementById("fi-sum-bruto");
  const pagadoEl = document.getElementById("fi-sum-pagado");
  const gananciaEl = document.getElementById("fi-sum-ganancia");
  if (!totalEl || !fiTable) return;

  const visibleRows = fiTable.getData("active");
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
  if (!confirm(`¿Eliminar este ingreso?\n\n${label}\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, INGRESOS_COL, id));
  } catch (e) {
    alert("Error al eliminar: " + e.message);
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


// ═══════════════════════════════════════════════════════════
// DASHBOARD — KPIs + gráficos con Chart.js
// ═══════════════════════════════════════════════════════════
let fdInited = false;
const fdCharts = {};
const fdState = { periodo: "year", fromDate: null, toDate: null };
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
        alert("Error al actualizar: " + e.message);
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
    alert(msg);
  }
}

function filterByPeriodo(rows, periodo, fromDate = null, toDate = null) {
  if (periodo === "all") return rows;
  const now = new Date();
  const cY = now.getFullYear();
  const cM = now.getMonth();

  return rows.filter(r => {
    if (!r.fecha) return false;
    const d = new Date(r.fecha + "T00:00:00");
    if (isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const m = d.getMonth();
    if (periodo === "year") return y === cY;
    if (periodo === "lastYear") return y === cY - 1;
    if (periodo === "month") return y === cY && m === cM;
    if (periodo === "lastMonth") {
      const lm = new Date(cY, cM - 1, 1);
      return y === lm.getFullYear() && m === lm.getMonth();
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
const fcompState = { periodo: "year", fromDate: null, toDate: null };
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
    alert(`No se pudo cargar Comparativas:\n${e?.message || e}`);
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
// EXPORTAR — CSVs + reporte ejecutivo para imprimir
// ═══════════════════════════════════════════════════════════
let fexpInited = false;
const fexpState = { periodo: "year", fromDate: null, toDate: null };
let fexpCustomPickers = null;

function bindExportarStaticHandlers() {
  const periodSel = document.getElementById("fexp-period");
  if (periodSel && !periodSel.dataset.bound) {
    periodSel.dataset.bound = "1";
    periodSel.addEventListener("change", (e) => {
      fexpState.periodo = e.target.value;
      toggleFexpCustomRange(e.target.value === "custom");
      if (fexpInited) updateExportarSummary();
    });
  }

  const csvIng = document.getElementById("fexp-csv-ingresos");
  if (csvIng && !csvIng.dataset.bound) {
    csvIng.dataset.bound = "1";
    csvIng.addEventListener("click", exportIngresosCSV);
  }
  const csvPay = document.getElementById("fexp-csv-payouts");
  if (csvPay && !csvPay.dataset.bound) {
    csvPay.dataset.bound = "1";
    csvPay.addEventListener("click", exportPayoutsCSV);
  }
  const printBtn = document.getElementById("fexp-print-report");
  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "1";
    printBtn.addEventListener("click", generatePrintReport);
  }
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
    updateExportarSummary();
  } catch (e) {
    console.error("Error inicializando Exportar:", e);
    fexpInited = false;
    alert(`No se pudo cargar Exportar:\n${e?.message || e}`);
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
    onChange: ([d]) => { fexpState.fromDate = d ? startOfDay(d) : null; if (d && fp2) fp2.set("minDate", d); updateExportarSummary(); }
  });
  const fp2 = flatpickr(toEl, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: today,
    onChange: ([d]) => { fexpState.toDate = d ? endOfDay(d) : null; if (d && fp1) fp1.set("maxDate", d); updateExportarSummary(); }
  });
  fexpCustomPickers = { fp1, fp2 };
  fexpState.fromDate = startOfDay(yearStart);
  fexpState.toDate = endOfDay(today);
}

function exportarData() {
  return filterByPeriodo(ingresosData, fexpState.periodo, fexpState.fromDate, fexpState.toDate);
}

function periodoLabel() {
  const labels = {
    year: "Año actual", month: "Este mes", lastMonth: "Mes pasado",
    lastYear: "Año anterior", all: "Todo", custom: "Personalizado"
  };
  if (fexpState.periodo === "custom" && fexpState.fromDate && fexpState.toDate) {
    return `${formatDateShort(fexpState.fromDate)}–${formatDateShort(fexpState.toDate)}`;
  }
  return labels[fexpState.periodo] || "Periodo";
}

function formatDateShort(d) {
  if (!d) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}-${d.getFullYear()}`;
}

function updateExportarSummary() {
  const data = exportarData();
  const count = data.length;
  const bruto = data.reduce((s, r) => s + (Number(r.monto) || 0), 0);
  setText("fexp-summary-count", `${count} ingreso${count === 1 ? "" : "s"}`);
  setText("fexp-summary-bruto", `${formatMoney(bruto)} bruto`);
}

function exportIngresosCSV() {
  const data = exportarData();
  if (!data.length) { alert("No hay ingresos en el periodo seleccionado."); return; }
  const rows = [[
    "Fecha", "Mes", "Tipo de pago", "Categoría",
    "Descripción depósito", "Descripción transacción",
    "Monto", "Pagado", "Ganancia", "# Payouts", "Notas",
    "Creado por", "Archivo original"
  ]];
  for (const r of data) {
    rows.push([
      r.fecha || "",
      r.mes || "",
      r.tipoPago || "",
      r.categoria || "",
      r.descripcionDeposito || "",
      r.descripcionTransaccion || "",
      r.monto ?? 0,
      r.pagado ?? 0,
      r.ganancia ?? 0,
      Array.isArray(r.payouts) ? r.payouts.length : 0,
      r.notas || "",
      r.creadoPor || "",
      r.archivoOriginalDriveUrl || ""
    ]);
  }
  downloadCSV(`hero-finanzas-ingresos-${slugify(periodoLabel())}.csv`, rows);
}

function exportPayoutsCSV() {
  const data = exportarData();
  const rows = [[
    "Fecha ingreso", "Mes", "Desc. depósito", "Categoría", "Monto ingreso",
    "Broker", "Saldo (payout)", "Reporte file"
  ]];
  let count = 0;
  for (const r of data) {
    if (!Array.isArray(r.payouts) || !r.payouts.length) continue;
    for (const p of r.payouts) {
      rows.push([
        r.fecha || "",
        r.mes || "",
        r.descripcionDeposito || "",
        r.categoria || "",
        r.monto ?? 0,
        p.broker || "",
        p.saldo ?? 0,
        p.reporteFile || ""
      ]);
      count++;
    }
  }
  if (count === 0) { alert("No hay payouts en el periodo seleccionado."); return; }
  downloadCSV(`hero-finanzas-payouts-${slugify(periodoLabel())}.csv`, rows);
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[áéíóú]/g, m => ({á:"a",é:"e",í:"i",ó:"o",ú:"u"}[m]))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  if (!data.length) { alert("No hay ingresos en el periodo seleccionado."); return; }

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
  const fechaGen = now.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });

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

async function openIngresoModal(existing) {
  const isEdit = !!existing;

  // Asegura que los brokers estén cargados (los necesitamos para el dropdown)
  if (brokersData.length === 0) {
    try { await loadBrokers(); } catch (e) { console.warn("No se pudieron cargar brokers:", e.message); }
  }
  // Carga la lista de "Descripción depósito" (se seedea si no existe)
  await loadDescDepositoList();

  const initialFecha = existing?.fecha || todayISO();
  const initialTipoPago = existing?.tipoPago || "LIFE";
  const initialCategoria = existing?.categoria || "COMISSION";

  const dialog = document.createElement("sl-dialog");
  dialog.label = isEdit ? "Editar ingreso" : "Nuevo ingreso";
  dialog.className = "fi-modal";
  dialog.innerHTML = `
    <div class="fc-form">

      <div class="fi-section-title">Información básica</div>

      <div class="fi-row-3">
        <div class="fc-native-field">
          <label for="fi-f-fecha" class="fc-native-label">
            Fecha
            <span class="fi-mes-pill" id="fi-mes-pill"></span>
          </label>
          <input type="date" id="fi-f-fecha" class="fc-native-date" value="${initialFecha}" required>
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

      <div class="fi-section-title">Payouts a brokers</div>

      <div id="fi-payouts-list" class="fi-payouts-list"></div>
      <p id="fi-payouts-empty" class="fi-payouts-empty" style="display:none;">
        Sin payouts. Si Hero retiene el 100% del depósito (categoría HERO), déjalo así.
      </p>

      <button type="button" id="fi-add-payout" class="fi-add-payout-btn">
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

    <sl-button slot="footer" id="fi-f-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="fi-f-save" variant="primary">
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

  // ─── Mes derivado de la fecha ───
  function updateMes() {
    const mes = deriveMes(fechaInp.value);
    mesPill.textContent = mes;
    mesPill.style.display = mes ? "" : "none";
  }
  fechaInp.addEventListener("change", updateMes);
  fechaInp.addEventListener("input", updateMes);
  updateMes();

  // ─── Cálculo de resumen (pagado + ganancia) ───
  function recalcSummary() {
    const monto = parseFloat(montoInp.value) || 0;
    const saldos = Array.from(payoutsListEl.querySelectorAll(".fi-pf-saldo"))
      .map(inp => parseFloat(inp.value) || 0);
    const pagado = saldos.reduce((s, v) => s + v, 0);
    const ganancia = monto - pagado;
    pagadoEl.textContent = formatMoney(pagado);
    gananciaEl.textContent = formatMoney(ganancia);
    gananciaEl.classList.toggle("negative", ganancia < 0);
  }
  montoInp.addEventListener("sl-input", recalcSummary);
  montoInp.addEventListener("input", recalcSummary);

  // ─── Renderiza una fila de payout ───
  function addPayoutRow(payout) {
    payoutsEmptyEl.style.display = "none";

    const row = document.createElement("div");
    row.className = "fi-payout-row";
    row.innerHTML = `
      <div class="fc-native-field">
        <label class="fc-native-label">Broker</label>
        <select class="fc-native-select fi-pf-broker">
          <option value="">— Selecciona —</option>
          ${brokersData.map(b =>
            `<option value="${escapeHtmlAttr(b.nombre)}" ${payout?.broker === b.nombre ? "selected" : ""}>${escapeHtml(b.nombre)}</option>`
          ).join("")}
        </select>
      </div>
      <sl-input class="fi-pf-reporte" label="Reporte (URL)" placeholder="https://..." size="small" value="${escapeHtmlAttr(payout?.reporteFile || "")}"></sl-input>
      <sl-input class="fi-pf-saldo" label="Saldo ($)" type="number" step="0.01" min="0" size="small" value="${payout?.saldo != null ? payout.saldo : ""}"></sl-input>
      <button type="button" class="fi-pf-remove" title="Quitar payout">✕</button>
    `;

    const saldoInp = row.querySelector(".fi-pf-saldo");
    saldoInp.addEventListener("sl-input", recalcSummary);
    saldoInp.addEventListener("input", recalcSummary);

    const removeBtn = row.querySelector(".fi-pf-remove");
    removeBtn.addEventListener("click", () => {
      row.remove();
      if (payoutsListEl.children.length === 0) {
        payoutsEmptyEl.style.display = "";
      }
      recalcSummary();
    });

    payoutsListEl.appendChild(row);
    recalcSummary();
  }
  addPayoutBtn.addEventListener("click", () => addPayoutRow(null));

  // Pre-llena payouts existentes (modo edición)
  if (isEdit && Array.isArray(existing.payouts) && existing.payouts.length) {
    existing.payouts.forEach(p => addPayoutRow(p));
  } else {
    payoutsEmptyEl.style.display = "";
  }
  recalcSummary();

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
      descDepSel.value = ""; // reset mientras escribe
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
      alert(e.message);
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

  // ─── Cerrar solo con X o Escape ───
  dialog.addEventListener("sl-request-close", (e) => {
    if (e.detail.source !== "close-button" && e.detail.source !== "keyboard") {
      e.preventDefault();
    }
  });
  dialog.addEventListener("sl-after-show", () => {
    if (window.refreshIcons) window.refreshIcons();
    fechaInp.focus();
  });
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#fi-f-cancel").addEventListener("click", () => dialog.hide());

  // ─── Guardar ───
  dialog.querySelector("#fi-f-save").addEventListener("click", async () => {
    const fecha = (fechaInp.value || "").trim();
    const tipoPago = tipoPagoSel.value;
    const categoria = categoriaSel.value;
    const monto = parseFloat(montoInp.value);
    const descDep = (descDepSel.value || "").trim();
    const descTrans = (descTransInp.value || "").trim();
    const driveUrl = (driveUrlInp.value || "").trim();
    const notas = (notasInp.value || "").trim();

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      alert("La fecha es obligatoria."); fechaInp.focus(); return;
    }
    if (!TIPOS_PAGO.includes(tipoPago)) { alert("Tipo de pago inválido."); return; }
    if (!CATEGORIAS.includes(categoria)) { alert("Categoría inválida."); return; }
    if (!isFinite(monto) || monto < 0) {
      alert("El monto es obligatorio y debe ser ≥ 0."); montoInp.focus(); return;
    }

    // Recolectar payouts
    const payoutRows = Array.from(payoutsListEl.querySelectorAll(".fi-payout-row"));
    const payouts = [];
    for (const r of payoutRows) {
      const brokerSel = r.querySelector(".fi-pf-broker");
      const reporteInp = r.querySelector(".fi-pf-reporte");
      const saldoInp = r.querySelector(".fi-pf-saldo");
      const broker = (brokerSel.value || "").trim();
      const reporteFile = (reporteInp.value || "").trim();
      const saldo = parseFloat(saldoInp.value);

      if (!broker) { alert("Cada payout debe tener un broker seleccionado."); brokerSel.focus(); return; }
      if (!isFinite(saldo) || saldo < 0) { alert(`Saldo inválido para ${broker}.`); saldoInp.focus(); return; }

      payouts.push({ broker, reporteFile, saldo });
    }

    const pagado = payouts.reduce((s, p) => s + (p.saldo || 0), 0);
    const ganancia = monto - pagado;
    const mes = deriveMes(fecha);

    const payload = {
      fecha,
      mes,
      tipoPago,
      categoria,
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
          monto, pagado, ganancia, tipoPago, categoria, payoutCount: payouts.length
        });
        showFiStatus(`✓ Ingreso de ${formatFechaUS(fecha)} actualizado`);
      } else {
        payload.creadoPor = currentUserEmail;
        payload.creadoEn = serverTimestamp();
        const ref = await addDoc(collection(db, INGRESOS_COL), payload);
        const newRow = { id: ref.id, ...payload };
        ingresosData.push(newRow);
        if (fiTable) fiTable.addRow(newRow, true); // true = al inicio (fecha desc)
        logEvent(ACTIONS.FINANZAS_INGRESO_ADD, fecha, {
          monto, pagado, ganancia, tipoPago, categoria, payoutCount: payouts.length
        });
        showFiStatus(`✓ Ingreso de ${formatFechaUS(fecha)} registrado · Ganancia ${formatMoney(ganancia)}`);
      }
      updateIngresosSummary();
      dialog.hide();
    } catch (e) {
      alert("Error al guardar: " + e.message);
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
