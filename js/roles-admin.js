// ═══════════════════════════════════════════
// Hero Hub · Panel de Usuarios (antes "Roles")
// ═══════════════════════════════════════════
// Vive en admin.html bajo el tab "Usuarios". Desde v2.23.3 gestiona la
// PERSONA completa (identity + display + access.role) — antes solo tocaba
// el rol. Reemplaza también la gestión admin del módulo Equipo, que quedó
// como vista pública read-only.
//
// Nombres internos (IDs CSS, initRolesPanel, id="tab-roles",
// data-tab="roles") se mantienen para no romper 96 selectores en
// roles-admin.css. Solo cambian los labels visibles.

import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAllUsers, createUser, updateUserFields, deleteUser,
  countryLabel, nameToIso, slugifyName
} from "./user-store.js";
import { ROLES } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

// ═══════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════

const AVAILABLE_ROLES = Object.keys(ROLES);
const PROTECTED_EMAILS = ["it@heroinsuranceusa.com"];

const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
const MONTHS_LONG_ES = ["enero","febrero","marzo","abril","mayo","junio",
                        "julio","agosto","septiembre","octubre","noviembre","diciembre"];
const HERO_DOMAIN = "@heroinsuranceusa.com";

// "2024-03" (YYYY-MM del input type=month) → "Marzo 2024" (persistido en bio.union)
function unionYYYYMMtoLabel(yyyymm) {
  const m = String(yyyymm || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const monthName = MONTHS_LONG_ES[parseInt(m[2], 10) - 1] || "";
  return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${m[1]}`;
}
// "Marzo 2024" → "2024-03" (para poblar el input type=month al abrir)
function unionLabelToYYYYMM(label) {
  const clean = String(label || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/^([a-z]+)\s+(\d{4})$/);
  if (!clean) return "";
  const monthIdx = MONTHS_LONG_ES.findIndex(x =>
    x.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === clean[1]);
  if (monthIdx < 0) return "";
  return `${clean[2]}-${String(monthIdx + 1).padStart(2, "0")}`;
}

const FLAGS_EMOJI = {
  VE:"🇻🇪", CU:"🇨🇺", CO:"🇨🇴", CL:"🇨🇱", HN:"🇭🇳",
  US:"🇺🇸", AR:"🇦🇷", MX:"🇲🇽", ES:"🇪🇸", PE:"🇵🇪",
  EC:"🇪🇨", UY:"🇺🇾", CR:"🇨🇷", PA:"🇵🇦", DO:"🇩🇴",
  GT:"🇬🇹", NI:"🇳🇮", SV:"🇸🇻", BO:"🇧🇴", PY:"🇵🇾",
  PR:"🇵🇷", BR:"🇧🇷"
};
const getFlagEmoji = (iso) => iso ? (FLAGS_EMOJI[String(iso).toUpperCase()] || "") : "";

const COUNTRIES_SUGGESTED = [
  "Venezuela", "Cuba", "Colombia", "Chile", "Honduras", "Estados Unidos",
  "Argentina", "México", "España", "Perú", "Ecuador", "Uruguay",
  "Costa Rica", "Panamá", "República Dominicana", "Guatemala", "Nicaragua",
  "El Salvador", "Bolivia", "Paraguay", "Puerto Rico", "Brasil"
];

const GH_REPO_OWNER = "it916";
const GH_REPO_NAME = "hero-hub";

// ═══════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════
let users = [];
let table = null;
const filterState = { text: "", role: "all" };
let currentAdminEmail = null;

// ═══════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════
export async function initRolesPanel(adminEmail) {
  currentAdminEmail = adminEmail;
  if (!table) initTable();
  await loadUsers();
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
    users = await getAllUsers({ includeExcluded: true });
  } catch (e) {
    console.error("Error cargando users/:", e);
    users = [];
    if (table) table.setPlaceholder(`Error: ${e.message}`);
  }
}

// Devuelve el user (doc completo) por email (docId o alias en identity.emails[])
function findUser(email) {
  const norm = (email || "").toLowerCase().trim();
  return users.find(u => u._email === norm
    || (u.identity?.emails || []).some(e => (e || "").toLowerCase() === norm)) || null;
}

// ═══════════════════════════════════════════
// CONSTRUCCIÓN DE DATA PARA TABULATOR
// ═══════════════════════════════════════════
function buildTableData() {
  return users.map(u => buildRow(u));
}

function buildRow(u) {
  const email = u._email;
  const role = u.access?.role || null;
  const name = u.identity?.name || email.split("@")[0];
  const initials = name.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  // access.updatedAt es Firestore Timestamp (o null si nunca se ha tocado)
  const updatedAtRaw = u.access?.updatedAt;
  const updatedAtDate = updatedAtRaw?.toDate ? updatedAtRaw.toDate() : null;
  const updatedAtMs = updatedAtDate ? updatedAtDate.getTime() : 0;
  const updatedAtDisplay = updatedAtDate
    ? updatedAtDate.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const updatedByDisplay = u.access?.updatedBy ? u.access.updatedBy.split("@")[0] : null;
  return {
    email,
    role,
    _roleOrder: role ? AVAILABLE_ROLES.indexOf(role) : 99,
    name,
    photo: u.identity?.photo || null,
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
        width: 180,
        sorter: (a, b) => (AVAILABLE_ROLES.indexOf(a) - AVAILABLE_ROLES.indexOf(b)),
        formatter: (cell) => {
          const r = cell.getRow().getData();
          if (!r.role) return `<span class="ra-role-badge ra-role-none">— sin rol —</span>`;
          const label = ROLES[r.role]?.label || r.role;
          return `<span class="ra-role-badge ra-role-${escapeHtmlAttr(r.role)}">${escapeHtml(label)}</span>`;
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
          return `<button class="ra-act-btn ra-del" data-email="${escapeHtmlAttr(r.email)}" title="Eliminar usuario">✕</button>`;
        }
      }
    ]
  });

  // Row-click abre modal edit. Ignora click en botón X.
  table.on("rowClick", (e, row) => {
    if (e.target.closest(".ra-del")) return;
    const email = row.getData().email;
    const user = findUser(email);
    if (user) openUserModal(user);
  });

  // Delegación para botón X (formatter re-renderiza celdas)
  const tableEl = document.getElementById("ra-table");
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
  const total = users.length;
  const counts = {};
  AVAILABLE_ROLES.forEach(r => counts[r] = 0);
  users.forEach(u => {
    const role = u.access?.role;
    if (role && counts[role] !== undefined) counts[role]++;
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
// ELIMINAR USUARIO (elimina el doc completo de users/)
// ═══════════════════════════════════════════
async function onDeleteUser(e) {
  const email = e.currentTarget.dataset.email;
  if (PROTECTED_EMAILS.includes(email)) {
    heroToast.error("Este usuario está protegido del sistema y no puede eliminarse.");
    return;
  }
  if (email === currentAdminEmail) {
    heroToast.error("No puedes eliminarte a ti mismo. Pídele a otro admin que lo haga.");
    return;
  }
  const user = findUser(email);
  const displayName = user?.identity?.name || email.split("@")[0];
  const oldRole = user?.access?.role;

  const ok = await heroConfirm({
    title: "Eliminar usuario",
    message: `¿Eliminar a ${displayName} por completo? Se borra el doc en users/{email}. Perderá acceso al Hero Hub inmediatamente y desaparecerá del módulo Equipo. Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;

  try {
    await deleteUser(email);
  } catch (err) {
    heroToast.error("Error al eliminar: " + err.message);
    return;
  }
  users = users.filter(u => u._email !== email);
  logEvent(ACTIONS.ROLE_DELETE, email, { role: ROLES[oldRole]?.label || oldRole || "(sin rol)" });
  table.deleteRow(email);
  renderStats();
  showStatus(`✓ ${displayName} eliminado`);
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
    addBtn.addEventListener("click", () => openUserModal(null));
  }
}

// ═══════════════════════════════════════════
// UPLOADER DE FOTO → GITHUB API
// ═══════════════════════════════════════════
// Token en Firestore shared/config.githubToken (regla: solo it@ lee).

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

async function getGithubToken() {
  const snap = await getDoc(doc(db, "shared", "config"));
  if (!snap.exists() || !snap.data().githubToken) {
    throw new Error("Token de GitHub no configurado en Firestore shared/config.githubToken");
  }
  return snap.data().githubToken;
}

async function uploadPhotoToGitHub(file, slug) {
  const token = await getGithubToken();
  const ext = file.type === "image/png" ? "png"
            : file.type === "image/webp" ? "webp"
            : "jpg";
  const path = `images/team/${slug}.${ext}`;
  const apiUrl = `https://api.github.com/repos/${GH_REPO_OWNER}/${GH_REPO_NAME}/contents/${path}`;

  let sha = null;
  const existingResp = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
  });
  if (existingResp.ok) {
    const existing = await existingResp.json();
    sha = existing.sha;
  } else if (existingResp.status !== 404) {
    const errText = await existingResp.text();
    throw new Error(`GitHub API ${existingResp.status}: ${errText.slice(0, 200)}`);
  }

  const base64 = await fileToBase64(file);
  const body = { message: `feat(equipo): foto de ${slug}`, content: base64, branch: "main" };
  if (sha) body.sha = sha;

  const uploadResp = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`GitHub API ${uploadResp.status}: ${errText.slice(0, 200)}`);
  }
  return `${path}?v=${Date.now()}`;
}

// ═══════════════════════════════════════════
// GENERADOR DE BIOS HEROICAS
// ═══════════════════════════════════════════
function generateHeroicBio(person) {
  const jobTitle = person.display?.jobTitle || "";
  const role = jobTitle.toLowerCase();
  const countryIso = person.identity?.country || "";
  const countryName = countryLabel(countryIso) || "tierras lejanas";
  const name = person.identity?.name || "";

  let identidad = jobTitle || "Héroe del equipo";
  let superpoder = "Aportando su energía única al equipo Hero";
  if (role.includes("ceo") || role.includes("director")) superpoder = "Visión estratégica y liderazgo heroico";
  else if (role.includes("coo") || role.includes("operation")) superpoder = "Orquestando operaciones imposibles con precisión";
  else if (role.includes("cfo") || role.includes("finance") || role.includes("finanzas")) superpoder = "Guardián del balance entre la misión y los números";
  else if (role.includes("hr") || role.includes("human") || role.includes("talent")) superpoder = "Descubriendo el héroe que hay en cada persona";
  else if (role.includes("it") || role.includes("tech") || role.includes("system")) superpoder = "Construyendo la tecnología que mantiene a Hero volando";
  else if (role.includes("sales") || role.includes("venta")) superpoder = "Convirtiendo cada llamada en una vida protegida";
  else if (role.includes("marketing")) superpoder = "Llevando el mensaje Hero a cada rincón del mercado";
  else if (role.includes("design") || role.includes("diseño") || role.includes("creative")) superpoder = "Dándole forma visual al universo Hero";
  else if (role.includes("legal") || role.includes("compliance")) superpoder = "Protegiendo a Hero con la fuerza de la ley";
  else if (role.includes("office manager") || role.includes("admin")) superpoder = "Manteniendo el cuartel general en perfecto orden";
  else if (role.includes("recruit")) superpoder = "Encontrando al próximo héroe para el equipo";
  else if (role.includes("support") || role.includes("customer")) superpoder = "Resolviendo lo imposible, una persona a la vez";
  else if (role.includes("manager") || role.includes("lead")) superpoder = "Guiando al equipo con mano firme hacia la victoria";
  else if (role.includes("agent") || role.includes("agente")) superpoder = "Conectando familias con la protección que necesitan";
  else if (role.includes("broker")) superpoder = "Tejiendo relaciones que transforman el mercado";
  else if (role.includes("coach") || role.includes("training")) superpoder = "Desbloqueando el potencial máximo de cada héroe";
  else if (role.includes("analyst") || role.includes("data")) superpoder = "Transformando datos en decisiones heroicas";

  let origen = countryName;
  const flagEmoji = getFlagEmoji(countryIso);
  if (flagEmoji) origen = `${flagEmoji} ${countryName}`;

  const frasesHeroicas = [
    "Cada día es una nueva oportunidad para hacer la diferencia.",
    "El trabajo en equipo es nuestro verdadero superpoder.",
    "Dale un Hero a tu vida, dale un Hero a tu día.",
    "Un buen seguro es la capa invisible que todos merecen.",
    "No se trata de vender pólizas, se trata de proteger sueños.",
    "En Hero, cada llamada cuenta. Cada persona importa.",
    "La excelencia no es un acto, es un hábito heroico.",
    "Los héroes no nacen, se forjan día a día.",
  ];
  const idx = (name || "").charCodeAt(0) % frasesHeroicas.length;
  const frase = frasesHeroicas[idx] || frasesHeroicas[0];

  return { identidad, origen, superpoder, frase, union: "Parte esencial del equipo Hero" };
}
// ═══════════════════════════════════════════
// MODAL COMPLETO: crear o editar usuario
// ═══════════════════════════════════════════
// user = null → modo crear; user = objeto → modo editar.
function openUserModal(user) {
  const editing = user !== null;
  const nameVal      = user?.identity?.name || "";
  const jobTitleVal  = user?.display?.jobTitle || "";
  const photoVal     = user?.identity?.photo || "";
  const countryIso   = user?.identity?.country || (editing ? "" : "VE");
  const countryVal   = countryLabel(countryIso) || (editing ? "" : "Venezuela");
  const emailsArr    = Array.isArray(user?.identity?.emails) ? user.identity.emails : [];
  const phonesArr    = Array.isArray(user?.identity?.phones) ? user.identity.phones : [];
  const birthdateVal = user?.identity?.birthdate || "";
  const bio          = user?.display?.bio || {};
  const roleVal      = user?.access?.role || "";
  const originalEmail = user?._email || null;
  const [bm, bd] = (birthdateVal).split("-");
  const generic = editing ? generateHeroicBio(user) : { identidad:"", origen:"", superpoder:"", frase:"" };

  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? ("Editar usuario · " + nameVal) : "Nuevo usuario";
  dialog.className = "member-edit-dialog";
  const html = `
    <div class="member-form">
      <div class="member-photo-uploader" id="m-photo-uploader">
        <div class="member-photo-avatar">
          <img id="m-photo-img" alt="Foto del usuario"
               src="${esc(photoVal)}"
               onerror="this.style.opacity='.3';this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%221.5%22><circle cx=%2212%22 cy=%228%22 r=%224%22/><path d=%22M4 20c0-4 4-6 8-6s8 2 8 6%22/></svg>'"/>
          <div class="member-photo-overlay">
            <i data-lucide="camera"></i>
            <span>Cambiar foto</span>
          </div>
        </div>
        <input type="file" id="m-photo-file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="member-photo-caption">
          <span id="m-photo-caption-text">Click o arrastra una imagen · máx 2 MB · JPG/PNG/WebP</span>
        </div>
      </div>

      <div class="mf-section">
        <div class="mf-section-kicker">Persona</div>
        <div class="mf-grid-2">
          <sl-input id="m-name" label="Nombre completo"
            value="${esc(nameVal)}" maxlength="60" required clearable></sl-input>
          <sl-input id="m-role" label="Cargo"
            value="${esc(jobTitleVal)}" maxlength="60" clearable></sl-input>
        </div>
      </div>

      <div class="mf-section">
        <div class="mf-section-kicker">Acceso</div>
        <label class="m-native-field">
          <span class="m-native-label">Rol de acceso al Hub</span>
          <select id="m-access-role" class="m-native-select">
            <option value="">— sin rol (no puede entrar al Hub) —</option>
            ${AVAILABLE_ROLES.map(r => `<option value="${r}">${esc(ROLES[r].label)}</option>`).join("")}
          </select>
        </label>
        <div>
          <span class="mf-field-label">Emails *</span>
          <div class="mf-input-list" id="m-emails-list"></div>
          <button type="button" class="mf-row-add" id="m-emails-add">
            <i data-lucide="plus"></i>
            Agregar otro email
          </button>
        </div>
        <label class="mf-checkbox">
          <input type="checkbox" id="m-excluded">
          <span class="mf-checkbox-body">
            <span class="mf-checkbox-label">Ocultar del módulo Equipo</span>
            <span class="mf-checkbox-hint">Para empleados en período de prueba, cuentas técnicas o ex-empleados con acceso residual. Sigue pudiendo entrar al Hub y marcar asistencia, pero no aparece en la vista pública del organigrama.</span>
          </span>
        </label>
        <label class="mf-checkbox">
          <input type="checkbox" id="m-no-attendance">
          <span class="mf-checkbox-body">
            <span class="mf-checkbox-label">Exento de marcar asistencia</span>
            <span class="mf-checkbox-hint">Para la directiva y cuentas que no fichan. Le oculta el tile de asistencia del banner, la sección de asistencia en Mi Perfil y el botón de Ausencia. No altera su rol ni borra los registros que ya tenga.</span>
          </span>
        </label>
      </div>

      <div class="mf-section">
        <div class="mf-section-kicker">Contacto y origen</div>
        <div class="mf-grid-2">
          <label class="m-native-field">
            <span class="m-native-label">País</span>
            <input id="m-country" type="text" class="m-native-input"
              value="${esc(countryVal)}" maxlength="40"
              list="m-country-suggestions"
              placeholder="Ej: Venezuela, España, Colombia…" autocomplete="off">
            <datalist id="m-country-suggestions">
              ${COUNTRIES_SUGGESTED.map(c => `<option value="${esc(c)}"></option>`).join("")}
            </datalist>
          </label>
          <div class="member-bday">
            <label class="member-bday-label">🎂 Cumpleaños</label>
            <div class="member-bday-row">
              <select id="m-bmonth" class="m-native-select">
                <option value="">— Mes —</option>
                ${MONTHS.map((x, i) => `<option value="${String(i+1).padStart(2,"0")}">${x}</option>`).join("")}
              </select>
              <select id="m-bday" class="m-native-select">
                <option value="">— Día —</option>
                ${Array.from({length:31}, (_, i) => i+1).map(d => `<option value="${String(d).padStart(2,"0")}">${d}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>
        <div>
          <span class="mf-field-label">Teléfonos</span>
          <div class="mf-input-list" id="m-phones-list"></div>
          <button type="button" class="mf-row-add" id="m-phones-add">
            <i data-lucide="plus"></i>
            Agregar otro teléfono
          </button>
        </div>
      </div>

      ${editing ? `
      <div class="mf-section">
        <div class="mf-section-kicker">Ficha del héroe</div>
        <label class="m-native-field">
          <span class="m-native-label">Se unió al equipo</span>
          <input id="bio-union" type="month" class="m-native-input"
            placeholder="YYYY-MM">
        </label>
        <sl-textarea id="bio-frase" label="Frase icónica"
          rows="2" resize="vertical"
          placeholder="${esc(generic.frase || "")}"></sl-textarea>
      </div>
      ` : ""}
    </div>

    <sl-button slot="footer" id="m-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="m-save" variant="primary">
      <i data-lucide="${editing ? "check" : "plus"}" slot="prefix" style="width:14px;height:14px;"></i>
      ${editing ? "Guardar cambios" : "Crear usuario"}
    </sl-button>
  `;
  dialog["inner" + "HTML"] = html;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  dialog.querySelector("#m-bmonth").value = bm || "";
  dialog.querySelector("#m-bday").value = bd || "";
  dialog.querySelector("#m-access-role").value = roleVal;
  dialog.querySelector("#m-excluded").checked = user?.meta?.excluded === true;
  // Solo un false explícito exime de fichar: los docs viejos sin el campo
  // (y los usuarios nuevos) fichan normal.
  dialog.querySelector("#m-no-attendance").checked = user?.access?.trackAttendance === false;
  if (editing) {
    // bio.frase se setea por atributo `value=` en el HTML
    // bio.union se parsea de "Marzo 2024" a "2024-03" para el input type=month
    dialog.querySelector("#bio-union").value = unionLabelToYYYYMM(bio.union);
  }

  // ── Emails: filas dinámicas con prefijo + suffix @hero + botón + ──
  const emailsListEl = dialog.querySelector("#m-emails-list");
  const emailsAddBtn = dialog.querySelector("#m-emails-add");

  function makeEmailRow(prefix = "", isPrimaryReadonly = false) {
    const row = document.createElement("div");
    row.className = "mf-input-row";
    const group = document.createElement("div");
    group.className = "mf-email-input";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mf-email-prefix";
    input.value = prefix;
    input.placeholder = "usuario";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (isPrimaryReadonly) {
      input.readOnly = true;
      input.title = "El primer email es el ID del usuario y no se puede cambiar";
    }
    const suffix = document.createElement("span");
    suffix.className = "mf-email-suffix";
    suffix.textContent = HERO_DOMAIN;
    group.append(input, suffix);
    row.appendChild(group);
    if (!isPrimaryReadonly) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "mf-row-remove";
      rm.title = "Quitar email";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        row.remove();
        if (!emailsListEl.children.length) emailsListEl.appendChild(makeEmailRow());
      });
      row.appendChild(rm);
    }
    return row;
  }

  const initialPrefixes = emailsArr.map(e =>
    (e || "").replace(new RegExp(HERO_DOMAIN.replace(".", "\\.") + "$", "i"), "")
  );
  if (!initialPrefixes.length) {
    emailsListEl.appendChild(makeEmailRow("", false));
  } else {
    initialPrefixes.forEach((prefix, i) => {
      emailsListEl.appendChild(makeEmailRow(prefix, editing && i === 0));
    });
  }
  emailsAddBtn.addEventListener("click", () => {
    const row = makeEmailRow("", false);
    emailsListEl.appendChild(row);
    row.querySelector(".mf-email-prefix").focus();
    if (window.refreshIcons) window.refreshIcons();
  });

  // ── Teléfonos: filas dinámicas con input tel + botón + ──
  const phonesListEl = dialog.querySelector("#m-phones-list");
  const phonesAddBtn = dialog.querySelector("#m-phones-add");

  function makePhoneRow(value = "") {
    const row = document.createElement("div");
    row.className = "mf-input-row";
    const input = document.createElement("input");
    input.type = "tel";
    input.className = "m-native-input";
    input.value = value;
    input.placeholder = "+58 412 555 1234";
    input.autocomplete = "tel";
    row.appendChild(input);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-row-remove";
    rm.title = "Quitar teléfono";
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      row.remove();
      if (!phonesListEl.children.length) phonesListEl.appendChild(makePhoneRow());
    });
    row.appendChild(rm);
    return row;
  }

  if (!phonesArr.length) {
    phonesListEl.appendChild(makePhoneRow(""));
  } else {
    phonesArr.forEach(p => phonesListEl.appendChild(makePhoneRow(p)));
  }
  phonesAddBtn.addEventListener("click", () => {
    const row = makePhoneRow("");
    phonesListEl.appendChild(row);
    row.querySelector("input").focus();
  });

  let pendingPhotoFile = null;
  const uploaderEl = dialog.querySelector("#m-photo-uploader");
  const photoImgEl = dialog.querySelector("#m-photo-img");
  const photoFileInput = dialog.querySelector("#m-photo-file");
  const photoCaptionEl = dialog.querySelector("#m-photo-caption-text");

  const handlePhotoFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      heroToast.error("Solo imágenes (JPG, PNG, WebP).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      heroToast.error("La imagen debe pesar menos de 2 MB.");
      return;
    }
    pendingPhotoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      photoImgEl.src = reader.result;
      photoImgEl.style.opacity = "1";
    };
    reader.readAsDataURL(file);
    photoCaptionEl.textContent = `${file.name} · listo para subir al guardar`;
    uploaderEl.classList.add("has-pending");
  };

  uploaderEl.addEventListener("click", (e) => {
    if (e.target === photoFileInput) return;
    photoFileInput.click();
  });
  photoFileInput.addEventListener("change", (e) => handlePhotoFile(e.target.files?.[0]));
  uploaderEl.addEventListener("dragover", (e) => { e.preventDefault(); uploaderEl.classList.add("dragging"); });
  uploaderEl.addEventListener("dragleave", () => uploaderEl.classList.remove("dragging"));
  uploaderEl.addEventListener("drop", (e) => {
    e.preventDefault();
    uploaderEl.classList.remove("dragging");
    handlePhotoFile(e.dataTransfer.files?.[0]);
  });

  dialog.addEventListener("sl-after-hide", () => dialog.remove());
  dialog.querySelector("#m-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#m-save").addEventListener("click", async () => {
    const saveBtn = dialog.querySelector("#m-save");
    const originalLabel = saveBtn.textContent;
    const bmo = dialog.querySelector("#m-bmonth").value || "";
    const bdy = dialog.querySelector("#m-bday").value || "";
    const birthdate = (bmo && bdy) ? `${bmo}-${bdy}` : "";

    // Bio: 2 subcampos editables (union/frase). identidad y superpoder se
    // derivan automáticamente del jobTitle en generateHeroicBio — no se
    // persisten desde el modal. Los valores custom pre-existentes se preservan.
    const emptyBio = { identidad: "", superpoder: "", frase: "", union: "" };
    let newBio = emptyBio;
    if (editing) {
      newBio = {
        identidad: bio.identidad || "",   // preserva lo pre-existente
        superpoder: bio.superpoder || "", // preserva lo pre-existente
        union: unionYYYYMMtoLabel(dialog.querySelector("#bio-union").value),
        frase: (dialog.querySelector("#bio-frase").value || "").trim(),
      };
    }

    const name = (dialog.querySelector("#m-name").value || "").trim();
    if (!name) {
      dialog.querySelector("#m-name").focus();
      heroToast.error("El nombre es requerido");
      return;
    }

    // Colecta emails (concatena dominio) y filtra vacíos
    const emailsPayload = [...dialog.querySelectorAll(".mf-email-prefix")]
      .map(inp => inp.value.trim().toLowerCase())
      .filter(Boolean)
      .map(p => p + HERO_DOMAIN);
    const phonesPayload = [...phonesListEl.querySelectorAll("input")]
      .map(inp => inp.value.trim())
      .filter(Boolean);
    const primaryEmail = emailsPayload[0];
    const jobTitle = (dialog.querySelector("#m-role").value || "").trim();
    const countryStr = (dialog.querySelector("#m-country").value || "").trim();
    const countryIsoResolved = countryStr ? nameToIso(countryStr) : null;
    if (countryStr && !countryIsoResolved) {
      heroToast.error(`País "${countryStr}" no reconocido. Usa un nombre estándar (Venezuela, Colombia, etc.)`);
      return;
    }
    if (!primaryEmail) {
      heroToast.error("Al menos un email es requerido (el primero será el docId)");
      return;
    }
    if (editing && originalEmail && primaryEmail !== originalEmail.toLowerCase()) {
      heroToast.error("No se puede cambiar el email principal desde aquí. Elimina el usuario y créalo con el nuevo email si es necesario.");
      return;
    }

    const newRole = dialog.querySelector("#m-access-role").value || null;
    const newExcluded = dialog.querySelector("#m-excluded").checked;
    // El checkbox pregunta por la exención; el campo guarda lo contrario.
    const newTrackAttendance = !dialog.querySelector("#m-no-attendance").checked;

    let photoPath = photoVal;
    if (pendingPhotoFile) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Subiendo foto…";
      try {
        const slug = slugifyName(name);
        photoPath = await uploadPhotoToGitHub(pendingPhotoFile, slug);
        heroToast.info("Foto subida al repo. Será visible en 1-3 min tras el redeploy de GitHub Pages.");
      } catch (e) {
        console.error("[upload photo]", e);
        heroToast.error("Error subiendo foto: " + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
        return;
      }
      saveBtn.textContent = "Guardando…";
    }

    try {
      if (editing) {
        const oldRole = user.access?.role || null;
        const oldTrackAttendance = user.access?.trackAttendance !== false;
        await updateUserFields(originalEmail, {
          "identity.name": name,
          "identity.photo": photoPath,
          "identity.country": countryIsoResolved,
          "identity.birthdate": birthdate,
          "identity.phones": phonesPayload,
          "identity.emails": emailsPayload,
          "display.jobTitle": jobTitle,
          "display.bio": newBio || emptyBio,
          "access.role": newRole,
          "access.trackAttendance": newTrackAttendance,
          "meta.excluded": newExcluded,
        });
        user.identity = { ...(user.identity || {}), name, photo: photoPath,
                          country: countryIsoResolved, birthdate,
                          phones: phonesPayload, emails: emailsPayload };
        user.display = { ...(user.display || {}), jobTitle, bio: newBio || emptyBio };
        if (!user.access) user.access = {};
        user.access.role = newRole;
        user.access.trackAttendance = newTrackAttendance;
        user.access.updatedBy = currentAdminEmail;
        user.access.updatedAt = { toDate: () => new Date() };
        if (!user.meta) user.meta = {};
        user.meta.excluded = newExcluded;
        if (oldRole !== newRole) {
          logEvent(ACTIONS.ROLE_UPDATE, originalEmail, {
            from: ROLES[oldRole]?.label || oldRole || "(sin rol)",
            to: ROLES[newRole]?.label || newRole || "(sin rol)"
          });
        }
        if (oldTrackAttendance !== newTrackAttendance) {
          logEvent(ACTIONS.ATTENDANCE_OPTOUT, originalEmail, {
            estado: newTrackAttendance ? "Vuelve a fichar" : "Exento"
          });
        }
        table.updateRow(originalEmail, buildRow(user));
      } else {
        const created = await createUser(primaryEmail, {
          name, photo: photoPath,
          country: countryIsoResolved, birthdate,
          phones: phonesPayload, emails: emailsPayload,
          jobTitle, role: newRole,
          excluded: newExcluded,
          trackAttendance: newTrackAttendance,
        });
        users.push(created);
        users.sort((a, b) => (a.identity?.name || "").localeCompare(b.identity?.name || ""));
        logEvent(ACTIONS.ROLE_CREATE, primaryEmail, { role: ROLES[newRole]?.label || newRole || "(sin rol)" });
        if (!newTrackAttendance) {
          logEvent(ACTIONS.ATTENDANCE_OPTOUT, primaryEmail, { estado: "Exento" });
        }
        table.addRow(buildRow(created));
      }
      renderStats();
      dialog.hide();
      showStatus(editing ? ("✓ " + name + " actualizado") : ("✓ " + name + " agregado"));
    } catch (e) {
      console.error("[user save]", e);
      heroToast.error("Error guardando: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  });

  customElements.whenDefined("sl-dialog").then(() => dialog.show());
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
