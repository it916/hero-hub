import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
// ADMIN_EMAILS eliminado: ahora usamos el sistema de roles desde roles.js

const FLAGS_EMOJI = {
  'venezuela':'🇻🇪',
  'cuba':'🇨🇺',
  'colombia':'🇨🇴',
  'chile':'🇨🇱',
  'honduras':'🇭🇳',
  'estados unidos':'🇺🇸',
  'eeuu':'🇺🇸',
  'us':'🇺🇸',
};
const FLAGS = {
  'venezuela':'https://flagicons.lipis.dev/flags/4x3/ve.svg',
  'cuba':'https://flagicons.lipis.dev/flags/4x3/cu.svg',
  'colombia':'https://flagicons.lipis.dev/flags/4x3/co.svg',
  'chile':'https://flagicons.lipis.dev/flags/4x3/cl.svg',
  'honduras':'https://flagicons.lipis.dev/flags/4x3/hn.svg',
  'estados unidos':'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'eeuu':'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'us':'https://flagicons.lipis.dev/flags/4x3/us.svg',
};
const getFlag = (c) => c ? (FLAGS[c.toLowerCase().trim()] || null) : null;
const getFlagEmoji = (c) => c ? (FLAGS_EMOJI[c.toLowerCase().trim()] || '') : '';

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

// Personas que NO deben aparecer en la vista del equipo. Filtra al cargar; no toca Firestore.
const EXCLUDED_NAMES = ['Luis Ernesto Gutiérrez'];
const normName = s => (s || '').toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Paises sugeridos en el <datalist> del modal de miembro. No es exhaustiva,
// pero cubre los origenes actuales del equipo + resto de LatAm + España/US.
const COUNTRIES_SUGGESTED = [
  "Venezuela", "Cuba", "Colombia", "Chile", "Honduras", "Estados Unidos",
  "Argentina", "México", "España", "Perú", "Ecuador", "Uruguay",
  "Costa Rica", "Panamá", "República Dominicana", "Guatemala", "Nicaragua",
  "El Salvador", "Bolivia", "Paraguay", "Puerto Rico", "Brasil"
];

// ═══════════════════════════════════════════
// Uploader de foto → GitHub API
// ═══════════════════════════════════════════
// El token vive en Firestore (shared/config.githubToken), leible solo por
// it@heroinsuranceusa.com (regla Firestore). Sube la foto al repo, hace
// commit, y devuelve el path relativo con cache-buster.
const GH_REPO_OWNER = "it916";
const GH_REPO_NAME = "hero-hub";

function slugifyName(name) {
  const clean = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quitar acentos
    .replace(/[^a-z0-9\s]/g, "") // solo letras/digitos/espacios
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "miembro-" + Date.now();
  if (parts.length === 1) return parts[0];
  // Convención del proyecto: primer nombre + segunda palabra del nombre
  // completo (que en LatAm suele ser el primer apellido para nombres cortos,
  // o segundo nombre para nombres compuestos — no es perfecto pero coincide
  // con las 17 fotos actuales).
  return `${parts[0]}-${parts[1]}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // dataURL viene como "data:image/jpeg;base64,XXXX"; nos quedamos con XXXX.
      const result = reader.result.split(",")[1];
      resolve(result);
    };
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

  // 1) Si el archivo ya existe, GitHub exige el SHA para hacer overwrite.
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

  // 2) Encode + PUT
  const base64 = await fileToBase64(file);
  const body = {
    message: `feat(equipo): foto de ${slug}`,
    content: base64,
    branch: "main",
  };
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

  // 3) Cache-buster para que el navegador cargue la nueva foto tras redeploy.
  return `${path}?v=${Date.now()}`;
}

// ═══ GENERADOR DE BIOS HEROICAS GENÉRICAS ═══
function generateHeroicBio(person) {
  const role = (person.role || '').toLowerCase();
  const country = person.country || 'tierras lejanas';

  // Identidad secreta (basada en el rol)
  let identidad = person.role || 'Héroe del equipo';

  // Superpoder según el rol
  let superpoder = "Aportando su energía única al equipo Hero";
  if (role.includes('ceo') || role.includes('director')) superpoder = "Visión estratégica y liderazgo heroico";
  else if (role.includes('coo') || role.includes('operation')) superpoder = "Orquestando operaciones imposibles con precisión";
  else if (role.includes('cfo') || role.includes('finance') || role.includes('finanzas')) superpoder = "Guardián del balance entre la misión y los números";
  else if (role.includes('hr') || role.includes('human') || role.includes('talent')) superpoder = "Descubriendo el héroe que hay en cada persona";
  else if (role.includes('it') || role.includes('tech') || role.includes('system')) superpoder = "Construyendo la tecnología que mantiene a Hero volando";
  else if (role.includes('sales') || role.includes('venta')) superpoder = "Convirtiendo cada llamada en una vida protegida";
  else if (role.includes('marketing')) superpoder = "Llevando el mensaje Hero a cada rincón del mercado";
  else if (role.includes('design') || role.includes('diseño') || role.includes('creative')) superpoder = "Dándole forma visual al universo Hero";
  else if (role.includes('legal') || role.includes('compliance')) superpoder = "Protegiendo a Hero con la fuerza de la ley";
  else if (role.includes('office manager') || role.includes('admin')) superpoder = "Manteniendo el cuartel general en perfecto orden";
  else if (role.includes('recruit')) superpoder = "Encontrando al próximo héroe para el equipo";
  else if (role.includes('support') || role.includes('customer')) superpoder = "Resolviendo lo imposible, una persona a la vez";
  else if (role.includes('manager') || role.includes('lead')) superpoder = "Guiando al equipo con mano firme hacia la victoria";
  else if (role.includes('agent') || role.includes('agente')) superpoder = "Conectando familias con la protección que necesitan";
  else if (role.includes('broker')) superpoder = "Tejiendo relaciones que transforman el mercado";
  else if (role.includes('coach') || role.includes('training')) superpoder = "Desbloqueando el potencial máximo de cada héroe";
  else if (role.includes('analyst') || role.includes('data')) superpoder = "Transformando datos en decisiones heroicas";

  // Formación genérica
  let formacion = "Profesional con experiencia en su área";
  if (role.includes('ceo') || role.includes('director')) formacion = "Liderazgo ejecutivo y estrategia empresarial";
  else if (role.includes('finance') || role.includes('cfo')) formacion = "Contaduría, Finanzas o áreas afines";
  else if (role.includes('it') || role.includes('tech')) formacion = "Ingeniería de Sistemas o Tecnología";
  else if (role.includes('sales') || role.includes('venta') || role.includes('broker')) formacion = "Ventas, Mercadeo o Administración";
  else if (role.includes('marketing') || role.includes('design')) formacion = "Comunicación, Diseño o Mercadeo";
  else if (role.includes('legal')) formacion = "Derecho o áreas regulatorias";
  else if (role.includes('hr') || role.includes('human')) formacion = "Psicología, Recursos Humanos o Administración";

  // Origen
  let origen = country;
  const flagEmoji = getFlagEmoji(country);
  if (flagEmoji) origen = `${flagEmoji} ${country}`;

  // Frase icónica (rotativa según rol)
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
  const idx = (person.name || '').charCodeAt(0) % frasesHeroicas.length;
  const frase = frasesHeroicas[idx] || frasesHeroicas[0];

  return {
    identidad,
    origen,
    formacion,
    superpoder,
    frase,
    union: "Parte esencial del equipo Hero"
  };
}

const ICONS = {
  email: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2"/><path d="M22 6l-10 7L2 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5.09 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 5 5l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="2"/></svg>`,
  cake: `<svg viewBox="0 0 24 24" fill="none"><path d="M20 21v-8H4v8M2 21h20M12 3v4M8 7h8a4 4 0 014 4v2H4v-2a4 4 0 014-4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

let members = [];
let isAdmin = false;
let filter = "";
let currentProfileIdx = null;

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

  // Esperar a que page-guard cargue el rol del usuario
  const ctx = await window.getPageContext();
  isAdmin = isAdminRole(ctx.userRole);

  document.getElementById("user-avatar").src = await getFreshGooglePhotoURL(user);
  if (isAdmin) {
    document.getElementById("btn-add-member").style.display = "inline-flex";
    document.getElementById("hp-edit-btn").classList.add("visible");
  }
  // El botón btn-admin ya fue manejado por page-guard.js (filterTopbarByRole)
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  await loadTeam();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth).then(() => location.href = "index.html"));

async function loadTeam() {
  try {
    const snap = await getDoc(doc(db, "shared", "team"));
    if (snap.exists() && Array.isArray(snap.data().members)) {
      const excluded = new Set(EXCLUDED_NAMES.map(normName));
      members = snap.data().members.filter(m => !excluded.has(normName(m.name)));
    } else {
      members = [];
      document.getElementById("team-grid").innerHTML = '<p class="empty">Aún no se ha cargado el equipo.</p>';
      return;
    }
    renderGrid();
  } catch (e) {
    console.error(e);
    document.getElementById("team-grid").innerHTML = `<p class="empty">Error: ${e.message}</p>`;
  }
}

function wireHandlers() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    filter = e.target.value.toLowerCase().trim();
    renderGrid();
  });
  document.getElementById("btn-add-member").addEventListener("click", () => openMemberModal(null));

  // Cerrar perfil
  document.getElementById("hp-close").addEventListener("click", closeProfile);
  document.getElementById("hero-profile").addEventListener("click", (e) => {
    if (e.target.id === "hero-profile") closeProfile();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProfile();
  });

  // Admin: editar miembro (modal unificado: datos generales + ficha del heroe).
  // El perfil grande queda abierto por detras del modal; openMemberModal
  // detecta que veniamos del perfil (mediante currentProfileIdx) y refresca
  // el perfil despues del save para reflejar los cambios.
  document.getElementById("hp-edit-btn").addEventListener("click", () => {
    if (currentProfileIdx !== null) openMemberModal(currentProfileIdx);
  });
}

function renderGrid() {
  const grid = document.getElementById("team-grid");
  const filtered = filter
    ? members.filter(m => (m.name || '').toLowerCase().includes(filter) || (m.role || '').toLowerCase().includes(filter))
    : members;
  document.getElementById("team-count-num").textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="team-empty">
        <div class="team-empty-icon"><i data-lucide="${filter ? 'search-x' : 'users'}"></i></div>
        <div class="team-empty-title">${filter ? 'Sin resultados' : 'Aún no hay miembros'}</div>
        <div class="team-empty-desc">${filter ? `No encontramos héroes con <strong>"${filter}"</strong>.` : 'Cuando un admin agregue al equipo, aparecerán aquí.'}</div>
      </div>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }
  grid.innerHTML = '';
  filtered.forEach((m, i) => grid.appendChild(buildCard(m, i)));
  if (window.refreshIcons) window.refreshIcons();
}

function buildCard(person, idx) {
  const realIdx = members.indexOf(person);
  const flag = getFlag(person.country);

  const card = document.createElement('div');
  card.className = 'team-card card-outer';
  card.style.animationDelay = `${Math.min(idx, 19) * 0.03}s`;
  card.setAttribute('tabindex', '0');
  card.dataset.idx = realIdx;

  const adminActions = isAdmin ? `
    <div class="card-admin-actions">
      <button class="card-adm-btn edit" data-idx="${realIdx}" title="Editar miembro"><i data-lucide="edit-3"></i></button>
      <button class="card-adm-btn del" data-idx="${realIdx}" title="Eliminar"><i data-lucide="x"></i></button>
    </div>` : '';

  card.innerHTML = `
    <img class="card-photo" src="${person.photo}" alt="${person.name}" loading="lazy"
         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=06a3b6&color=fff&size=300'"/>
    ${flag ? `<div class="card-flag"><img src="${flag}" alt="${person.country}"/></div>` : ''}
    ${adminActions}
    <div class="card-footer">
      <div class="card-name">${person.name}</div>
      <div class="card-role">${person.role || ''}</div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-adm-btn')) {
      const btn = e.target.closest('.card-adm-btn');
      const idx = parseInt(btn.dataset.idx);
      if (btn.classList.contains('edit')) openMemberModal(idx);
      else deleteMember(idx);
      e.stopPropagation();
      return;
    }
    openProfile(realIdx);
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProfile(realIdx);
    }
  });

  return card;
}

// ═══ POP-UP PERFIL HEROICO ═══
function openProfile(idx) {
  const p = members[idx];
  if (!p) return;
  currentProfileIdx = idx;

  // Merge bio: usar las guardadas, y para cualquier campo vacío, usar la genérica
  const generic = generateHeroicBio(p);
  const bio = p.bio || {};
  const merged = {
    identidad: bio.identidad || generic.identidad,
    origen: bio.origen || generic.origen,
    superpoder: bio.superpoder || generic.superpoder,
    frase: bio.frase || generic.frase,
    union: bio.union || generic.union,
  };

  const overlay = document.getElementById("hero-profile");

  document.getElementById("hp-avatar").src = p.photo || '';
  document.getElementById("hp-avatar").onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=300`; };
  const flagUrl = getFlag(p.country);
  document.getElementById("hp-flag").innerHTML = flagUrl
    ? `<img src="${flagUrl}" alt="${p.country || ''}">`
    : '';
  document.getElementById("hp-name").textContent = p.name || '—';
  document.getElementById("hp-role").textContent = p.role || '—';

  // Rellenar campos
  overlay.querySelector('[data-field="identidad"]').textContent = merged.identidad;
  overlay.querySelector('[data-field="origen"]').textContent = merged.origen;
  overlay.querySelector('[data-field="superpoder"]').textContent = merged.superpoder;
  overlay.querySelector('[data-field="union"]').textContent = merged.union;
  overlay.querySelector('[data-field="frase"]').textContent = merged.frase;

  // Contactos (email y phone pueden venir como string o array)
  const contacts = [];
  const asList = (v) => v == null ? [] : (Array.isArray(v) ? v : [v]);
  asList(p.email).filter(e => e).forEach(e => {
    contacts.push(`<div class="hp-contact-row">${ICONS.email}<a href="mailto:${e}">${e}</a></div>`);
  });
  asList(p.phone).filter(ph => ph).forEach(ph => {
    contacts.push(`<div class="hp-contact-row">${ICONS.phone}<a href="tel:${ph.replace(/\s|\(|\)|-/g,'')}" class="mono">${ph}</a></div>`);
  });
  if (p.birthdate && /^\d{2}-\d{2}$/.test(p.birthdate)) {
    const [mm, dd] = p.birthdate.split('-');
    contacts.push(`<div class="hp-contact-row">${ICONS.cake}<span>🎂 ${parseInt(dd)} ${MONTHS[parseInt(mm)-1]}</span></div>`);
  }
  document.getElementById("hp-contacts-list").innerHTML = contacts.length
    ? contacts.join('')
    : `<div class="hp-contact-row" style="opacity:.5;">Sin información de contacto</div>`;

  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  if (window.refreshIcons) window.refreshIcons();
}

function closeProfile() {
  document.getElementById("hero-profile").classList.remove("open");
  document.body.style.overflow = "";
  currentProfileIdx = null;
}

// ═══ MODAL: Editar miembro (admin) — unificado en v2.18.1 ═══
// Este modal edita AMBAS cosas en un solo lugar: datos generales
// (nombre, rol, foto, país, cumpleaños, contactos) + ficha del héroe
// (identidad, origen, superpoder, unión, frase). Antes eran dos modales
// separados (openMemberModal + openBioEditModal) accesibles desde botones
// distintos, lo que resultaba confuso.
function openMemberModal(idx) {
  const editing = idx !== null && idx >= 0;
  const m = editing ? members[idx] : { name:'', role:'', email:[''], phone:[''], country:'Venezuela', photo:'', birthdate:'', bio:null };
  const [bm, bd] = (m.birthdate || '').split('-');
  const bio = m.bio || {};
  // Los placeholders de la ficha se calculan solo si el miembro existe
  // (necesitamos country, role, name para generarlos).
  const generic = editing ? generateHeroicBio(m) : { identidad:'', origen:'', superpoder:'', frase:'' };
  // Recordamos si el modal fue abierto desde el perfil grande, para
  // reabrirlo despues de guardar (o cancelar).
  const cameFromProfile = editing && (currentProfileIdx === idx);

  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? `✎ Editar miembro · ${m.name}` : "✦ Nuevo miembro";
  dialog.className = "member-edit-dialog";
  dialog.innerHTML = `
    <div class="member-form">
      <!-- Uploader de foto (avatar circular + click/drop) -->
      <div class="member-photo-uploader" id="m-photo-uploader">
        <div class="member-photo-avatar">
          <img id="m-photo-img" alt="Foto del miembro"
               src="${esc(m.photo || '')}"
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

      <sl-input id="m-name" label="Nombre completo"
        value="${esc(m.name || '')}" maxlength="60" required clearable></sl-input>

      <sl-input id="m-role" label="Rol / Cargo"
        value="${esc(m.role || '')}" maxlength="60" clearable></sl-input>

      <label class="m-native-field">
        <span class="m-native-label">País</span>
        <input id="m-country" type="text" class="m-native-input"
          value="${esc(m.country || '')}" maxlength="40"
          list="m-country-suggestions"
          placeholder="Ej: Venezuela, España, Colombia…" autocomplete="off">
        <datalist id="m-country-suggestions">
          ${COUNTRIES_SUGGESTED.map(c => `<option value="${esc(c)}"></option>`).join('')}
        </datalist>
      </label>

      <div class="member-bday">
        <label class="member-bday-label">🎂 Cumpleaños</label>
        <div class="member-bday-row">
          <select id="m-bmonth" class="m-native-select">
            <option value="">— Mes —</option>
            ${MONTHS.map((x, i) => `<option value="${String(i+1).padStart(2,'0')}">${x}</option>`).join('')}
          </select>
          <select id="m-bday" class="m-native-select">
            <option value="">— Día —</option>
            ${Array.from({length:31}, (_, i) => i+1).map(d => `<option value="${String(d).padStart(2,'0')}">${d}</option>`).join('')}
          </select>
        </div>
      </div>

      <sl-textarea id="m-emails" label="Emails (uno por línea)"
        rows="2" resize="vertical"
        help-text="Separa múltiples emails con saltos de línea."></sl-textarea>

      <sl-textarea id="m-phones" label="Teléfonos (uno por línea)"
        rows="2" resize="vertical"></sl-textarea>

      ${editing ? `
      <div class="member-form-divider">
        <span class="member-form-divider-label">✦ Ficha del héroe · opcional</span>
        <button type="button" id="bio-clear" class="member-form-divider-btn">
          <i data-lucide="refresh-cw" style="width:12px;height:12px;"></i>
          Restablecer a genéricos
        </button>
      </div>

      <sl-input id="bio-identidad" label="🛡️ Identidad narrativa (rol heróico)"
        value="${esc(bio.identidad || '')}"
        placeholder="${esc(generic.identidad || '')}"
        clearable></sl-input>

      <sl-textarea id="bio-superpoder" label="⚡ Superpoder"
        rows="2" resize="vertical"
        placeholder="${esc(generic.superpoder || '')}"></sl-textarea>

      <sl-input id="bio-union" label="📅 Se unió al equipo"
        value="${esc(bio.union || '')}"
        placeholder="Ej: Marzo 2024"
        clearable></sl-input>

      <sl-textarea id="bio-frase" label="✦ Frase icónica"
        rows="2" resize="vertical"
        placeholder="${esc(generic.frase || '')}"></sl-textarea>
      ` : `
      <p class="member-form-hint">Después de crear al miembro podrás editar su <strong>ficha del héroe</strong> (identidad, origen, superpoder, frase) desde el mismo modal.</p>
      `}
    </div>

    <sl-button slot="footer" id="m-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="m-save" variant="primary">
      <i data-lucide="${editing ? 'check' : 'plus'}" slot="prefix" style="width:14px;height:14px;"></i>
      ${editing ? 'Guardar cambios' : 'Agregar'}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  // Setear valores que no van bien como atributo (textareas, selects iniciales)
  dialog.querySelector("#m-emails").value = (m.email || []).join("\n");
  dialog.querySelector("#m-phones").value = (m.phone || []).join("\n");

  // <select> nativos del cumpleaños — se pueden setear directo.
  // Antes eran <sl-select> pero cerraban el sl-dialog al hacer una seleccion
  // (bug conocido de Shoelace).
  dialog.querySelector("#m-bmonth").value = bm || "";
  dialog.querySelector("#m-bday").value = bd || "";

  // Bio: setear los textareas por property (los sl-textarea no aceptan value
  // como atributo). Solo si estamos editando; en 'nuevo miembro' no hay bio.
  if (editing) {
    dialog.querySelector("#bio-superpoder").value = bio.superpoder || "";
    dialog.querySelector("#bio-frase").value = bio.frase || "";
  }

  // ── Uploader de foto ─────────────────────────────────────────────
  // Al seleccionar una imagen (click o drop), guardamos el File en
  // pendingPhotoFile y mostramos preview. El upload real ocurre al
  // hacer "Guardar cambios" — asi si el usuario cancela, no subimos nada.
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
    // Evitar reabrir el picker si el click nace del input mismo.
    if (e.target === photoFileInput) return;
    photoFileInput.click();
  });
  photoFileInput.addEventListener("change", (e) => {
    handlePhotoFile(e.target.files && e.target.files[0]);
  });
  uploaderEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploaderEl.classList.add("dragging");
  });
  uploaderEl.addEventListener("dragleave", () => uploaderEl.classList.remove("dragging"));
  uploaderEl.addEventListener("drop", (e) => {
    e.preventDefault();
    uploaderEl.classList.remove("dragging");
    handlePhotoFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  // Bandera para saber si el usuario ya restablecio la ficha en esta
  // sesion del modal. Si es true, al guardar persistimos bio=null.
  let bioCleared = false;

  dialog.addEventListener("sl-after-hide", () => {
    dialog.remove();
    // Si veniamos del perfil grande y no salimos por save, reabrir perfil.
    if (cameFromProfile && !dialog._savedFlag) openProfile(idx);
  });

  dialog.querySelector("#m-cancel").addEventListener("click", () => dialog.hide());

  // Restablecer la ficha del héroe (no toca los datos generales).
  if (editing) {
    dialog.querySelector("#bio-clear").addEventListener("click", async () => {
      const ok = await heroConfirm({
        title: "Restablecer ficha",
        message: "¿Limpiar todos los campos de la ficha del héroe? Se mostrarán los textos genéricos automáticos.",
        confirmLabel: "Restablecer",
        variant: "warning"
      });
      if (!ok) return;
      dialog.querySelector("#bio-identidad").value = "";
      dialog.querySelector("#bio-origen").value = "";
      dialog.querySelector("#bio-superpoder").value = "";
      dialog.querySelector("#bio-union").value = "";
      dialog.querySelector("#bio-frase").value = "";
      bioCleared = true;
      heroToast.info("Ficha restablecida. Haz clic en 'Guardar cambios' para confirmar.");
    });
  }

  dialog.querySelector("#m-save").addEventListener("click", async () => {
    const saveBtn = dialog.querySelector("#m-save");
    const originalLabel = saveBtn.textContent;
    const bmo = dialog.querySelector("#m-bmonth").value || "";
    const bdy = dialog.querySelector("#m-bday").value || "";
    const birthdate = (bmo && bdy) ? `${bmo}-${bdy}` : null;

    // Recomponer la bio a partir del modal si estamos editando.
    // Nota v2.18.1: el campo 'origen' se removio del modal — se autopobla
    // desde person.country via generateHeroicBio, asi que no lo persistimos.
    let newBio = null;
    if (editing) {
      const bioFields = {
        identidad: (dialog.querySelector("#bio-identidad").value || "").trim(),
        superpoder: (dialog.querySelector("#bio-superpoder").value || "").trim(),
        union: (dialog.querySelector("#bio-union").value || "").trim(),
        frase: (dialog.querySelector("#bio-frase").value || "").trim(),
      };
      const allEmpty = Object.values(bioFields).every(v => !v);
      newBio = (allEmpty || bioCleared) ? null : bioFields;
    }

    const name = (dialog.querySelector("#m-name").value || "").trim();
    if (!name) {
      dialog.querySelector("#m-name").focus();
      heroToast.error("El nombre es requerido");
      return;
    }

    // Subir la foto si hay una pendiente. Ocurre ANTES del setDoc para
    // que si falla el upload no persistamos referencia a un archivo inexistente.
    let photoPath = (m.photo || "").trim();
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

    const nuevo = {
      name,
      role: (dialog.querySelector("#m-role").value || "").trim(),
      photo: photoPath,
      country: (dialog.querySelector("#m-country").value || "").trim(),
      email: (dialog.querySelector("#m-emails").value || "").split("\n").map(x => x.trim()).filter(Boolean),
      phone: (dialog.querySelector("#m-phones").value || "").split("\n").map(x => x.trim()).filter(Boolean),
      birthdate,
      bio: newBio,
    };

    if (editing) members[idx] = nuevo;
    else members.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "team"), { members });
      dialog._savedFlag = true;
      dialog.hide();
      renderGrid();
      heroToast.success(editing ? "Cambios guardados" : `${nuevo.name} agregado al equipo`);
      // Si veniamos del perfil grande, reabrirlo con la data actualizada.
      if (cameFromProfile) openProfile(idx);
    } catch (e) {
      heroToast.error("Error guardando: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

async function deleteMember(idx) {
  const m = members[idx];
  const ok = await heroConfirm({
    title: "Eliminar miembro",
    message: `¿Eliminar a ${m.name}? Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;
  members.splice(idx, 1);
  try {
    await setDoc(doc(db, "shared", "team"), { members });
    renderGrid();
    heroToast.success(`${m.name} eliminado`);
  } catch (e) { heroToast.error("No se pudo eliminar: " + e.message); }
}
