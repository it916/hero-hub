// ═══════════════════════════════════════════
// Hero Hub · Organigrama de Agencias
// ═══════════════════════════════════════════
// Lee shared/agencias de Firestore y renderiza dos vistas:
//   - Cards: grid de agencias con AIC + brokers
//   - Tree:  jerarquía visual HERO → agencias → personas

import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

let DATA = { hero: [], friends: [], pending: [], updatedAt: null };
let filter = { text: "", group: "all" };

// ══ Auth flow (mismo patrón que las demás páginas) ══
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

  // Esperar a que page-guard cargue el rol
  await window.getPageContext();

  document.getElementById("user-avatar").src = user.photoURL || "";
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

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
    renderCards();
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

  // Fecha de actualización
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
  if (window.refreshIcons) window.refreshIcons();
}

function buildAgencyCard(ag) {
  const groupClass = `ag-group-${ag._group}`;
  const kindClass = `ag-kind-${ag.kind || "normal"}`;

  // Badges
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

  // AICs
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

  // Brokers
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

  // Nota especial
  let note = "";
  if (ag.kind === "info_limited") {
    note = `<div class="ag-note"><i data-lucide="info"></i> Información limitada disponible</div>`;
  } else if (ag.kind === "no_data") {
    note = `<div class="ag-note"><i data-lucide="alert-circle"></i> Sin información detallada</div>`;
  } else if (ag.kind === "on_hold") {
    note = `<div class="ag-note"><i data-lucide="pause-circle"></i> Estado en pausa</div>`;
  }

  return `
    <div class="ag-card ${groupClass} ${kindClass}">
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

// ══ Vista TREE (jerarquía) ══
function renderTree() {
  const container = document.getElementById("ag-tree");
  const filtered = getFilteredAgencies();

  if (!filtered.length) {
    container.innerHTML = `<p class="empty">${filter.text ? "Sin resultados" : "No hay agencias todavía"}</p>`;
    return;
  }

  // Agrupar por grupo de raíz
  const byGroup = { hero: [], friends: [], pending: [] };
  filtered.forEach(ag => byGroup[ag._group].push(ag));

  let html = "";

  // Bloque HERO
  if (byGroup.hero.length) {
    const heroMatrix = byGroup.hero.find(a => a.kind === "matrix");
    const heroAgencies = byGroup.hero.filter(a => a.kind !== "matrix" && a.kind !== "sub_goldpro");
    const subGoldpro = byGroup.hero.find(a => a.kind === "sub_goldpro");
    const goldPro = byGroup.hero.find(a => a.name === "GOLD PRO");

    html += `<div class="ag-tree-group ag-tree-hero">
      <div class="ag-tree-root">
        <div class="ag-tree-root-name">HERO</div>
        <div class="ag-tree-root-sub">Casa matriz</div>
      </div>
      <div class="ag-tree-children">`;

    if (heroMatrix) {
      html += buildTreeNode(heroMatrix, "Brokers directos");
    }

    heroAgencies.forEach(ag => {
      html += buildTreeNode(ag);
      // Si esta es GOLD PRO, anidar la sub
      if (ag.name === "GOLD PRO" && subGoldpro) {
        html += `<div class="ag-tree-sub-wrap">${buildTreeNode(subGoldpro, "Sub-agencia")}</div>`;
      }
    });

    html += `</div></div>`;
  }

  // Bloque FRIENDS
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

  // Bloque PENDING
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

// ══ Event handlers ══
function wireHandlers() {
  // Búsqueda
  const searchInp = document.getElementById("ag-search");
  searchInp.addEventListener("input", (e) => {
    filter.text = e.target.value.toLowerCase().trim();
    renderActiveView();
  });

  // Filtros por grupo
  document.querySelectorAll("#ag-filter-row .filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#ag-filter-row .filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.group = chip.dataset.group;
      renderActiveView();
    });
  });

  // Tabs de vista
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
}

function renderActiveView() {
  const cardsActive = document.querySelector(".ag-view-tab[data-view='cards']").classList.contains("active");
  if (cardsActive) renderCards();
  else renderTree();
}

// ══ Helpers ══
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
