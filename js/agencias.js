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
    document.getElementById("ag-tree").innerHTML =
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

  const terms = getSearchTerms();
  const result = [];

  groups.forEach(g => {
    DATA[g].forEach(ag => {
      // Sin búsqueda: incluir todo
      if (!terms.length) {
        result.push({ ...ag, _group: g, _matchedBrokers: null, _matchedAic: null });
        return;
      }

      // Con búsqueda: detectar matches
      const nameMatch = matchesAllTerms(ag.name || "", terms);
      const matchedAic = (ag.aic || []).filter(n => matchesAllTerms(n, terms));
      const matchedBrokers = (ag.brokers || []).filter(n => matchesAllTerms(n, terms));

      const hasAnyMatch = nameMatch || matchedAic.length > 0 || matchedBrokers.length > 0;
      if (!hasAnyMatch) return;

      result.push({
        ...ag,
        _group: g,
        // Si el match es por nombre de agencia, mostrar TODO el contenido.
        // Si el match es solo por broker/AIC, mostrar solo los que matchean.
        _matchedBrokers: nameMatch ? null : matchedBrokers,
        _matchedAic: nameMatch ? null : matchedAic
      });
    });
  });
  return result;
}

// ══ Vista TREE (única) — nodos colapsables ══
function renderTree() {
  const container = document.getElementById("ag-tree");
  const filtered = getFilteredAgencies();

  if (!filtered.length) {
    container.innerHTML = `<p class="empty">${filter.text ? "Sin resultados" : "No hay agencias todavía"}</p>`;
    return;
  }

  // Si hay búsqueda activa, las agencias coincidentes se auto-expanden
  const autoExpand = filter.text.length > 0;

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

    if (heroMatrix) html += buildTreeNode(heroMatrix, autoExpand, "Brokers directos");

    heroAgencies.forEach(ag => {
      html += buildTreeNode(ag, autoExpand);
      if (ag.name === "GOLD PRO" && subGoldpro) {
        html += `<div class="ag-tree-sub-wrap">${buildTreeNode(subGoldpro, autoExpand, "Sub-agencia")}</div>`;
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
    byGroup.friends.forEach(ag => { html += buildTreeNode(ag, autoExpand); });
    html += `</div></div>`;
  }

  if (byGroup.pending.length) {
    html += `<div class="ag-tree-group ag-tree-pending">
      <div class="ag-tree-root ag-tree-root-pending">
        <div class="ag-tree-root-name">Pendientes</div>
        <div class="ag-tree-root-sub">Por aclarar / on hold</div>
      </div>
      <div class="ag-tree-children">`;
    byGroup.pending.forEach(ag => { html += buildTreeNode(ag, autoExpand); });
    html += `</div></div>`;
  }

  container.innerHTML = html;

  // Wire toggle handlers (click en header expande/colapsa)
  container.querySelectorAll(".ag-tree-node").forEach(node => {
    const header = node.querySelector(".ag-tree-node-header");
    if (header) {
      header.addEventListener("click", (e) => {
        // Evitar toggle si se hace click en botones admin
        if (e.target.closest(".ag-tree-node-actions")) return;
        node.classList.toggle("expanded");
      });
    }
  });

  // Wire botones admin
  if (canEdit) {
    container.querySelectorAll(".ag-tree-edit").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAgencyModal(btn.dataset.id, btn.dataset.group);
      });
    });
    container.querySelectorAll(".ag-tree-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteAgency(btn.dataset.id, btn.dataset.group);
      });
    });
  }

  if (window.refreshIcons) window.refreshIcons();
}

function buildTreeNode(ag, autoExpand, overrideLabel) {
  const terms = getSearchTerms();
  const isFiltered = terms.length > 0;

  // Si hay match filtrado, usar SOLO los AICs/brokers que matchean
  const aicList = (isFiltered && ag._matchedAic !== null) ? ag._matchedAic : (ag.aic || []);
  const brokerList = (isFiltered && ag._matchedBrokers !== null) ? ag._matchedBrokers : (ag.brokers || []);

  const totalAic = (ag.aic || []).length;
  const totalBrokers = (ag.brokers || []).length;
  const aicCount = aicList.length;
  const brokerCount = brokerList.length;

  // Cuántos NO se muestran (para el badge "+N más")
  const aicHidden = totalAic - aicCount;
  const brokerHidden = totalBrokers - brokerCount;

  const hasContent = totalAic > 0 || totalBrokers > 0;

  // Tags de estado
  let tags = "";
  if (ag.kind === "matrix") tags += `<span class="ag-tree-tag tag-matrix">Matriz</span>`;
  if (ag.kind === "info_limited") tags += `<span class="ag-tree-tag tag-warn">Info limitada</span>`;
  if (ag.kind === "no_data") tags += `<span class="ag-tree-tag tag-warn">Sin datos</span>`;
  if (ag.kind === "on_hold") tags += `<span class="ag-tree-tag tag-hold">On hold</span>`;
  if (ag.kind === "unclear") tags += `<span class="ag-tree-tag tag-warn">Por aclarar</span>`;
  if (totalBrokers > 0) tags += `<span class="ag-tree-tag tag-count">${totalBrokers} brokers</span>`;

  // Acciones admin
  const adminActions = canEdit ? `
    <div class="ag-tree-node-actions">
      <button class="ag-tree-edit" data-id="${escapeAttr(ag.id)}" data-group="${ag._group}" title="Editar">
        <i data-lucide="edit-3"></i>
      </button>
      <button class="ag-tree-delete" data-id="${escapeAttr(ag.id)}" data-group="${ag._group}" title="Eliminar">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  ` : "";

  // Detalles colapsables
  let details = "";
  if (hasContent) {
    let aicDetailHtml = "";
    if (aicCount > 0) {
      aicDetailHtml = `
        <div class="ag-tree-aic-block">
          <div class="ag-tree-detail-label">
            ${aicCount === 1 ? "Agente a cargo" : "Agentes a cargo"}
            ${aicHidden > 0 ? `<span class="ag-hidden-badge">+${aicHidden} oculto${aicHidden === 1 ? "" : "s"}</span>` : ""}
          </div>
          ${aicList.map(name => `
            <div class="ag-tree-aic-row">
              <div class="ag-avatar ag-avatar-aic">${getInitials(name)}</div>
              <div class="ag-tree-aic-name">${highlight(name, terms)}</div>
            </div>
          `).join("")}
        </div>
      `;
    }

    let brokerListHtml = "";
    if (brokerCount > 0) {
      brokerListHtml = `
        <div class="ag-tree-brokers-block">
          <div class="ag-tree-detail-label">
            ${brokerCount} ${brokerCount === 1 ? "broker" : "brokers"}
            ${brokerHidden > 0 ? `<span class="ag-hidden-badge">+${brokerHidden} más</span>` : ""}
          </div>
          <ol class="ag-tree-brokers-list">
            ${brokerList.map(name => `
              <li class="ag-tree-broker-row">${highlight(name, terms)}</li>
            `).join("")}
          </ol>
        </div>
      `;
    }

    // Si hay búsqueda y NO hay nada visible (ni AIC ni brokers matchean,
    // pero el match fue por nombre de agencia), mostrar mensaje suave
    if (isFiltered && aicCount === 0 && brokerCount === 0) {
      brokerListHtml = `<p class="ag-empty-search">El nombre de la agencia coincide. Sin AIC/brokers que coincidan.</p>`;
    }

    details = `
      <div class="ag-tree-node-details">
        ${aicDetailHtml}
        ${brokerListHtml}
      </div>
    `;
  }

  // Nota especial
  let note = "";
  if (ag.kind === "info_limited") note = `<div class="ag-tree-note">Información limitada disponible</div>`;
  else if (ag.kind === "no_data") note = `<div class="ag-tree-note">Sin información detallada</div>`;
  else if (ag.kind === "on_hold") note = `<div class="ag-tree-note">Estado en pausa</div>`;

  // Indicador de expandible
  const expandIcon = hasContent
    ? `<i data-lucide="chevron-right" class="ag-tree-chevron"></i>`
    : `<span class="ag-tree-chevron-empty"></span>`;

  const expandedClass = (autoExpand && hasContent) ? " expanded" : "";
  const noContentClass = !hasContent ? " no-content" : "";

  // Sub label: si hay override usar texto plano, si no, AIC names con highlight
  let subLabelHtml;
  if (overrideLabel) {
    subLabelHtml = escapeHtml(overrideLabel);
  } else if (totalAic > 0) {
    const aicHl = (ag.aic || []).map(n => highlight(n, terms)).join(", ");
    subLabelHtml = `AIC: ${aicHl}`;
  } else {
    subLabelHtml = "Sin AIC asignado";
  }

  return `<div class="ag-tree-node${expandedClass}${noContentClass}">
    <div class="ag-tree-node-header">
      ${expandIcon}
      <div class="ag-tree-node-info">
        <div class="ag-tree-node-name">${highlight(ag.name || "", terms)}</div>
        <div class="ag-tree-node-sub">${subLabelHtml}</div>
        ${tags ? `<div class="ag-tree-node-tags">${tags}</div>` : ""}
        ${note}
      </div>
      ${adminActions}
    </div>
    ${details}
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
    renderTree();
  });

  document.querySelectorAll("#ag-filter-row .filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#ag-filter-row .filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.group = chip.dataset.group;
      renderTree();
    });
  });

  const btnNew = document.getElementById("ag-btn-new");
  if (btnNew) {
    btnNew.addEventListener("click", () => openAgencyModal(null, null));
  }
}

function renderActiveView() {
  renderTree();
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

// ══ Búsqueda mejorada ══

// Normaliza un string: minúsculas + sin acentos
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remueve diacríticos
}

// Convierte el filtro en un array de términos no vacíos (separados por espacios)
function getSearchTerms() {
  if (!filter.text) return [];
  return normalize(filter.text)
    .split(/\s+/)
    .filter(t => t.length > 0);
}

// Devuelve true si el texto contiene TODOS los términos (AND)
function matchesAllTerms(text, terms) {
  if (!terms.length) return true;
  const norm = normalize(text);
  return terms.every(t => norm.includes(t));
}

// Resalta los términos en el texto. Devuelve HTML con <mark>...</mark>
// Maneja overlapping (ej. "ana" y "an" no se duplican).
function highlight(text, terms) {
  const safeText = escapeHtml(text);
  if (!terms.length || !text) return safeText;

  // Construir array de rangos a resaltar [start, end] sobre el texto NORMALIZADO
  const norm = normalize(text);
  const ranges = [];
  terms.forEach(term => {
    if (!term) return;
    let idx = 0;
    while (true) {
      const found = norm.indexOf(term, idx);
      if (found === -1) break;
      ranges.push([found, found + term.length]);
      idx = found + term.length;
    }
  });

  if (!ranges.length) return safeText;

  // Mergear rangos solapados / adyacentes
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }

  // Reconstruir el HTML usando el TEXTO ORIGINAL (no el normalizado)
  // Las posiciones en `norm` corresponden 1:1 con las del original porque
  // normalize() solo cambia mayúsculas y diacríticos, sin alterar la longitud.
  let result = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    result += escapeHtml(text.slice(cursor, start));
    result += `<mark class="ag-hl">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}
