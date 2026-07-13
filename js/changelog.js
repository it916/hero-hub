// ═══════════════════════════════════════════
// Hero Hub · Changelog (página)
// ═══════════════════════════════════════════
// Carga data/changelog.json, renderiza la lista de entradas con filtros
// por categoría, y marca el id de la entrada más reciente como "visto"
// en users/{email}.lastChangelogSeenId para apagar el banner del index.

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const CATEGORY_LABELS = {
  feat: "Nuevo",
  fix: "Arreglo",
  refactor: "Mejora",
  style: "Diseño",
  chore: "Mantenimiento",
  docs: "Documentación"
};

const CATEGORY_ICONS = {
  feat: "sparkles",
  fix: "wrench",
  refactor: "refresh-cw",
  style: "palette",
  chore: "hammer",
  docs: "book-open"
};

let allEntries = [];
let activeCategory = "all";

// Paginación por versión: agrupamos entries por version y mostramos N versiones
// por página. Las primeras EXPANDED_VERSIONS de la primera página aparecen
// expandidas por default; el resto colapsadas (solo header visible, click para abrir).
const VERSIONS_PER_PAGE = 10;
const EXPANDED_VERSIONS = 3;
let currentPage = 1;
// Set de versiones que el usuario expandió manualmente en esta sesión.
const manuallyExpanded = new Set();

// Compara dos strings semver "vX.Y.Z" — devuelve negativo si a > b (a va antes en desc).
// Robusto ante entradas mal formadas (usa 0 como fallback para segmentos ausentes).
function compareVersionsDesc(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return nb - na; // desc: mayor primero
  }
  return 0;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return; // page-guard ya redirige

  // Esperar a que page-guard cargue el rol y valide permisos
  await window.getPageContext();

  // Avatar
  try {
    document.getElementById("user-avatar").src = await getFreshGooglePhotoURL(user);
  } catch (_) {}

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  await loadChangelog();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout")?.addEventListener("click", () =>
  signOut(auth).then(() => location.href = "index.html")
);

// Decide si una entrada del changelog es visible para el rol dado.
// audience: "all" (o ausente) → todos | "team" → admin + interno | "admin" → solo admin
function entryVisibleFor(entry, role) {
  const audience = entry.audience || "all";
  if (audience === "all") return true;
  if (audience === "admin") return role === "admin";
  if (audience === "team") return role === "admin" || role === "interno";
  return true;
}

async function loadChangelog() {
  // Obtener el rol exacto para filtrar (admin / interno / agente)
  let role = null;
  try {
    const ctx = await window.getPageContext();
    role = ctx?.userRole?.role || null;
  } catch (_) {}

  try {
    const res = await fetch("data/changelog.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    allEntries = raw.filter(e => entryVisibleFor(e, role));
  } catch (e) {
    console.error("No se pudo cargar changelog.json:", e);
    const listEl = document.getElementById("changelog-list");
    if (listEl) listEl.innerHTML =
      `<div class="changelog-empty">No pudimos cargar el historial. Recarga la página o avisa a IT.</div>`;
    return;
  }

  // Orden descendente por fecha; tiebreaker: versión semver descendente
  // (para que dentro del mismo día el v2.13.1 salga antes que v2.13.0, etc.)
  allEntries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return compareVersionsDesc(a.version, b.version);
  });

  renderEntries();
  wireFilters();
  markLatestAsSeen();
}

function renderEntries() {
  const listEl = document.getElementById("changelog-list");
  const statEl = document.getElementById("stat-entries");
  const paginatorEl = document.getElementById("changelog-paginator");
  if (!listEl) return;

  const filtered = activeCategory === "all"
    ? allEntries
    : allEntries.filter(e => e.category === activeCategory);

  if (statEl) statEl.textContent = filtered.length;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="changelog-empty">No hay entradas en esta categoría.</div>`;
    if (paginatorEl) paginatorEl.replaceChildren();
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  // Agrupar por versión para que los releases se vean juntos
  const groups = [];
  let currentVersion = null;
  filtered.forEach(entry => {
    if (entry.version !== currentVersion) {
      currentVersion = entry.version;
      groups.push({ version: currentVersion, entries: [] });
    }
    groups[groups.length - 1].entries.push(entry);
  });

  // Paginar por versión — cada página muestra hasta VERSIONS_PER_PAGE grupos.
  const totalPages = Math.max(1, Math.ceil(groups.length / VERSIONS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * VERSIONS_PER_PAGE;
  const pageGroups = groups.slice(startIdx, startIdx + VERSIONS_PER_PAGE);

  listEl.innerHTML = pageGroups.map((g, indexOnPage) => {
    // Las primeras EXPANDED_VERSIONS versiones de la primera página se
    // muestran expandidas por default. En cualquier página, si el usuario
    // clickeó manualmente el header para expandir, respetamos su decisión.
    const autoExpanded = (currentPage === 1 && indexOnPage < EXPANDED_VERSIONS);
    const isExpanded = autoExpanded || manuallyExpanded.has(g.version);
    const summary = g.entries[0]?.title || "";

    return `
    <div class="changelog-version-group ${isExpanded ? 'is-expanded' : 'is-collapsed'}" data-version="${escapeHtml(g.version)}">
      <button class="changelog-version-header" type="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="changelog-version-pill">${escapeHtml(g.version)}</span>
        <span class="changelog-version-date">${formatDate(g.entries[0].date)}</span>
        <span class="changelog-version-summary">${escapeHtml(summary)}</span>
        <i data-lucide="chevron-down" class="changelog-version-chevron"></i>
      </button>
      <div class="changelog-entries">
        ${g.entries.map(renderEntry).join("")}
      </div>
    </div>
  `;
  }).join("");

  wireVersionHeaders();
  renderPaginator(totalPages);

  if (window.refreshIcons) window.refreshIcons();
}

function renderEntry(entry) {
  const catLabel = CATEGORY_LABELS[entry.category] || entry.category;
  const catIcon = CATEGORY_ICONS[entry.category] || "circle";
  const items = (entry.items || [])
    .map(it => `<li>${escapeHtml(it)}</li>`)
    .join("");

  return `
    <article class="changelog-entry cat-${escapeHtml(entry.category)}">
      <div class="changelog-entry-head">
        <span class="changelog-cat-pill">
          <i data-lucide="${catIcon}"></i>
          <span>${escapeHtml(catLabel)}</span>
        </span>
        ${entry.scope ? `<span class="changelog-scope">${escapeHtml(entry.scope)}</span>` : ""}
        <span class="changelog-entry-date">${formatDate(entry.date)}</span>
      </div>
      <h3 class="changelog-entry-title">${escapeHtml(entry.title || "")}</h3>
      ${items ? `<ul class="changelog-entry-items">${items}</ul>` : ""}
    </article>
  `;
}

function wireVersionHeaders() {
  document.querySelectorAll(".changelog-version-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".changelog-version-group");
      if (!group) return;
      const version = group.dataset.version;
      const nowExpanded = !group.classList.contains("is-expanded");
      group.classList.toggle("is-expanded", nowExpanded);
      group.classList.toggle("is-collapsed", !nowExpanded);
      btn.setAttribute("aria-expanded", nowExpanded ? "true" : "false");
      // Persistir la decisión del usuario para esta sesión.
      if (nowExpanded) manuallyExpanded.add(version);
      else manuallyExpanded.delete(version);
    });
  });
}

function renderPaginator(totalPages) {
  const paginatorEl = document.getElementById("changelog-paginator");
  if (!paginatorEl) return;
  if (totalPages <= 1) {
    paginatorEl.replaceChildren();
    return;
  }

  const prevDisabled = currentPage === 1;
  const nextDisabled = currentPage === totalPages;

  // Ventana de páginas: hasta 5 números centrados en la actual, con ellipsis.
  const windowSize = 5;
  const halfWindow = Math.floor(windowSize / 2);
  let start = Math.max(1, currentPage - halfWindow);
  let end = Math.min(totalPages, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);

  const parts = [];
  parts.push(`<button class="changelog-page-btn" data-page="prev" ${prevDisabled ? "disabled" : ""} aria-label="Anterior"><i data-lucide="chevron-left"></i></button>`);

  if (start > 1) {
    parts.push(`<button class="changelog-page-btn" data-page="1">1</button>`);
    if (start > 2) parts.push(`<span class="changelog-page-ellipsis">…</span>`);
  }
  for (let i = start; i <= end; i++) {
    parts.push(`<button class="changelog-page-btn ${i === currentPage ? 'is-active' : ''}" data-page="${i}">${i}</button>`);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) parts.push(`<span class="changelog-page-ellipsis">…</span>`);
    parts.push(`<button class="changelog-page-btn" data-page="${totalPages}">${totalPages}</button>`);
  }

  parts.push(`<button class="changelog-page-btn" data-page="next" ${nextDisabled ? "disabled" : ""} aria-label="Siguiente"><i data-lucide="chevron-right"></i></button>`);

  paginatorEl.innerHTML = parts.join("");

  paginatorEl.querySelectorAll(".changelog-page-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const page = btn.dataset.page;
      if (page === "prev") currentPage = Math.max(1, currentPage - 1);
      else if (page === "next") currentPage = Math.min(totalPages, currentPage + 1);
      else currentPage = parseInt(page, 10);
      renderEntries();
      // Al cambiar de página, scroll suave al inicio del listado.
      document.getElementById("changelog-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function wireFilters() {
  const filterEls = document.querySelectorAll(".changelog-filter");
  filterEls.forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat || "all";
      filterEls.forEach(b => b.classList.toggle("is-active", b === btn));
      // Reset a página 1 al cambiar filtro; los grupos de la página nueva
      // pueden estar en otra posición.
      currentPage = 1;
      renderEntries();
    });
  });
}

// Guarda en Firestore el id de la entrada más reciente como "visto",
// para que el banner del index desaparezca después de entrar al changelog.
async function markLatestAsSeen() {
  if (!allEntries.length) return;
  const latestId = allEntries[0].id;

  try {
    const ctx = await window.getPageContext();
    if (!ctx?.user?.email) return;

    await setDoc(
      doc(db, "users", ctx.user.email),
      { lastChangelogSeenId: latestId },
      { merge: true }
    );
  } catch (e) {
    console.warn("No se pudo marcar el changelog como visto:", e.message);
  }
}

function formatDate(iso) {
  // iso = "YYYY-MM-DD" → "MM/DD/YYYY"
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
