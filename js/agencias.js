// ═══════════════════════════════════════════
// Hero Hub · Organigrama de Agencias (Fase 2a)
// ═══════════════════════════════════════════
// Lee shared/agencias de Firestore y renderiza dos vistas:
//   - Cards: grid de agencias con AIC + brokers
//   - Tree:  jerarquía visual HERO → agencias → personas
//
// FASE 2a: edición CRUD para admins:
//   - Botones de editar / eliminar en cada card
//   - Botón "Nueva agencia" en el header
//   - Modal único para crear/editar
//   - Confirm con nombre exacto al eliminar
//   - Audit log automático

import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { logEvent } from "./audit-log.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

// Action types nuevos para Fase 2a
const ACT_AGENCY_ADD = "agency.add";
const ACT_AGENCY_EDIT = "agency.edit";
const ACT_AGENCY_DELETE = "agency.delete";

let DATA = { hero: [], friends: [], pending: [], updatedAt: null };
let filter = { text: "", group: "all" };
let canEdit = false;

// ══ Auth flow ══
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { location.href = "index.html"; }
    return;
  }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    alert("Acceso restringido a cuentas @heroinsuranceusa.com");
    location.href = "index.html";
    return;
  }

  const ctx = await window.getPageContext();
  canEdit = isAdminRole(ctx.userRole);

  document.getElementById("user-avatar").src = user.photoURL || "";
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  if (canEdit) {
    document.getElementById("ag-btn-new").style.display = "inline-flex";
  }

  await loadData();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () =>
  signOut(auth).then(() => location.href = "index.html")
);

// ══ Cargar datos desde Firestore ══
async function loadData() {
  try {
    const snap = await getDoc(doc(db, "shared", "agencias"));
    if (snap.exists()) {
      const data = snap.data();
      DATA = {
        hero: Array.isArray(data.hero) ? data.hero : [],
        friends: Array.isArray(data.friends) ? data.friends : [],
        pending: Array.isArray(data.pending) ? data.pending : [],
        updatedAt: data.updatedAt || null
      };
    }
    renderStats();
    renderActiveView();
  } catch (e) {
    console.error("Error cargando agencias:", e);
    document.getElementById("ag-cards-grid").innerHTML =
      `<p class="empty">Error: ${escapeHtml(e.message)}</p>`;
  }
}

// ══ Stats ══
function renderStats() {
  let totalAg = 0, totalAic = 0, totalBrokers = 0;
  ["hero", "friends", "pending"].forEach(g => {
    DATA[g].forEach(a => {
      totalAg++;
      totalAic += (a.aic || []).length;
      totalBrokers += (a.brokers || []).length;
    });
  });
  document.getElementById("ag-stat-total").textContent = totalAg;
  document.getElementById("ag-stat-aic").textContent = totalAic;
  document.getElementById("ag-stat-brokers").textContent = totalBrokers;

  const upEl = document.getElementById("ag-stat-updated");
  if (DATA.updatedAt) {
    let date;
    if (DATA.updatedAt.toDate) date = DATA.updatedAt.toDate();
    else if (DATA.updatedAt.seconds) date = new Date(DATA.updatedAt.seconds * 1000);
    else date = new Date(DATA.updatedAt);
    upEl.textContent = date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
    upEl.style.fontSize = "20px";
  } else {
    upEl.textContent = "—";
  }
}

// ══ Filtrado ══
function getFilteredAgencies() {
  const groups = filter.group === "all"
    ? ["hero", "friends", "pending"]
    : [filter.group];

  const result = [];
  groups.forEach(g => {
    DATA[g].forEach(ag => {
      if (filter.text) {
        const hay = `${ag.name || ""} ${(ag.aic || []).join(" ")} ${(ag.brokers || []).join(" ")}`.toLowerCase();
        if (!hay.includes(filter.text)) return;
      }
      result.push({ ...ag, _group: g });
    });
  });
  return result;
}

// ══ Vista CARDS ══
function renderCards() {
  const grid = document.getElementById("ag-cards-grid");
  const filtered = getFilteredAgencies();

  if (!filtered.length) {
    grid.innerHTML = `<p class="empty">${filter.text ? "Sin resultados" : "No hay agencias todavía"}</p>`;
    return;
  }

  grid.innerHTML = filtered.map(ag => buildAgencyCard(ag)).join("");

  // Wire botones admin
  if (canEdit) {
    grid.querySelectorAll(".ag-card-edit").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAgencyModal(btn.dataset.id, btn.dataset.group);
      });
    });
    grid.querySelectorAll(".ag-card-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteAgency(btn.dataset.id, btn.dataset.group);
      });
    });
  }

  if (window.refreshIcons) window.refreshIcons();
}

function buildAgencyCard(ag) {
  const groupClass = `ag-group-${ag._group}`;
  const kindClass = `ag-kind-${ag.kind || "normal"}`;

  const badges = [];
  if (ag.kind === "matrix") badges.push(`<span class="ag-badge ag-badge-matrix">Matriz</span>`);
  if (ag.kind === "sub_goldpro") badges.push(`<span class="ag-badge ag-badge-sub">Sub-agencia · GOLD PRO</span>`);
  if (ag.kind === "info_limited") badges.push(`<span class="ag-badge ag-badge-warn">Info limitada</span>`);
  if (ag.kind === "no_data") badges.push(`<span class="ag-badge ag-badge-warn">Sin datos</span>`);
  if (ag.kind === "unclear") badges.push(`<span class="ag-badge ag-badge-warn">Por aclarar</span>`);
  if (ag.kind === "on_hold") badges.push(`<span class="ag-badge ag-badge-hold">On hold</span>`);

  const aicCount = (ag.aic || []).length;
  const brokerCount = (ag.brokers || []).length;
  if (aicCount > 0) badges.push(`<span class="ag-badge ag-badge-count">${aicCount} AIC</span>`);
  if (brokerCount > 0) badges.push(`<span class="ag-badge ag-badge-count">${brokerCount} brokers</span>`);

  const adminActions = canEdit ? `
    <div class="ag-card-actions">
      <button class="ag-card-edit" data-id="${escapeAttr(ag.id)}" data-group="${ag._group}" title="Editar">
        <i data-lucide="edit-3"></i>
      </button>
      <button class="ag-card-delete" data-id="${escapeAttr(ag.id)}" data-group="${ag._group}" title="Eliminar">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  ` : "";

  const aicSection = aicCount > 0
    ? `<div class="ag-aic-section">
         <div class="ag-section-label">${aicCount === 1 ? "Agente a cargo" : "Agentes a cargo"}</div>
         ${(ag.aic || []).map(name => `
           <div class="ag-aic-row">
             <div class="ag-avatar ag-avatar-aic">${getInitials(name)}</div>
             <div class="ag-aic-name">${escapeHtml(name)}</div>
           </div>
         `).join("")}
       </div>`
    : "";

  const brokersSection = brokerCount > 0
    ? `<div class="ag-brokers-section">
         <div class="ag-section-label">${brokerCount} ${brokerCount === 1 ? "broker" : "brokers"}</div>
         <div class="ag-brokers-list">
           ${(ag.brokers || []).map(name => `
             <span class="ag-broker-chip" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
           `).join("")}
         </div>
       </div>`
    : "";

  let note = "";
  if (ag.kind === "info_limited") {
    note = `<div class="ag-note"><i data-lucide="info"></i> Información limitada disponible</div>`;
  } else if (ag.kind === "no_data") {
    note = `<div class="ag-note"><i data-lucide="alert-circle"></i> Sin información detallada</div>`;
  } else if (ag.kind === "on_hold") {
    note = `<div class="ag-note"><i data-lucide="pause-circle"></i> Estado en pausa</div>`;
  }

  return `
    <div class="ag-card ${groupClass} ${kindClass}" data-id="${escapeAttr(ag.id)}">
      ${adminActions}
      <div class="ag-card-header">
        <div class="ag-card-name">${escapeHtml(ag.name || "Sin nombre")}</div>
        <div class="ag-card-badges">${badges.join("")}</div>
      </div>
      ${note}
      ${aicSection}
      ${brokersSection}
      ${aicCount === 0 && brokerCount === 0 ? '<p class="ag-empty-card">Sin información de personas todavía.</p>' : ""}
    </div>
  `;
}

// ══ Vista TREE ══
function renderTree() {
  const container = document.getElementById("ag-tree");
  const filtered = getFilteredAgencies();

  if (!filtered.length) {
    container.innerHTML = `<p class="empty">${filter.text ? "Sin resultados" : "No hay agencias todavía"}</p>`;
    return;
  }

  const byGroup = { hero: [], friends: [], pending: [] };
  filtered.forEach(ag => byGroup[ag._group].push(ag));

  let html = "";

  if (byGroup.hero.length) {
    const heroMatrix = byGroup.hero.find(a => a.kind === "matrix");
    const heroAgencies = byGroup.hero.filter(a => a.kind !== "matrix" && a.kind !== "sub_goldpro");
    const subGoldpro = byGroup.hero.find(a => a.kind === "sub_goldpro");

    html += `<div class="ag-tree-group ag-tree-hero">
      <div class="ag-tree-root">
        <div class="ag-tree-root-name">HERO</div>
        <div class="ag-tree-root-sub">Casa matriz</div>
      </div>
      <div class="ag-tree-children">`;

    if (heroMatrix) html += buildTreeNode(heroMatrix, "Brokers directos");

    heroAgencies.forEach(ag => {
      html += buildTreeNode(ag);
      if (ag.name === "GOLD PRO" && subGoldpro) {
        html += `<div class="ag-tree-sub-wrap">${buildTreeNode(subGoldpro, "Sub-agencia")}</div>`;
      }
    });

    html += `</div></div>`;
  }

  if (byGroup.friends.length) {
    html += `<div class="ag-tree-group ag-tree-friends">
      <div class="ag-tree-root ag-tree-root-friends">
        <div class="ag-tree-root-name">FRIENDS</div>
        <div class="ag-tree-root-sub">Grupo afiliado</div>
      </div>
      <div class="ag-tree-children">`;
    byGroup.friends.forEach(ag => { html += buildTreeNode(ag); });
    html += `</div></div>`;
  }

  if (byGroup.pending.length) {
    html += `<div class="ag-tree-group ag-tree-pending">
      <div class="ag-tree-root ag-tree-root-pending">
        <div class="ag-tree-root-name">Pendientes</div>
        <div class="ag-tree-root-sub">Por aclarar / on hold</div>
      </div>
      <div class="ag-tree-children">`;
    byGroup.pending.forEach(ag => { html += buildTreeNode(ag); });
    html += `</div></div>`;
  }

  container.innerHTML = html;
  if (window.refreshIcons) window.refreshIcons();
}

function buildTreeNode(ag, overrideLabel) {
  const aicNames = (ag.aic || []).map(n => escapeHtml(n)).join(", ");
  const brokerCount = (ag.brokers || []).length;
  const aicCount = (ag.aic || []).length;

  const subLabel = overrideLabel || (
    aicCount > 0 ? `AIC: ${aicNames}` : "Sin AIC asignado"
  );

  let badges = "";
  if (ag.kind === "matrix") badges += `<span class="ag-tree-tag tag-matrix">Matriz</span>`;
  if (ag.kind === "info_limited") badges += `<span class="ag-tree-tag tag-warn">Info limitada</span>`;
  if (ag.kind === "no_data") badges += `<span class="ag-tree-tag tag-warn">Sin datos</span>`;
  if (ag.kind === "on_hold") badges += `<span class="ag-tree-tag tag-hold">On hold</span>`;
  if (ag.kind === "unclear") badges += `<span class="ag-tree-tag tag-warn">Por aclarar</span>`;
  if (brokerCount > 0) badges += `<span class="ag-tree-tag tag-count">${brokerCount} brokers</span>`;

  return `<div class="ag-tree-node">
    <div class="ag-tree-node-name">${escapeHtml(ag.name)}</div>
    <div class="ag-tree-node-sub">${subLabel}</div>
    ${badges ? `<div class="ag-tree-node-tags">${badges}</div>` : ""}
  </div>`;
}

// ══════════════════════════════════════════
// MODAL: Nueva / Editar agencia
// ══════════════════════════════════════════

function openAgencyModal(agencyId, group) {
  const isNew = !agencyId;
  let agency = null;
  let originalGroup = group;

  if (!isNew) {
    agency = findAgency(agencyId, group);
    if (!agency) { alert("No se encontró la agencia."); return; }
  } else {
    agency = { id: "", name: "", kind: "normal", aic: [], brokers: [] };
    originalGroup = "hero";
  }

  const overlay = document.createElement("div");
  overlay.className = "ag-modal-overlay";
  overlay.innerHTML = `
    <div class="ag-modal">
      <button class="ag-modal-close" id="ag-modal-close" title="Cerrar">
        <i data-lucide="x"></i>
      </button>

      <div class="ag-modal-header">
        <div class="ag-modal-kicker">
          ${isNew ? "Nueva agencia" : "Editar agencia"}
        </div>
        <h2 class="ag-modal-title">${isNew ? "Crear nueva agencia" : escapeHtml(agency.name)}</h2>
      </div>

      <div class="ag-modal-body">

        <div class="ag-form-grid">
          <label class="ag-form-field">
            <span class="ag-form-label">Nombre <span class="ag-required">*</span></span>
            <input type="text" id="ag-f-name" value="${escapeAttr(agency.name)}" placeholder="Ej. THE KAIZEN TEAM">
          </label>

          <label class="ag-form-field">
            <span class="ag-form-label">Grupo <span class="ag-required">*</span></span>
            <select id="ag-f-group">
              <option value="hero" ${originalGroup === "hero" ? "selected" : ""}>Bajo HERO</option>
              <option value="friends" ${originalGroup === "friends" ? "selected" : ""}>Bajo FRIENDS</option>
              <option value="pending" ${originalGroup === "pending" ? "selected" : ""}>Pendientes</option>
            </select>
          </label>
        </div>

        <label class="ag-form-field">
          <span class="ag-form-label">Tipo</span>
          <select id="ag-f-kind">
            <option value="normal" ${agency.kind === "normal" ? "selected" : ""}>Normal</option>
            <option value="matrix" ${agency.kind === "matrix" ? "selected" : ""}>Matriz (HERO o FRIENDS)</option>
            <option value="sub_goldpro" ${agency.kind === "sub_goldpro" ? "selected" : ""}>Sub-agencia · GOLD PRO</option>
            <option value="info_limited" ${agency.kind === "info_limited" ? "selected" : ""}>Información limitada</option>
            <option value="no_data" ${agency.kind === "no_data" ? "selected" : ""}>Sin datos</option>
            <option value="unclear" ${agency.kind === "unclear" ? "selected" : ""}>Por aclarar</option>
            <option value="on_hold" ${agency.kind === "on_hold" ? "selected" : ""}>On hold</option>
          </select>
        </label>

        <label class="ag-form-field">
          <span class="ag-form-label">
            Agentes a cargo (AIC) <span class="ag-form-hint">— uno por línea</span>
          </span>
          <textarea id="ag-f-aic" rows="3" placeholder="Nombre del AIC...">${escapeHtml((agency.aic || []).join("\n"))}</textarea>
        </label>

        <label class="ag-form-field">
          <span class="ag-form-label">
            Brokers <span class="ag-form-hint">— uno por línea</span>
          </span>
          <textarea id="ag-f-brokers" rows="8" placeholder="Nombre del broker...">${escapeHtml((agency.brokers || []).join("\n"))}</textarea>
          <span class="ag-form-counter" id="ag-f-counter">0 brokers</span>
        </label>

      </div>

      <div class="ag-modal-footer">
        <button class="ag-modal-btn ag-modal-btn-cancel" id="ag-modal-cancel">Cancelar</button>
        <button class="ag-modal-btn ag-modal-btn-save" id="ag-modal-save">
          ${isNew ? "Crear agencia" : "Guardar cambios"}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (window.refreshIcons) window.refreshIcons();

  const updateCounter = () => {
    const text = overlay.querySelector("#ag-f-brokers").value;
    const count = text.split("\n").filter(l => l.trim()).length;
    overlay.querySelector("#ag-f-counter").textContent = `${count} broker${count === 1 ? "" : "s"}`;
  };
  overlay.querySelector("#ag-f-brokers").addEventListener("input", updateCounter);
  updateCounter();

  const close = () => overlay.remove();
  overlay.querySelector("#ag-modal-close").addEventListener("click", close);
  overlay.querySelector("#ag-modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const escHandler = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  overlay.querySelector("#ag-modal-save").addEventListener("click", async () => {
    const name = overlay.querySelector("#ag-f-name").value.trim();
    const newGroup = overlay.querySelector("#ag-f-group").value;
    const kind = overlay.querySelector("#ag-f-kind").value;
    const aic = overlay.querySelector("#ag-f-aic").value
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const brokers = overlay.querySelector("#ag-f-brokers").value
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (!name) {
      alert("El nombre es obligatorio.");
      return;
    }

    const saveBtn = overlay.querySelector("#ag-modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";

    try {
      if (isNew) {
        await createAgency({ name, kind, aic, brokers, group: newGroup });
      } else {
        await updateAgency(agencyId, originalGroup, { name, kind, aic, brokers, group: newGroup });
      }
      close();
      await loadData();
    } catch (e) {
      console.error(e);
      alert("Error al guardar: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = isNew ? "Crear agencia" : "Guardar cambios";
    }
  });
}

// ══════════════════════════════════════════
// CRUD operations
// ══════════════════════════════════════════

async function createAgency(input) {
  const newAg = {
    id: generateId(),
    name: input.name,
    kind: input.kind || "normal",
    aic: input.aic || [],
    brokers: input.brokers || []
  };

  const updatedArray = [...(DATA[input.group] || []), newAg];

  await updateDoc(doc(db, "shared", "agencias"), {
    [input.group]: updatedArray,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.email
  });

  await logEvent(ACT_AGENCY_ADD, newAg.name, {
    group: input.group,
    kind: newAg.kind,
    aicCount: newAg.aic.length,
    brokerCount: newAg.brokers.length
  });
}

async function updateAgency(agencyId, originalGroup, input) {
  const newGroup = input.group;
  const original = findAgency(agencyId, originalGroup);
  if (!original) throw new Error("Agencia original no encontrada");

  const updated = {
    id: agencyId,
    name: input.name,
    kind: input.kind || "normal",
    aic: input.aic || [],
    brokers: input.brokers || []
  };

  const changes = detectChanges(original, updated);

  if (originalGroup === newGroup) {
    const newArr = DATA[originalGroup].map(a => a.id === agencyId ? updated : a);
    await updateDoc(doc(db, "shared", "agencias"), {
      [originalGroup]: newArr,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    });
  } else {
    const oldArr = DATA[originalGroup].filter(a => a.id !== agencyId);
    const newArr = [...DATA[newGroup], updated];
    await updateDoc(doc(db, "shared", "agencias"), {
      [originalGroup]: oldArr,
      [newGroup]: newArr,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    });
    changes.push(`grupo: ${originalGroup} → ${newGroup}`);
  }

  await logEvent(ACT_AGENCY_EDIT, updated.name, {
    group: newGroup,
    changes: changes.join("; ") || "(sin cambios detectados)"
  });
}

async function deleteAgency(agencyId, group) {
  const agency = findAgency(agencyId, group);
  if (!agency) { alert("Agencia no encontrada."); return; }

  const typed = prompt(
    `⚠️ Esta acción es PERMANENTE.\n\n` +
    `Para confirmar, escribe el nombre exacto de la agencia:\n\n${agency.name}`
  );
  if (typed === null) return;
  if (typed.trim() !== agency.name) {
    alert("El nombre no coincide. Eliminación cancelada.");
    return;
  }

  try {
    const newArr = DATA[group].filter(a => a.id !== agencyId);
    await updateDoc(doc(db, "shared", "agencias"), {
      [group]: newArr,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    });

    await logEvent(ACT_AGENCY_DELETE, agency.name, {
      group,
      kind: agency.kind,
      aicCount: (agency.aic || []).length,
      brokerCount: (agency.brokers || []).length
    });

    await loadData();
  } catch (e) {
    console.error(e);
    alert("Error al eliminar: " + e.message);
  }
}

// ══════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════

function findAgency(id, group) {
  if (group && DATA[group]) {
    const found = DATA[group].find(a => a.id === id);
    if (found) return found;
  }
  for (const g of ["hero", "friends", "pending"]) {
    const found = DATA[g].find(a => a.id === id);
    if (found) return found;
  }
  return null;
}

function detectChanges(original, updated) {
  const changes = [];
  if (original.name !== updated.name) {
    changes.push(`nombre: "${original.name}" → "${updated.name}"`);
  }
  if (original.kind !== updated.kind) {
    changes.push(`tipo: ${original.kind} → ${updated.kind}`);
  }
  const oldAic = (original.aic || []).join("|");
  const newAic = (updated.aic || []).join("|");
  if (oldAic !== newAic) {
    changes.push(`AIC: ${(original.aic || []).length} → ${(updated.aic || []).length}`);
  }
  const oldBro = (original.brokers || []).join("|");
  const newBro = (updated.brokers || []).join("|");
  if (oldBro !== newBro) {
    changes.push(`brokers: ${(original.brokers || []).length} → ${(updated.brokers || []).length}`);
  }
  return changes;
}

function generateId() {
  return "ag_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 6);
}

// ══ Event handlers ══
function wireHandlers() {
  document.getElementById("ag-search").addEventListener("input", (e) => {
    filter.text = e.target.value.toLowerCase().trim();
    renderActiveView();
  });

  document.querySelectorAll("#ag-filter-row .filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#ag-filter-row .filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.group = chip.dataset.group;
      renderActiveView();
    });
  });

  document.querySelectorAll(".ag-view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ag-view-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const view = tab.dataset.view;
      document.getElementById("ag-view-cards").style.display = view === "cards" ? "block" : "none";
      document.getElementById("ag-view-tree").style.display = view === "tree" ? "block" : "none";
      renderActiveView();
    });
  });

  const btnNew = document.getElementById("ag-btn-new");
  if (btnNew) {
    btnNew.addEventListener("click", () => openAgencyModal(null, null));
  }
}

function renderActiveView() {
  const cardsActive = document.querySelector(".ag-view-tab[data-view='cards']").classList.contains("active");
  if (cardsActive) renderCards();
  else renderTree();
}

function getInitials(name) {
  return (name || "?")
    .split(" ")
    .filter(p => p.length > 0)
    .slice(0, 2)
    .map(p => p[0] || "")
    .join("")
    .toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str || "");
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}
