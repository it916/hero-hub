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

// Tipos de planes (lista cerrada)
const PLAN_TYPES = ["MEDICARE", "ACA", "SUPLEMENTARIOS", "VIDA"];

let DATA = { hero: [], friends: [], pending: [], updatedAt: null };
let filter = { text: "", group: "all", planes: [] };
let canEdit = false;
let activeView = "list"; // "list" | "org"
let zoomLevel = 1;

// Pan state (drag para mover el canvas)
let panState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  offsetX: 0,        // offset acumulado del canvas
  offsetY: 0,
  initialOffsetX: 0, // offset al iniciar el drag actual
  initialOffsetY: 0,
  moved: false       // true si se movió más del threshold
};
const DRAG_THRESHOLD = 5; // píxeles para distinguir click de drag

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
      // Filtro por planes (AND): la agencia debe tener TODOS los planes seleccionados
      if (filter.planes.length > 0) {
        const agPlanes = ag.planes || [];
        const hasAll = filter.planes.every(p => agPlanes.includes(p));
        if (!hasAll) return;
      }

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

  // Chips de planes
  const planesChips = (ag.planes || [])
    .filter(p => PLAN_TYPES.includes(p))
    .map(p => `<span class="ag-plan-chip-mini ag-plan-${p.toLowerCase()}">${p}</span>`)
    .join("");
  const planesBlock = planesChips
    ? `<div class="ag-tree-planes">${planesChips}</div>`
    : "";

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
        ${planesBlock}
        ${note}
      </div>
      ${adminActions}
    </div>
    ${details}
  </div>`;
}

// ══════════════════════════════════════════
// VISTA ORGANIGRAMA — árbol vertical SVG
// ══════════════════════════════════════════
//
// Layout: top-down, raíz arriba, agencias hijas abajo.
// Sub-agencias (sub_goldpro) se anidan bajo su parent.
//
// Comportamiento según filter.group:
//   - "hero", "friends", "pending": muestra ese grupo
//   - "all": apila los 3 grupos verticalmente (HERO arriba, FRIENDS al medio, Pendientes abajo)

function renderOrg() {
  const canvas = document.getElementById("ag-org-canvas");

  // Determinar qué grupos renderizar
  const groupsToRender = filter.group === "all"
    ? ["hero", "friends", "pending"]
    : [filter.group];

  // Construir el HTML de cada grupo, omitiendo grupos vacíos tras filtros
  const sections = [];
  for (const group of groupsToRender) {
    const sectionHtml = buildOrgGroupSection(group);
    if (sectionHtml) sections.push(sectionHtml);
  }

  if (!sections.length) {
    canvas.innerHTML = `<p class="empty">${(filter.text || filter.planes.length) ? "Sin resultados con los filtros aplicados" : "No hay agencias todavía"}</p>`;
    applyTransform();
    return;
  }

  canvas.innerHTML = `<div class="ag-org-stack">${sections.join("")}</div>`;

  // Aplicar zoom actual
  applyTransform();

  // Wire clicks: abrir popover de brokers al hacer click en el nodo
  canvas.querySelectorAll(".ag-org-node-clickable").forEach(node => {
    node.addEventListener("click", (e) => {
      // Ignorar click si fue resultado de un drag
      if (panState.moved) return;
      const id = node.dataset.agencyId;
      const grp = node.dataset.group;
      openBrokersPopover(id, grp, node);
    });
  });

  // Wire click en los botones "X brokers directos" de cada raíz
  canvas.querySelectorAll(".ag-org-root-btn").forEach(rootBtn => {
    rootBtn.addEventListener("click", (e) => {
      // Ignorar click si fue resultado de un drag
      if (panState.moved) return;
      e.stopPropagation();
      const id = rootBtn.dataset.agencyId;
      const grp = rootBtn.dataset.group;
      openBrokersPopover(id, grp, rootBtn);
    });
  });

  // Activar pan handlers (idempotente — solo se enlaza una vez)
  setupPanHandlers();

  if (window.refreshIcons) window.refreshIcons();
}

// Construye el HTML de un grupo (HERO, FRIENDS o Pendientes) como árbol top-down.
// Devuelve string vacío si tras filtros no hay nada para mostrar.
function buildOrgGroupSection(group) {
  const allAgencies = DATA[group] || [];
  const filtered = filterAgenciesForOrg(allAgencies);
  if (!filtered.length) return "";

  const groupLabel =
    group === "hero" ? "HERO" :
    group === "friends" ? "FRIENDS" :
    "Pendientes";
  const groupSub =
    group === "hero" ? "Casa matriz" :
    group === "friends" ? "Grupo afiliado" :
    "Por aclarar / on hold";

  // Identificar matriz, agencias normales, sub-agencias
  const matrix = filtered.find(a => a.kind === "matrix");
  const subAgencies = filtered.filter(a => a.kind === "sub_goldpro");
  const mainAgencies = filtered.filter(a => a.kind !== "matrix" && a.kind !== "sub_goldpro");

  // Mapa de sub-agencias por nombre del padre
  // (Por ahora la única convención es: GOLD PRO → AP INSURANCE)
  const subsByParent = {};
  subAgencies.forEach(sub => {
    subsByParent["GOLD PRO"] = subsByParent["GOLD PRO"] || [];
    subsByParent["GOLD PRO"].push(sub);
  });

  // Si NO hay matriz pero sí hay agencias (ej. Pendientes), igual mostramos
  // una raíz visual con el nombre del grupo.
  const matrixBtnHtml = matrix
    ? `<button class="ag-org-root-btn" data-agency-id="${escapeAttr(matrix.id)}" data-group="${group}">
         <i data-lucide="users"></i>
         <span>${(matrix.brokers || []).length} brokers directos</span>
       </button>`
    : "";

  return `
    <div class="ag-org-tree" data-group="${group}">
      <div class="ag-org-root ag-org-root-${group}">
        <div class="ag-org-root-name">${escapeHtml(groupLabel)}</div>
        <div class="ag-org-root-sub">${escapeHtml(groupSub)}</div>
        ${matrixBtnHtml}
      </div>
      ${mainAgencies.length > 0 ? `<div class="ag-org-trunk"></div>` : ""}
      ${mainAgencies.length > 0 ? `<div class="ag-org-row">
        ${mainAgencies.map(ag => buildOrgNode(ag, group, subsByParent[ag.name] || [])).join("")}
      </div>` : ""}
    </div>
  `;
}

// Aplica filtro de búsqueda + planes a un array de agencias para el organigrama
function filterAgenciesForOrg(agencies) {
  const terms = getSearchTerms();

  return agencies.filter(ag => {
    // Filtro por planes
    if (filter.planes.length > 0) {
      const agPlanes = ag.planes || [];
      if (!filter.planes.every(p => agPlanes.includes(p))) return false;
    }

    // Filtro por búsqueda
    if (terms.length > 0) {
      const nameMatch = matchesAllTerms(ag.name || "", terms);
      const aicMatch = (ag.aic || []).some(n => matchesAllTerms(n, terms));
      const brokerMatch = (ag.brokers || []).some(n => matchesAllTerms(n, terms));
      if (!nameMatch && !aicMatch && !brokerMatch) return false;
    }

    return true;
  });
}

function buildOrgNode(ag, group, subAgencies) {
  const aicNames = (ag.aic || []).map(n => escapeHtml(n)).join(" · ");
  const brokerCount = (ag.brokers || []).length;

  // Tag de estado especial
  let stateTag = "";
  if (ag.kind === "info_limited") stateTag = `<span class="ag-org-tag tag-warn">Info limitada</span>`;
  else if (ag.kind === "no_data") stateTag = `<span class="ag-org-tag tag-warn">Sin datos</span>`;
  else if (ag.kind === "on_hold") stateTag = `<span class="ag-org-tag tag-hold">On hold</span>`;
  else if (ag.kind === "unclear") stateTag = `<span class="ag-org-tag tag-warn">Por aclarar</span>`;

  // Chips de planes
  const planesChips = (ag.planes || [])
    .filter(p => PLAN_TYPES.includes(p))
    .map(p => `<span class="ag-plan-chip-mini ag-plan-${p.toLowerCase()}">${p}</span>`)
    .join("");

  // Sub-agencias anidadas
  let subsBlock = "";
  if (subAgencies && subAgencies.length > 0) {
    subsBlock = `
      <div class="ag-org-sub-trunk"></div>
      <div class="ag-org-sub-row">
        ${subAgencies.map(sub => buildOrgNode(sub, group, [])).join("")}
      </div>
    `;
  }

  return `<div class="ag-org-branch">
    <div class="ag-org-node ag-org-node-clickable ag-org-node-${group} ag-org-kind-${ag.kind || "normal"}"
         data-agency-id="${escapeAttr(ag.id)}"
         data-group="${group}"
         title="Click para ver brokers">
      <div class="ag-org-node-name">${escapeHtml(ag.name || "Sin nombre")}</div>
      ${aicNames ? `<div class="ag-org-node-aic">${aicNames}</div>` : `<div class="ag-org-node-aic ag-org-no-aic">Sin AIC</div>`}
      ${stateTag ? `<div class="ag-org-node-state">${stateTag}</div>` : ""}
      ${planesChips ? `<div class="ag-org-node-planes">${planesChips}</div>` : ""}
      <div class="ag-org-node-footer">
        <span class="ag-org-broker-count">
          <i data-lucide="users"></i>
          <strong>${brokerCount}</strong> ${brokerCount === 1 ? "broker" : "brokers"}
        </span>
      </div>
    </div>
    ${subsBlock}
  </div>`;
}

// ══ Popover de brokers ══

function openBrokersPopover(agencyId, group, anchorEl) {
  // Cerrar popover existente
  closeBrokersPopover();

  const agency = findAgency(agencyId, group);
  if (!agency) return;

  const brokers = agency.brokers || [];
  const aic = agency.aic || [];
  const planes = agency.planes || [];

  // Crear popover
  const popover = document.createElement("div");
  popover.className = "ag-popover";
  popover.id = "ag-popover";

  // Construir contenido
  const aicHtml = aic.length > 0
    ? `<div class="ag-popover-section">
         <div class="ag-popover-label">${aic.length === 1 ? "Agente a cargo" : "Agentes a cargo"}</div>
         ${aic.map(n => `
           <div class="ag-popover-aic">
             <div class="ag-avatar ag-avatar-aic">${getInitials(n)}</div>
             <span>${escapeHtml(n)}</span>
           </div>
         `).join("")}
       </div>`
    : `<div class="ag-popover-section">
         <div class="ag-popover-empty">Sin AIC asignado</div>
       </div>`;

  const planesHtml = planes.length > 0
    ? `<div class="ag-popover-section">
         <div class="ag-popover-label">Planes</div>
         <div class="ag-popover-planes">
           ${planes.filter(p => PLAN_TYPES.includes(p)).map(p =>
             `<span class="ag-plan-chip-mini ag-plan-${p.toLowerCase()}">${p}</span>`
           ).join("")}
         </div>
       </div>`
    : "";

  const brokersHtml = brokers.length > 0
    ? `<div class="ag-popover-section">
         <div class="ag-popover-label">${brokers.length} ${brokers.length === 1 ? "broker" : "brokers"}</div>
         <ol class="ag-popover-brokers">
           ${brokers.map(n => `<li>${escapeHtml(n)}</li>`).join("")}
         </ol>
       </div>`
    : `<div class="ag-popover-section">
         <div class="ag-popover-empty">Sin brokers todavía</div>
       </div>`;

  popover.innerHTML = `
    <div class="ag-popover-arrow"></div>
    <div class="ag-popover-header">
      <div class="ag-popover-title">${escapeHtml(agency.name)}</div>
      <button class="ag-popover-close" id="ag-popover-close" title="Cerrar">
        <i data-lucide="x"></i>
      </button>
    </div>
    <div class="ag-popover-body">
      ${aicHtml}
      ${planesHtml}
      ${brokersHtml}
    </div>
  `;

  document.body.appendChild(popover);

  // Posicionar popover anclado al nodo
  positionPopover(popover, anchorEl);

  // Wire close
  popover.querySelector("#ag-popover-close").addEventListener("click", closeBrokersPopover);

  // Cerrar al hacer click fuera
  setTimeout(() => {
    document.addEventListener("click", closePopoverOnOutsideClick);
  }, 0);

  // Cerrar con Escape
  document.addEventListener("keydown", closePopoverOnEsc);

  if (window.refreshIcons) window.refreshIcons();
}

function positionPopover(popover, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const margin = 12;

  // Por defecto: a la derecha del anchor
  let top = rect.top + window.scrollY;
  let left = rect.right + margin + window.scrollX;
  let placement = "right";

  // Si no cabe a la derecha, ponerlo abajo
  if (left + popRect.width > window.innerWidth - 16) {
    left = rect.left + window.scrollX;
    top = rect.bottom + margin + window.scrollY;
    placement = "bottom";

    // Ajustar horizontal si se sale por la derecha
    if (left + popRect.width > window.innerWidth - 16) {
      left = window.innerWidth - popRect.width - 16 + window.scrollX;
    }
  }

  // Ajuste vertical si se sale por debajo
  if (top + popRect.height > window.innerHeight + window.scrollY - 16) {
    top = window.innerHeight + window.scrollY - popRect.height - 16;
  }

  // Asegurar no salir por arriba
  if (top < window.scrollY + 16) {
    top = window.scrollY + 16;
  }

  popover.style.top = top + "px";
  popover.style.left = left + "px";
  popover.dataset.placement = placement;
}

function closeBrokersPopover() {
  const existing = document.getElementById("ag-popover");
  if (existing) existing.remove();
  document.removeEventListener("click", closePopoverOnOutsideClick);
  document.removeEventListener("keydown", closePopoverOnEsc);
}

function closePopoverOnOutsideClick(e) {
  const popover = document.getElementById("ag-popover");
  if (!popover) return;
  if (popover.contains(e.target)) return;
  if (e.target.closest(".ag-org-node-clickable")) return; // dejar que el nuevo se abra
  if (e.target.closest(".ag-org-root-btn")) return;
  closeBrokersPopover();
}

function closePopoverOnEsc(e) {
  if (e.key === "Escape") closeBrokersPopover();
}

// ══ Zoom + Pan controls ══

function applyTransform() {
  const canvas = document.getElementById("ag-org-canvas");
  if (!canvas) return;
  // Combinar pan + zoom en un solo transform
  canvas.style.transform = `translate(${panState.offsetX}px, ${panState.offsetY}px) scale(${zoomLevel})`;
  canvas.style.transformOrigin = "top center";
  const lvlEl = document.getElementById("ag-zoom-level");
  if (lvlEl) lvlEl.textContent = Math.round(zoomLevel * 100) + "%";
}

// Backwards-compat: algunas partes llaman applyZoom()
function applyZoom() { applyTransform(); }

function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.1, 2.0);
  applyTransform();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.1, 0.4);
  applyTransform();
}

function zoomFit() {
  const canvas = document.getElementById("ag-org-canvas");
  const wrap = document.getElementById("ag-org-canvas-wrap");
  if (!canvas || !wrap) return;
  // Resetear pan + zoom para medir naturalmente
  panState.offsetX = 0;
  panState.offsetY = 0;
  canvas.style.transform = "scale(1)";
  const naturalWidth = canvas.scrollWidth;
  const wrapWidth = wrap.clientWidth - 32;
  if (naturalWidth > wrapWidth) {
    zoomLevel = Math.max(0.4, wrapWidth / naturalWidth);
  } else {
    zoomLevel = 1;
  }
  applyTransform();
}

// ══ Pan (click + drag para mover el canvas) ══

function setupPanHandlers() {
  const wrap = document.getElementById("ag-org-canvas-wrap");
  if (!wrap || wrap.dataset.panBound) return;
  wrap.dataset.panBound = "1";

  wrap.addEventListener("mousedown", onPanStart);
  wrap.addEventListener("touchstart", onPanStart, { passive: true });

  // Los listeners de move/end van a document para capturar movimientos
  // que salen del wrap mientras se arrastra
  document.addEventListener("mousemove", onPanMove);
  document.addEventListener("mouseup", onPanEnd);
  document.addEventListener("touchmove", onPanMove, { passive: false });
  document.addEventListener("touchend", onPanEnd);

  // Cursor inicial
  wrap.style.cursor = "grab";
}

function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function onPanStart(e) {
  // No iniciar pan si el target es un nodo o un botón clickeable
  // (los nodos manejan su propio click via los handlers en buildOrgNode)
  if (e.target.closest(".ag-org-controls")) return;

  const wrap = document.getElementById("ag-org-canvas-wrap");
  if (!wrap) return;

  const coords = getEventCoords(e);
  panState.isDragging = true;
  panState.moved = false;
  panState.startX = coords.x;
  panState.startY = coords.y;
  panState.initialOffsetX = panState.offsetX;
  panState.initialOffsetY = panState.offsetY;

  wrap.style.cursor = "grabbing";
  wrap.dataset.dragging = "1";

  // Prevenir text selection durante el drag
  document.body.style.userSelect = "none";
}

function onPanMove(e) {
  if (!panState.isDragging) return;

  const coords = getEventCoords(e);
  const dx = coords.x - panState.startX;
  const dy = coords.y - panState.startY;

  // Detectar si superó el threshold
  if (!panState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    panState.moved = true;
  }

  if (panState.moved) {
    // Si es touch, prevenir scroll de la página
    if (e.cancelable && e.touches) e.preventDefault();

    panState.offsetX = panState.initialOffsetX + dx;
    panState.offsetY = panState.initialOffsetY + dy;
    applyTransform();
  }
}

function onPanEnd(e) {
  if (!panState.isDragging) return;
  panState.isDragging = false;

  const wrap = document.getElementById("ag-org-canvas-wrap");
  if (wrap) {
    wrap.style.cursor = "grab";
    delete wrap.dataset.dragging;
  }

  document.body.style.userSelect = "";

  // Si se movió, prevenir el click subsiguiente sobre nodos
  // (el nodo escucha "click", y el click se dispara DESPUÉS del mouseup
  // si no hubo movimiento significativo. Si sí hubo, marcamos el flag
  // para que el handler del nodo lo ignore.)
  if (panState.moved) {
    // Pequeño truco: el handler de los nodos verifica panState.moved
    // y limpia el flag tras ignorar el click
    setTimeout(() => { panState.moved = false; }, 50);
  }
}

// Reset del pan al cambiar de vista o de filtros
function resetPan() {
  panState.offsetX = 0;
  panState.offsetY = 0;
  applyTransform();
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

        <div class="ag-form-field">
          <span class="ag-form-label">Planes que vende</span>
          <div class="ag-form-planes-grid">
            ${PLAN_TYPES.map(p => {
              const checked = (agency.planes || []).includes(p) ? "checked" : "";
              return `<label class="ag-form-plane-check">
                <input type="checkbox" name="ag-f-plane" value="${p}" ${checked}>
                <span class="ag-plan-chip-mini ag-plan-${p.toLowerCase()}">${p}</span>
              </label>`;
            }).join("")}
          </div>
        </div>

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
    const planes = Array.from(overlay.querySelectorAll('input[name="ag-f-plane"]:checked'))
      .map(inp => inp.value);

    if (!name) {
      alert("El nombre es obligatorio.");
      return;
    }

    const saveBtn = overlay.querySelector("#ag-modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";

    try {
      if (isNew) {
        await createAgency({ name, kind, aic, brokers, planes, group: newGroup });
      } else {
        await updateAgency(agencyId, originalGroup, { name, kind, aic, brokers, planes, group: newGroup });
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
    brokers: input.brokers || [],
    planes: input.planes || []
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
    brokerCount: newAg.brokers.length,
    planes: newAg.planes.join(", ") || "(ninguno)"
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
    brokers: input.brokers || [],
    planes: input.planes || []
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
  const oldPlanes = (original.planes || []).slice().sort().join("|");
  const newPlanes = (updated.planes || []).slice().sort().join("|");
  if (oldPlanes !== newPlanes) {
    changes.push(`planes: [${(original.planes || []).join(", ") || "—"}] → [${(updated.planes || []).join(", ") || "—"}]`);
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

  // Filtro por planes (multi-select AND)
  document.querySelectorAll(".ag-plan-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const plan = chip.dataset.plan;
      const idx = filter.planes.indexOf(plan);
      if (idx === -1) {
        filter.planes.push(plan);
        chip.classList.add("active");
      } else {
        filter.planes.splice(idx, 1);
        chip.classList.remove("active");
      }
      // Mostrar/ocultar botón "Limpiar"
      const clearBtn = document.getElementById("ag-plan-clear");
      if (clearBtn) clearBtn.style.display = filter.planes.length > 0 ? "inline-flex" : "none";
      renderActiveView();
    });
  });

  const clearBtn = document.getElementById("ag-plan-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      filter.planes = [];
      document.querySelectorAll(".ag-plan-chip").forEach(c => c.classList.remove("active"));
      clearBtn.style.display = "none";
      renderActiveView();
    });
  }

  // Toggle de vistas List / Org
  document.querySelectorAll(".ag-view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ag-view-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeView = tab.dataset.view;
      const list = document.getElementById("ag-view-list");
      const org = document.getElementById("ag-view-org");
      if (activeView === "list") {
        list.style.display = "block";
        org.style.display = "none";
      } else {
        list.style.display = "none";
        org.style.display = "block";
        // Reset pan al entrar a org (evita aparecer panneado)
        resetPan();
      }
      renderActiveView();
    });
  });

  // Zoom controls
  const zIn = document.getElementById("ag-zoom-in");
  const zOut = document.getElementById("ag-zoom-out");
  const zFit = document.getElementById("ag-zoom-fit");
  if (zIn) zIn.addEventListener("click", zoomIn);
  if (zOut) zOut.addEventListener("click", zoomOut);
  if (zFit) zFit.addEventListener("click", zoomFit);

  const btnNew = document.getElementById("ag-btn-new");
  if (btnNew) {
    btnNew.addEventListener("click", () => openAgencyModal(null, null));
  }
}

function renderActiveView() {
  if (activeView === "list") {
    renderTree();
  } else {
    renderOrg();
  }
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
