// ═══════════════════════════════════════════
// Hero Hub · Contracting con Carriers (A–L)
// ═══════════════════════════════════════════
// Página de prueba: consume data/contracting.json (adaptado desde el
// sitio de Applied General Agency a los flujos de Hero) y renderiza
// los carriers seleccionados. Soporta toggle ES/EN con preferencia
// persistente en localStorage["ctr-lang"] (default: es).
//
// El auth y el rol los maneja page-guard.js.

import { getFreshGooglePhotoURL } from "./user-photo.js";

// ─── i18n: textos de la UI ──────────────────────────────────────
const UI = {
  es: {
    kicker: "• Prueba interna · Adaptado a Hero •",
    title: "Contracting con Carriers (A–L)",
    subtitle: "Procedimientos por carrier — contracting, transfers, EFT changes, demographic y más",
    sidebarTitle: "Carriers",
    loadingNav: "Cargando…",
    loadingContent: "Cargando procedimientos…",
    subsectionsLabel: (n) => `${n} sub-secciones`,
    empty: "No hay carriers para mostrar.",
    fetchError: "No se pudo cargar la data de contracting",
    disclaimer: `<strong>Contenido adaptado.</strong> Estos procedimientos se basaron en la guía pública de <a href="https://appliedga.com/medicare-insurance-agents-resources/contracting-information-a-l/" target="_blank" rel="noopener">Applied General Agency</a> y se adaptaron al flujo de Hero (contactos, emails y referencias corporativas). Para iniciar cualquier proceso de contracting, contacta a <strong>María Lo Monaco</strong> a <a href="mailto:contractingsupport@heroinsuranceusa.com">contractingsupport@heroinsuranceusa.com</a>. Esta página es una <strong>prueba</strong> con 4 carriers de muestra.`
  },
  en: {
    kicker: "• Internal test · Adapted to Hero •",
    title: "Carrier Contracting Guide (A–L)",
    subtitle: "Step-by-step procedures per carrier — contracting, transfers, EFT changes, demographics and more",
    sidebarTitle: "Carriers",
    loadingNav: "Loading…",
    loadingContent: "Loading procedures…",
    subsectionsLabel: (n) => `${n} sub-sections`,
    empty: "No carriers to show.",
    fetchError: "Could not load contracting data",
    disclaimer: `<strong>Adapted content.</strong> These procedures are based on the public guide from <a href="https://appliedga.com/medicare-insurance-agents-resources/contracting-information-a-l/" target="_blank" rel="noopener">Applied General Agency</a> and were adapted to Hero's flow (contacts, emails and corporate references). To begin any contracting process, contact <strong>María Lo Monaco</strong> at <a href="mailto:contractingsupport@heroinsuranceusa.com">contractingsupport@heroinsuranceusa.com</a>. This is a <strong>test</strong> page with 4 sample carriers.`
  }
};

// Estado
let allData = null;
let currentLang = "es";

// ─── Bootstrap ──────────────────────────────────────────────────
async function boot() {
  const ctx = await window.getPageContext();
  const { user } = ctx;

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.body.classList.remove("skip-loading");

  const photo = await getFreshGooglePhotoURL(user);
  const avatarEl = document.getElementById("user-avatar");
  if (avatarEl) avatarEl.src = photo;
  const menuAvatarEl = document.getElementById("user-menu-avatar");
  if (menuAvatarEl) menuAvatarEl.src = photo;

  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    signOut(getAuth()).then(() => location.href = "index.html");
  });

  // Restaurar idioma preferido
  try {
    const saved = localStorage.getItem("ctr-lang");
    if (saved === "en" || saved === "es") currentLang = saved;
  } catch (_) {}

  wireLangToggle();
  await loadContracting();

  if (window.refreshIcons) window.refreshIcons();
}

// ─── Toggle ES/EN ───────────────────────────────────────────────
function wireLangToggle() {
  document.querySelectorAll(".ctr-lang-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      if (lang === currentLang) return;
      currentLang = lang;
      try { localStorage.setItem("ctr-lang", lang); } catch (_) {}
      applyLangToButtons();
      applyUITexts();
      if (allData) {
        renderNav(document.getElementById("ctr-nav"), allData);
        renderContent(document.getElementById("ctr-content"), allData);
      }
    });
  });
  applyLangToButtons();
  applyUITexts();
}

function applyLangToButtons() {
  document.querySelectorAll(".ctr-lang-btn").forEach(btn => {
    const active = btn.dataset.lang === currentLang;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  document.documentElement.lang = currentLang;
}

function applyUITexts() {
  const t = UI[currentLang];
  document.getElementById("ctr-kicker").textContent = t.kicker;
  document.getElementById("ctr-title").textContent = t.title;
  document.getElementById("ctr-subtitle").textContent = t.subtitle;
  document.getElementById("ctr-sidebar-title").textContent = t.sidebarTitle;
  document.getElementById("ctr-disclaimer-text").innerHTML = t.disclaimer;
  const navLoading = document.getElementById("ctr-nav-loading");
  if (navLoading) navLoading.textContent = t.loadingNav;
  const contentLoading = document.getElementById("ctr-content-loading");
  if (contentLoading) contentLoading.textContent = t.loadingContent;
  document.title = `${t.title} — Hero Hub`;
}

// ─── Fetch + render ─────────────────────────────────────────────
async function loadContracting() {
  const nav = document.getElementById("ctr-nav");
  const content = document.getElementById("ctr-content");
  try {
    const resp = await fetch("data/contracting.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    allData = await resp.json();
    renderNav(nav, allData);
    renderContent(content, allData);
    wireScrollSpy(nav);
  } catch (e) {
    console.error("[contracting] Error cargando data:", e);
    const t = UI[currentLang];
    content.innerHTML = `<p class="ctr-empty">${t.fetchError}: ${escapeHtml(e.message)}</p>`;
    nav.innerHTML = "";
  }
}

function renderNav(nav, carriers) {
  const lang = currentLang;
  nav.innerHTML = carriers.map(c => `
    <a href="#carrier-${c.slug}" class="ctr-nav-link" data-carrier="${c.slug}">
      <span class="ctr-nav-dot"></span>
      ${escapeHtml(c.title[lang])}
    </a>
  `).join("");
}

function renderContent(content, carriers) {
  const t = UI[currentLang];
  const lang = currentLang;
  if (!carriers.length) {
    content.innerHTML = `<p class="ctr-empty">${t.empty}</p>`;
    return;
  }
  content.innerHTML = carriers.map(c => `
    <section id="carrier-${c.slug}" class="ctr-carrier" data-carrier="${c.slug}">
      <header class="ctr-carrier-header">
        <h2 class="ctr-carrier-title">${escapeHtml(c.title[lang])}</h2>
        <div class="ctr-carrier-meta">${t.subsectionsLabel(c.sections.length)}</div>
      </header>
      <div class="ctr-subs">
        ${c.sections.map((s, i) => `
          <details class="ctr-sub" ${i === 0 ? "open" : ""}>
            <summary class="ctr-sub-summary">
              <span class="ctr-sub-title">${escapeHtml(s.title[lang])}</span>
              <i data-lucide="chevron-down" class="ctr-sub-chevron"></i>
            </summary>
            <div class="ctr-sub-body">${s.html[lang]}</div>
          </details>
        `).join("")}
      </div>
    </section>
  `).join("");
  if (window.refreshIcons) window.refreshIcons();
}

// Scroll spy: marca el link activo en el sidebar según el carrier visible.
function wireScrollSpy(nav) {
  const sections = document.querySelectorAll(".ctr-carrier");
  const links = new Map();
  nav.querySelectorAll(".ctr-nav-link").forEach(a => {
    links.set(a.dataset.carrier, a);
  });
  if (!sections.length || !links.size) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const slug = entry.target.dataset.carrier;
        links.forEach(a => a.classList.remove("is-active"));
        links.get(slug)?.classList.add("is-active");
      }
    });
  }, {
    rootMargin: "-20% 0px -60% 0px",
    threshold: 0
  });

  sections.forEach(s => observer.observe(s));
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

boot();
