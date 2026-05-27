// ═══════════════════════════════════════════
// Hero Hub · Panel de Gestión de Roles
// ═══════════════════════════════════════════
// Tab "Roles" en admin.html (Stage D del rediseño admin).
// La tabla ahora usa Tabulator (CDN cargado en admin.html).
//
// Soporta dos formatos de Firestore:
//   - Legacy: email → "rol" (string)
//   - Nuevo:  email → { role, updatedAt, updatedBy } (objeto)

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ROLES } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

// ═══════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════
let usersData = {};
let teamMembers = [];
let table = null;
const filterState = { text: "", role: "all" };
let currentAdminEmail = null;

const AVAILABLE_ROLES = Object.keys(ROLES);
const PROTECTED_EMAILS = ["it@heroinsuranceusa.com"];

// ═══════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════
export async function initRolesPanel(adminEmail) {
  currentAdminEmail = adminEmail;
  if (!table) initTable();
  await Promise.all([loadUsers(), loadTeam()]);
  table.setData(buildTableData());
  renderStats();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
}

// ═══════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════
async function loadUsers() {
  try {
    const snap = await getDoc(doc(db, "shared", "roles"));
    if (snap.exists()) {
      const data = snap.data();
      const rawUsers = data.users || {};
      usersData = {};
      Object.entries(rawUsers).forEach(([email, value]) => {
        const normalizedEmail = email.toLowerCase().trim();
        if (typeof value === "string") {
          usersData[normalizedEmail] = { role: value };
        } else if (value && typeof value === "object" && value.role) {
          usersData[normalizedEmail] = value;
        }
      });
    } else {
      usersData = {};
    }
  } catch (e) {
    console.error("Error cargando usuarios:", e);
    if (table) table.setPlaceholder(`Error: ${e.message}`);
  }
}

async function loadTeam() {
  try {
    const snap = await getDoc(doc(db, "shared", "team"));
    if (snap.exists() && Array.isArray(snap.data().members)) {
      teamMembers = snap.data().members;
    } else {
      teamMembers = [];
    }
  } catch (e) {
    console.warn("Error cargando equipo:", e.message);
    teamMembers = [];
  }
}

function findTeamMember(email) {
  const normalized = email.toLowerCase().trim();
  return teamMembers.find(m =>
    Array.isArray(m.email) && m.email.some(e => e.toLowerCase().trim() === normalized)
  ) || null;
}

async function saveUsersToFirestore() {
  try {
    await setDoc(doc(db, "shared", "roles"), { users: usersData });
    return true;
  } catch (e) {
    alert("Error al guardar: " + e.message);
    return false;
  }
}

// ═══════════════════════════════════════════
// CONSTRUCCIÓN DE DATA PARA TABULATOR
// ═══════════════════════════════════════════
function buildTableData() {
  return Object.entries(usersData).map(([email, u]) => buildRow(email, u));
}

function buildRow(email, u) {
  const member = findTeamMember(email);
  const name = member?.name || email.split("@")[0];
  const initials = name.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  const updatedAtMs = u.updatedAt ? new Date(u.updatedAt).getTime() : 0;
  const updatedAtDisplay = u.updatedAt
    ? new Date(u.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const updatedByDisplay = u.updatedBy ? u.updatedBy.split("@")[0] : null;
  return {
    email,
    role: u.role,
    _roleOrder: AVAILABLE_ROLES.indexOf(u.role),
    name,
    photo: member?.photo || null,
    initials,
    updatedAt: updatedAtMs,
    updatedAtDisplay,
    updatedByDisplay,
    isProtected: PROTECTED_EMAILS.includes(email),
    isMe: email === currentAdminEmail
  };
}

// ═══════════════════════════════════════════
// TABLA TABULATOR
// ═══════════════════════════════════════════
function initTable() {
  table = new Tabulator("#ra-table", {
    index: "email",
    layout: "fitColumns",
    height: "640px",
    pagination: true,
    paginationSize: 50,
    paginationSizeSelector: [25, 50, 100, 200],
    initialSort: [
      { column: "_roleOrder", dir: "asc" },
      { column: "email", dir: "asc" }
    ],
    placeholder: "No hay usuarios registrados. Agrega el primero con el botón de arriba.",
    locale: "es",
    langs: {
      "es": {
        "pagination": {
          "first": "«", "first_title": "Primera",
          "last": "»",  "last_title": "Última",
          "prev": "‹",  "prev_title": "Anterior",
          "next": "›",  "next_title": "Siguiente",
          "page_size": "Por página",
          "counter": { "showing": "Mostrando", "of": "de", "rows": "usuarios", "pages": "páginas" }
        }
      }
    },
    columns: [
      {
        title: "Usuario",
        field: "name",
        minWidth: 260,
        sorter: "string",
        formatter: (cell) => {
          const r = cell.getRow().getData();
          const initials = r.initials || "";
          const avatar = r.photo
            ? `<img src="${escapeHtml(r.photo)}" alt="" class="ra-avatar"
                onerror="this.outerHTML='<div class=&quot;ra-avatar-initials&quot;>${escapeHtmlAttr(initials)}</div>';">`
            : `<div class="ra-avatar-initials">${escapeHtml(initials)}</div>`;
          return `<div class="ra-user-cell">
            ${avatar}
            <div class="ra-user-info">
              <div class="ra-user-name">${escapeHtml(r.name)}${r.isMe ? ' <span class="ra-me-tag">tú</span>' : ""}</div>
              <div class="ra-user-email">${escapeHtml(r.email)}</div>
            </div>
          </div>`;
        }
      },
      {
        title: "Rol",
        field: "role",
        width: 200,
        sorter: (a, b) => AVAILABLE_ROLES.indexOf(a) - AVAILABLE_ROLES.indexOf(b),
        formatter: (cell) => {
          const r = cell.getRow().getData();
          return `<select class="ra-role-select" data-email="${escapeHtmlAttr(r.email)}">${
            AVAILABLE_ROLES.map(role =>
              `<option value="${role}" ${r.role === role ? "selected" : ""}>${escapeHtml(ROLES[role].label)}</option>`
            ).join("")
          }</select>`;
        }
      },
      {
        title: "Actualizado",
        field: "updatedAt",
        width: 160,
        sorter: "number",
        formatter: (cell) => {
          const r = cell.getRow().getData();
          if (!r.updatedAtDisplay) return `<span class="ra-no-date">—</span>`;
          return `<div class="ra-updated">
            <div class="ra-updated-date">${escapeHtml(r.updatedAtDisplay)}</div>
            ${r.updatedByDisplay ? `<div class="ra-updated-by">por ${escapeHtml(r.updatedByDisplay)}</div>` : ""}
          </div>`;
        }
      },
      {
        title: "",
        field: "_actions",
        width: 72,
        hozAlign: "center",
        headerSort: false,
        formatter: (cell) => {
          const r = cell.getRow().getData();
          if (r.isProtected) {
            return `<span class="ra-protected" title="Usuario protegido del sistema">🛡️</span>`;
          }
          return `<button class="ra-act-btn ra-del" data-email="${escapeHtmlAttr(r.email)}" title="Eliminar">✕</button>`;
        }
      }
    ]
  });

  // Event delegation: para cambios de rol y botones eliminar (cells re-renderizadas)
  const tableEl = document.getElementById("ra-table");
  tableEl.addEventListener("change", e => {
    if (e.target.classList.contains("ra-role-select")) onChangeRole(e);
  });
  tableEl.addEventListener("click", e => {
    const btn = e.target.closest(".ra-del");
    if (btn) onDeleteUser({ currentTarget: btn });
  });

  table.on("dataFiltered", renderStats);
  table.on("dataLoaded", renderStats);
}

// ═══════════════════════════════════════════
// FILTROS (búsqueda + chips por rol)
// ═══════════════════════════════════════════
function applyFilters() {
  if (!table) return;
  table.setFilter((row) => {
    if (filterState.role !== "all" && row.role !== filterState.role) return false;
    if (filterState.text) {
      const haystack = `${row.email || ""} ${row.name || ""} ${row.role || ""}`.toLowerCase();
      if (!haystack.includes(filterState.text)) return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════
function renderStats() {
  const total = Object.keys(usersData).length;
  const counts = {};
  AVAILABLE_ROLES.forEach(r => counts[r] = 0);
  Object.values(usersData).forEach(u => {
    if (counts[u.role] !== undefined) counts[u.role]++;
  });

  setText("ra-total", total);
  setText("ra-admin-count", counts.admin || 0);
  setText("ra-interno-count", counts.interno || 0);
  setText("ra-agente-count", counts.agente || 0);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

// ═══════════════════════════════════════════
// HANDLERS — cambiar rol, eliminar, agregar
// ═══════════════════════════════════════════
async function onChangeRole(e) {
  const select = e.target;
  const email = select.dataset.email;
  const newRole = select.value;
  const oldRole = usersData[email]?.role;

  if (oldRole === newRole) return;

  const oldLabel = ROLES[oldRole]?.label || oldRole;
  const newLabel = ROLES[newRole]?.label || newRole;

  if (email === currentAdminEmail && newRole !== "admin") {
    const confirmed = confirm(
      `⚠️ Estás cambiando tu propio rol de "${oldLabel}" a "${newLabel}".\n\n` +
      `Si guardas este cambio, perderás acceso al panel de admin al recargar la página.\n\n` +
      `¿Continuar?`
    );
    if (!confirmed) { select.value = oldRole; return; }
  } else {
    const displayName = findTeamMember(email)?.name || email.split("@")[0];
    const confirmed = confirm(`¿Cambiar a ${displayName} de "${oldLabel}" a "${newLabel}"?`);
    if (!confirmed) { select.value = oldRole; return; }
  }

  usersData[email] = {
    role: newRole,
    updatedAt: new Date().toISOString(),
    updatedBy: currentAdminEmail
  };

  const ok = await saveUsersToFirestore();
  if (!ok) {
    usersData[email] = { role: oldRole };
    select.value = oldRole;
    return;
  }

  logEvent(ACTIONS.ROLE_UPDATE, email, { from: oldLabel, to: newLabel });
  table.updateRow(email, buildRow(email, usersData[email]));
  renderStats();
  showStatus(`✓ Rol de ${email.split("@")[0]} cambiado a ${newLabel}`);
}

async function onDeleteUser(e) {
  const email = e.currentTarget.dataset.email;

  if (PROTECTED_EMAILS.includes(email)) {
    alert("Este usuario está protegido y no puede eliminarse.");
    return;
  }
  if (email === currentAdminEmail) {
    alert("No puedes eliminarte a ti mismo. Pídele a otro admin que lo haga.");
    return;
  }
  if (!confirm(`¿Eliminar a ${email} del sistema de roles?\n\nPerderá acceso al Hero Hub inmediatamente.`)) return;

  const oldRole = usersData[email]?.role;
  delete usersData[email];
  const ok = await saveUsersToFirestore();
  if (ok) {
    logEvent(ACTIONS.ROLE_DELETE, email, { role: ROLES[oldRole]?.label || oldRole || "desconocido" });
    table.deleteRow(email);
    renderStats();
    showStatus(`✓ Usuario ${email.split("@")[0]} eliminado`);
  }
}

// ═══════════════════════════════════════════
// HANDLERS DE UI (búsqueda + chips + botón agregar)
// ═══════════════════════════════════════════
function wireHandlers() {
  const searchInp = document.getElementById("ra-search");
  if (searchInp && !searchInp.dataset.bound) {
    searchInp.dataset.bound = "1";
    searchInp.addEventListener("input", e => {
      filterState.text = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }

  document.querySelectorAll(".ra-filter-chip").forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll(".ra-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filterState.role = chip.dataset.role;
      applyFilters();
    });
  });

  const addBtn = document.getElementById("ra-add-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", openAddUserModal);
  }
}

// ═══════════════════════════════════════════
// MODAL: agregar usuario (sl-dialog)
// ═══════════════════════════════════════════
function openAddUserModal() {
  const suggestions = [];
  teamMembers.forEach(m => {
    if (!Array.isArray(m.email)) return;
    m.email.forEach(e => {
      const norm = e.toLowerCase().trim();
      if (norm.endsWith("@heroinsuranceusa.com") && !usersData[norm]) {
        suggestions.push({ email: norm, name: m.name });
      }
    });
  });

  const dialog = document.createElement("sl-dialog");
  dialog.label = "Agregar usuario al sistema de roles";
  dialog.className = "ra-add-dialog";
  dialog.innerHTML = `
    <div class="ra-add-form">
      <sl-input
        id="ra-new-email"
        label="Email"
        type="email"
        placeholder="usuario@heroinsuranceusa.com"
        autocomplete="off"
        list="ra-email-suggestions"
        clearable
        required>
      </sl-input>
      ${suggestions.length ? `
        <datalist id="ra-email-suggestions">
          ${suggestions.map(s => `<option value="${s.email}">${escapeHtml(s.name)}</option>`).join("")}
        </datalist>
        <div class="ra-suggestions-note">💡 Hay ${suggestions.length} miembros del equipo sin rol asignado. Empieza a escribir para ver sugerencias.</div>
      ` : ""}

      <sl-select id="ra-new-role" label="Rol" value="interno" hoist>
        ${AVAILABLE_ROLES.map(r => `
          <sl-option value="${r}">${escapeHtml(ROLES[r].label)}</sl-option>
        `).join("")}
      </sl-select>

      <div class="ra-role-hint" id="ra-role-hint"></div>
    </div>

    <sl-button slot="footer" id="ra-new-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="ra-new-save" variant="primary">
      <i data-lucide="user-plus" slot="prefix" style="width:14px;height:14px;"></i>
      Agregar usuario
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  const emailInp = dialog.querySelector("#ra-new-email");
  const roleSel = dialog.querySelector("#ra-new-role");
  const hintEl = dialog.querySelector("#ra-role-hint");

  function updateRoleHint() {
    const r = roleSel.value;
    const def = ROLES[r];
    if (!def) { hintEl.textContent = ""; return; }
    const pages = def.pages
      .filter(p => p !== "index")
      .map(p => p.charAt(0).toUpperCase() + p.slice(1));
    hintEl.textContent = `${def.label} puede ver: Inicio, ${pages.join(", ")}`;
  }
  roleSel.addEventListener("sl-change", updateRoleHint);

  // Cuando el dialog termina de abrir, calcular hint y enfocar email
  dialog.addEventListener("sl-after-show", () => {
    updateRoleHint();
    emailInp.focus();
  });

  // Limpiar del DOM al cerrar (animación incluida)
  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#ra-new-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#ra-new-save").addEventListener("click", async () => {
    const email = (emailInp.value || "").trim().toLowerCase();
    const role = roleSel.value;

    if (!email) {
      alert("El email es obligatorio");
      emailInp.focus();
      return;
    }
    if (!/^[^\s@]+@heroinsuranceusa\.com$/.test(email)) {
      alert("El email debe terminar en @heroinsuranceusa.com");
      emailInp.focus();
      return;
    }
    if (usersData[email]) {
      alert(`El usuario ${email} ya existe con rol "${ROLES[usersData[email].role]?.label || usersData[email].role}".\n\nSi quieres cambiar su rol, hazlo directamente desde la tabla.`);
      return;
    }

    usersData[email] = {
      role,
      updatedAt: new Date().toISOString(),
      updatedBy: currentAdminEmail
    };

    const ok = await saveUsersToFirestore();
    if (ok) {
      logEvent(ACTIONS.ROLE_CREATE, email, { role: ROLES[role]?.label || role });
      dialog.hide();
      table.addRow(buildRow(email, usersData[email]));
      renderStats();
      showStatus(`✓ Usuario ${email.split("@")[0]} agregado con rol "${ROLES[role].label}"`);
    }
  });

  // Mostrar
  dialog.show();
}

// ═══════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════
let statusTimeout = null;
function showStatus(msg) {
  const el = document.getElementById("ra-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => el.classList.remove("visible"), 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}
function escapeHtmlAttr(str) {
  return String(str ?? "").replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}
