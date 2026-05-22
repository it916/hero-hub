// ═══════════════════════════════════════════
// Hero Hub · Panel de Gestión de Roles
// ═══════════════════════════════════════════
// Este módulo se carga desde admin.html y maneja la pestaña "Roles".
// Solo usuarios con rol "admin" pueden usar este panel.
//
// El panel lee y escribe en el documento shared/roles de Firestore.
// Soporta dos formatos:
//   - Formato legacy: email → "rol" (string)
//   - Formato nuevo: email → { role, updatedAt, updatedBy } (objeto)
// Al guardar, migra automáticamente los registros al formato nuevo.

import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ROLES } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

// ═══════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════

let usersData = {};       // { "email@...": { role, updatedAt?, updatedBy? } }
let teamMembers = [];     // Miembros del equipo (para mostrar fotos)
let filter = { text: "", role: "all" };
let currentAdminEmail = null;

// Lista de roles disponibles (generada desde ROLES)
const AVAILABLE_ROLES = Object.keys(ROLES);

// Roles que no se pueden eliminar (protección)
const PROTECTED_EMAILS = ["it@heroinsuranceusa.com"];

// ═══════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════

/**
 * Se llama desde admin.js cuando el admin abre el tab "Roles".
 * Carga los datos y renderiza la UI.
 */
export async function initRolesPanel(adminEmail) {
  currentAdminEmail = adminEmail;
  await Promise.all([loadUsers(), loadTeam()]);
  renderStats();
  renderTable();
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

      // Normalizar: convertir cualquier formato viejo a formato nuevo
      usersData = {};
      Object.entries(rawUsers).forEach(([email, value]) => {
        const normalizedEmail = email.toLowerCase().trim();
        if (typeof value === "string") {
          // Formato legacy
          usersData[normalizedEmail] = { role: value };
        } else if (value && typeof value === "object" && value.role) {
          // Formato nuevo
          usersData[normalizedEmail] = value;
        }
      });
    } else {
      usersData = {};
    }
  } catch (e) {
    console.error("Error cargando usuarios:", e);
    document.getElementById("ra-table-body").innerHTML =
      `<tr><td colspan="5" class="empty">Error: ${e.message}</td></tr>`;
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

/**
 * Busca un miembro del equipo cuyo email coincida (primaryo o secundario).
 * Retorna { name, photo, role, country } o null.
 */
function findTeamMember(email) {
  const normalized = email.toLowerCase().trim();
  return teamMembers.find(m =>
    Array.isArray(m.email) && m.email.some(e => e.toLowerCase().trim() === normalized)
  ) || null;
}

// ═══════════════════════════════════════════
// GUARDADO EN FIRESTORE
// ═══════════════════════════════════════════

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
// RENDERIZADO
// ═══════════════════════════════════════════

function renderStats() {
  const total = Object.keys(usersData).length;
  const counts = {};
  AVAILABLE_ROLES.forEach(r => counts[r] = 0);
  Object.values(usersData).forEach(u => {
    if (counts[u.role] !== undefined) counts[u.role]++;
  });

  document.getElementById("ra-total").textContent = total;
  document.getElementById("ra-admin-count").textContent = counts.admin || 0;
  document.getElementById("ra-interno-count").textContent = counts.interno || 0;
  document.getElementById("ra-agente-count").textContent = counts.agente || 0;
}

function renderTable() {
  const tbody = document.getElementById("ra-table-body");
  const entries = Object.entries(usersData);

  // Aplicar filtros
  const filtered = entries.filter(([email, u]) => {
    if (filter.role !== "all" && u.role !== filter.role) return false;
    if (filter.text) {
      const member = findTeamMember(email);
      const haystack = `${email} ${member?.name || ""} ${u.role}`.toLowerCase();
      if (!haystack.includes(filter.text)) return false;
    }
    return true;
  });

  // Ordenar: admins primero, luego alfabético por email
  filtered.sort((a, b) => {
    const orderA = AVAILABLE_ROLES.indexOf(a[1].role);
    const orderB = AVAILABLE_ROLES.indexOf(b[1].role);
    if (orderA !== orderB) return orderA - orderB;
    return a[0].localeCompare(b[0]);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${
      filter.text || filter.role !== "all" ? "Sin resultados con esos filtros." : "No hay usuarios registrados. Agrega el primero con el botón de arriba."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(([email, u]) => {
    const member = findTeamMember(email);
    const name = member?.name || email.split("@")[0];
    const photo = member?.photo || "";
    const initials = name.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
    const updated = u.updatedAt
      ? new Date(u.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })
      : "—";
    const updatedBy = u.updatedBy ? u.updatedBy.split("@")[0] : "";
    const isProtected = PROTECTED_EMAILS.includes(email);
    const isMe = email === currentAdminEmail;

    // Dropdown de roles
    const roleSelect = `
      <select class="ra-role-select" data-email="${email}">
        ${AVAILABLE_ROLES.map(r => `
          <option value="${r}" ${u.role === r ? "selected" : ""}>${ROLES[r].label}</option>
        `).join("")}
      </select>
    `;

    // Avatar (foto si existe, iniciales si no)
    const avatar = photo
      ? `<img src="${photo}" alt="" class="ra-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="ra-avatar-initials" style="display:none;">${initials}</div>`
      : `<div class="ra-avatar-initials">${initials}</div>`;

    return `
      <tr data-email="${email}">
        <td class="ra-user-cell">
          ${avatar}
          <div class="ra-user-info">
            <div class="ra-user-name">${name}${isMe ? ' <span class="ra-me-tag">tú</span>' : ""}</div>
            <div class="ra-user-email">${email}</div>
          </div>
        </td>
        <td>${roleSelect}</td>
        <td class="ra-updated">
          <div class="ra-updated-date">${updated}</div>
          ${updatedBy ? `<div class="ra-updated-by">por ${updatedBy}</div>` : ""}
        </td>
        <td class="ra-actions">
          ${isProtected
            ? '<span class="ra-protected" title="Usuario protegido del sistema">🛡️</span>'
            : `<button class="ra-act-btn ra-del" data-email="${email}" title="Eliminar">✕</button>`
          }
        </td>
      </tr>
    `;
  }).join("");

  // Wire events de la tabla
  tbody.querySelectorAll(".ra-role-select").forEach(sel => {
    sel.addEventListener("change", onChangeRole);
  });
  tbody.querySelectorAll(".ra-del").forEach(btn => {
    btn.addEventListener("click", onDeleteUser);
  });
}

// ═══════════════════════════════════════════
// HANDLERS DE EVENTOS
// ═══════════════════════════════════════════

function wireHandlers() {
  // Búsqueda
  const searchInp = document.getElementById("ra-search");
  if (searchInp && !searchInp.dataset.bound) {
    searchInp.dataset.bound = "1";
    searchInp.addEventListener("input", e => {
      filter.text = e.target.value.toLowerCase().trim();
      renderTable();
    });
  }

  // Filtros por rol
  document.querySelectorAll(".ra-filter-chip").forEach(chip => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => {
      document.querySelectorAll(".ra-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.role = chip.dataset.role;
      renderTable();
    });
  });

  // Botón agregar
  const addBtn = document.getElementById("ra-add-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", openAddUserModal);
  }
}

async function onChangeRole(e) {
  const select = e.target;
  const email = select.dataset.email;
  const newRole = select.value;
  const oldRole = usersData[email]?.role;

  if (oldRole === newRole) return;

  const oldLabel = ROLES[oldRole]?.label || oldRole;
  const newLabel = ROLES[newRole]?.label || newRole;

  // Caso especial: el admin se está degradando a sí mismo → advertencia fuerte
  if (email === currentAdminEmail && newRole !== "admin") {
    const confirmed = confirm(
      `⚠️ Estás cambiando tu propio rol de "${oldLabel}" a "${newLabel}".\n\n` +
      `Si guardas este cambio, perderás acceso al panel de admin al recargar la página.\n\n` +
      `¿Continuar?`
    );
    if (!confirmed) {
      select.value = oldRole;
      return;
    }
  } else {
    // Cualquier otro cambio: confirmación simple antes de escribir en Firestore
    const displayName = findTeamMember(email)?.name || email.split("@")[0];
    const confirmed = confirm(
      `¿Cambiar a ${displayName} de "${oldLabel}" a "${newLabel}"?`
    );
    if (!confirmed) {
      select.value = oldRole;
      return;
    }
  }

  // Aplicar cambio
  usersData[email] = {
    role: newRole,
    updatedAt: new Date().toISOString(),
    updatedBy: currentAdminEmail
  };

  const ok = await saveUsersToFirestore();
  if (!ok) {
    // Revertir si falla
    usersData[email] = { role: oldRole };
    select.value = oldRole;
    return;
  }

  // Log de auditoría
  logEvent(ACTIONS.ROLE_UPDATE, email, {
    from: ROLES[oldRole]?.label || oldRole,
    to: ROLES[newRole]?.label || newRole
  });

  renderStats();
  renderTable();
  showStatus(`✓ Rol de ${email.split("@")[0]} cambiado a ${ROLES[newRole].label}`);
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
    // Log de auditoría
    logEvent(ACTIONS.ROLE_DELETE, email, {
      role: ROLES[oldRole]?.label || oldRole || "desconocido"
    });

    renderStats();
    renderTable();
    showStatus(`✓ Usuario ${email.split("@")[0]} eliminado`);
  }
}

function openAddUserModal() {
  // Preparar lista de sugerencias: miembros del equipo que aún NO tienen rol
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

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal modal-wide">
      <h3>Agregar usuario al sistema de roles</h3>
      <label>Email
        <input id="ra-new-email" type="email" placeholder="usuario@heroinsuranceusa.com" autocomplete="off" list="ra-email-suggestions">
      </label>
      ${suggestions.length ? `
        <datalist id="ra-email-suggestions">
          ${suggestions.map(s => `<option value="${s.email}">${s.name}</option>`).join("")}
        </datalist>
        <div class="ra-suggestions-note">💡 Hay ${suggestions.length} miembros del equipo sin rol asignado. Empieza a escribir para ver sugerencias.</div>
      ` : ""}
      <label>Rol
        <select id="ra-new-role">
          ${AVAILABLE_ROLES.map(r => `
            <option value="${r}" ${r === "interno" ? "selected" : ""}>${ROLES[r].label}</option>
          `).join("")}
        </select>
      </label>
      <div class="ra-role-hint" id="ra-role-hint"></div>
      <div class="modal-buttons">
        <button class="btn-ghost-dark" id="ra-new-cancel">Cancelar</button>
        <button class="btn-primary" id="ra-new-save">Agregar usuario</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const emailInp = modal.querySelector("#ra-new-email");
  const roleSel = modal.querySelector("#ra-new-role");
  const hintEl = modal.querySelector("#ra-role-hint");

  // Mostrar qué puede ver cada rol
  function updateRoleHint() {
    const r = roleSel.value;
    const def = ROLES[r];
    if (!def) { hintEl.textContent = ""; return; }
    const pages = def.pages.filter(p => p !== "index").map(p => p.charAt(0).toUpperCase() + p.slice(1));
    hintEl.textContent = `${def.label} puede ver: Inicio, ${pages.join(", ")}`;
  }
  roleSel.addEventListener("change", updateRoleHint);
  updateRoleHint();

  emailInp.focus();

  modal.querySelector("#ra-new-cancel").onclick = () => modal.remove();
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.remove();
  });

  modal.querySelector("#ra-new-save").onclick = async () => {
    const email = emailInp.value.trim().toLowerCase();
    const role = roleSel.value;

    // Validaciones
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
      // Log de auditoría
      logEvent(ACTIONS.ROLE_CREATE, email, {
        role: ROLES[role]?.label || role
      });

      modal.remove();
      renderStats();
      renderTable();
      showStatus(`✓ Usuario ${email.split("@")[0]} agregado con rol "${ROLES[role].label}"`);
    }
  };
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
