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

  // Asegurar orden descendente por fecha (la más reciente arriba)
  allEntries.sort((a, b) => (a.date < b.date ? 1 : -1));

  renderEntries();
  wireFilters();
  markLatestAsSeen();
}

function renderEntries() {
  const listEl = document.getElementById("changelog-list");
  const statEl = document.getElementById("stat-entries");
  if (!listEl) return;

  const filtered = activeCategory === "all"
    ? allEntries
    : allEntries.filter(e => e.category === activeCategory);

  if (statEl) statEl.textContent = filtered.length;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="changelog-empty">No hay entradas en esta categoría.</div>`;
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

  listEl.innerHTML = groups.map(g => `
    <div class="changelog-version-group">
      <div class="changelog-version-header">
        <span class="changelog-version-pill">${escapeHtml(g.version)}</span>
        <span class="changelog-version-date">${formatDate(g.entries[0].date)}</span>
      </div>
      <div class="changelog-entries">
        ${g.entries.map(renderEntry).join("")}
      </div>
    </div>
  `).join("");

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

function wireFilters() {
  const filterEls = document.querySelectorAll(".changelog-filter");
  filterEls.forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat || "all";
      filterEls.forEach(b => b.classList.toggle("is-active", b === btn));
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
