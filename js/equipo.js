import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";
import {
  getAllUsers, createUser, updateUserFields, deleteUser,
  countryLabel, countryFlagUrl, nameToIso, slugifyName
} from "./user-store.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

// Emoji de bandera para la ficha del héroe (bio.origen). NO se usa en el
// resto del UI (los cards y hero-profile usan SVG via countryFlagUrl porque
// Windows no renderiza bien los emoji de banderas).
const FLAGS_EMOJI = {
  VE:'🇻🇪', CU:'🇨🇺', CO:'🇨🇴', CL:'🇨🇱', HN:'🇭🇳',
  US:'🇺🇸', AR:'🇦🇷', MX:'🇲🇽', ES:'🇪🇸', PE:'🇵🇪',
  EC:'🇪🇨', UY:'🇺🇾', CR:'🇨🇷', PA:'🇵🇦', DO:'🇩🇴',
  GT:'🇬🇹', NI:'🇳🇮', SV:'🇸🇻', BO:'🇧🇴', PY:'🇵🇾',
  PR:'🇵🇷', BR:'🇧🇷'
};
const getFlagEmoji = (iso) => iso ? (FLAGS_EMOJI[String(iso).toUpperCase()] || '') : '';

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

// Paises sugeridos en el <datalist> del modal de miembro. No es exhaustiva,
// pero cubre los origenes actuales del equipo + resto de LatAm + España/US.
// La lista queda como nombres ES; al guardar se convierten a ISO via nameToIso.
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
// Recibe un doc de users/{email} (post-fase 1). Lee display.jobTitle,
// identity.country (ISO), identity.name.
function generateHeroicBio(person) {
  const jobTitle = person.display?.jobTitle || '';
  const role = jobTitle.toLowerCase();
  const countryIso = person.identity?.country || '';
  const countryName = countryLabel(countryIso) || 'tierras lejanas';
  const name = person.identity?.name || '';

  // Identidad secreta (basada en el rol)
  let identidad = jobTitle || 'Héroe del equipo';

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
  let origen = countryName;
  const flagEmoji = getFlagEmoji(countryIso);
  if (flagEmoji) origen = `${flagEmoji} ${countryName}`;

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
  const idx = (name || '').charCodeAt(0) % frasesHeroicas.length;
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

// Array de docs users/{email} — cada item = { _email, identity, display, access, prefs, meta }
// Se conserva el nombre "members" por familiaridad; NO es la vieja shape de
// shared/team.members[] — la migración de fase 1 lo pasó a la colección users/.
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
  const grid = document.getElementById("team-grid");
  try {
    // getAllUsers ya excluye meta.excluded=true (Luis Ernesto Gutiérrez etc.)
    members = await getAllUsers({ includeExcluded: false });
    // Orden estable: por nombre (mantiene la sensación de la lista vieja que
    // era array ordenado por como se agregaron)
    members.sort((a, b) => (a.identity?.name || "").localeCompare(b.identity?.name || ""));
    if (!members.length) {
      grid.replaceChildren();
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Aún no se ha cargado el equipo.";
      grid.appendChild(p);
      return;
    }
    renderGrid();
  } catch (e) {
    console.error(e);
    grid.replaceChildren();
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Error: " + e.message;
    grid.appendChild(p);
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
    ? members.filter(m => (m.identity?.name || '').toLowerCase().includes(filter)
                       || (m.display?.jobTitle || '').toLowerCase().includes(filter))
    : members;
  document.getElementById("team-count-num").textContent = filtered.length;

  if (!filtered.length) {
    grid.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "team-empty";
    const icon = document.createElement("div");
    icon.className = "team-empty-icon";
    const i = document.createElement("i");
    i.setAttribute("data-lucide", filter ? "search-x" : "users");
    icon.appendChild(i);
    const title = document.createElement("div");
    title.className = "team-empty-title";
    title.textContent = filter ? "Sin resultados" : "Aún no hay miembros";
    const desc = document.createElement("div");
    desc.className = "team-empty-desc";
    if (filter) {
      desc.append(
        document.createTextNode("No encontramos héroes con "),
        Object.assign(document.createElement("strong"), { textContent: `"${filter}"` }),
        document.createTextNode(".")
      );
    } else {
      desc.textContent = "Cuando un admin agregue al equipo, aparecerán aquí.";
    }
    wrap.append(icon, title, desc);
    grid.appendChild(wrap);
    if (window.refreshIcons) window.refreshIcons();
    return;
  }
  grid.replaceChildren();
  filtered.forEach((m, i) => grid.appendChild(buildCard(m, i)));
  if (window.refreshIcons) window.refreshIcons();
}

function buildCard(person, idx) {
  const realIdx = members.indexOf(person);
  const name = person.identity?.name || "";
  const jobTitle = person.display?.jobTitle || "";
  const photo = person.identity?.photo || "";
  const countryIso = person.identity?.country || "";
  const countryName = countryLabel(countryIso);
  const flagUrl = countryIso ? countryFlagUrl(countryIso) : "";

  const card = document.createElement('div');
  card.className = 'team-card card-outer';
  card.style.animationDelay = `${Math.min(idx, 19) * 0.03}s`;
  card.setAttribute('tabindex', '0');
  card.dataset.idx = realIdx;

  const img = document.createElement("img");
  img.className = "card-photo";
  img.src = photo;
  img.alt = name;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=06a3b6&color=fff&size=300`;
  });
  card.appendChild(img);

  if (flagUrl) {
    const flagWrap = document.createElement("div");
    flagWrap.className = "card-flag";
    const flagImg = document.createElement("img");
    flagImg.src = flagUrl;
    flagImg.alt = countryName;
    flagWrap.appendChild(flagImg);
    card.appendChild(flagWrap);
  }

  if (isAdmin) {
    const actions = document.createElement("div");
    actions.className = "card-admin-actions";
    const btnEdit = document.createElement("button");
    btnEdit.className = "card-adm-btn edit";
    btnEdit.dataset.idx = realIdx;
    btnEdit.title = "Editar miembro";
    const iEdit = document.createElement("i");
    iEdit.setAttribute("data-lucide", "edit-3");
    btnEdit.appendChild(iEdit);
    const btnDel = document.createElement("button");
    btnDel.className = "card-adm-btn del";
    btnDel.dataset.idx = realIdx;
    btnDel.title = "Eliminar";
    const iDel = document.createElement("i");
    iDel.setAttribute("data-lucide", "x");
    btnDel.appendChild(iDel);
    actions.append(btnEdit, btnDel);
    card.appendChild(actions);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";
  const nameEl = document.createElement("div");
  nameEl.className = "card-name";
  nameEl.textContent = name;
  const roleEl = document.createElement("div");
  roleEl.className = "card-role";
  roleEl.textContent = jobTitle;
  footer.append(nameEl, roleEl);
  card.appendChild(footer);

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

  const name = p.identity?.name || "";
  const photo = p.identity?.photo || "";
  const jobTitle = p.display?.jobTitle || "";
  const countryIso = p.identity?.country || "";
  const countryName = countryLabel(countryIso);
  const flagUrl = countryIso ? countryFlagUrl(countryIso) : "";
  const emails = Array.isArray(p.identity?.emails) ? p.identity.emails : [];
  const phones = Array.isArray(p.identity?.phones) ? p.identity.phones : [];
  const birthdate = p.identity?.birthdate || "";

  // Merge bio: usar las guardadas, y para cualquier campo vacío, usar la genérica
  const generic = generateHeroicBio(p);
  const bio = p.display?.bio || {};
  const merged = {
    identidad: bio.identidad || generic.identidad,
    origen: bio.origen || generic.origen,
    superpoder: bio.superpoder || generic.superpoder,
    frase: bio.frase || generic.frase,
    union: bio.union || generic.union,
  };

  const overlay = document.getElementById("hero-profile");

  const avatarEl = document.getElementById("hp-avatar");
  avatarEl.src = photo;
  avatarEl.onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=06a3b6&color=fff&size=300`; };

  const flagEl = document.getElementById("hp-flag");
  flagEl.replaceChildren();
  if (flagUrl) {
    const flagImg = document.createElement("img");
    flagImg.src = flagUrl;
    flagImg.alt = countryName;
    flagEl.appendChild(flagImg);
  }

  document.getElementById("hp-name").textContent = name || '—';
  document.getElementById("hp-role").textContent = jobTitle || '—';

  // Rellenar campos
  overlay.querySelector('[data-field="identidad"]').textContent = merged.identidad;
  overlay.querySelector('[data-field="origen"]').textContent = merged.origen;
  overlay.querySelector('[data-field="superpoder"]').textContent = merged.superpoder;
  overlay.querySelector('[data-field="union"]').textContent = merged.union;
  overlay.querySelector('[data-field="frase"]').textContent = merged.frase;

  // Contactos (DOM API — evita innerHTML con userdata)
  const contactsList = document.getElementById("hp-contacts-list");
  contactsList.replaceChildren();
  const makeContactRow = (svgKey, contentBuilder) => {
    const row = document.createElement("div");
    row.className = "hp-contact-row";
    // Los ICONS ya son SVG estáticos (constantes hardcoded), no untrusted
    const iconWrap = document.createElement("span");
    iconWrap.innerHTML = ICONS[svgKey];
    row.appendChild(iconWrap.firstElementChild);
    contentBuilder(row);
    return row;
  };
  emails.filter(Boolean).forEach(e => {
    contactsList.appendChild(makeContactRow("email", (row) => {
      const a = document.createElement("a");
      a.href = `mailto:${e}`;
      a.textContent = e;
      row.appendChild(a);
    }));
  });
  phones.filter(Boolean).forEach(ph => {
    contactsList.appendChild(makeContactRow("phone", (row) => {
      const a = document.createElement("a");
      a.href = `tel:${ph.replace(/\s|\(|\)|-/g,'')}`;
      a.className = "mono";
      a.textContent = ph;
      row.appendChild(a);
    }));
  });
  if (birthdate && /^\d{2}-\d{2}$/.test(birthdate)) {
    const [mm, dd] = birthdate.split('-');
    contactsList.appendChild(makeContactRow("cake", (row) => {
      const span = document.createElement("span");
      span.textContent = `🎂 ${parseInt(dd)} ${MONTHS[parseInt(mm)-1]}`;
      row.appendChild(span);
    }));
  }
  if (!contactsList.children.length) {
    const empty = document.createElement("div");
    empty.className = "hp-contact-row";
    empty.style.opacity = ".5";
    empty.textContent = "Sin información de contacto";
    contactsList.appendChild(empty);
  }

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
  // Extrae valores del doc user/{email} en variables cortas para el HTML del modal.
  // En modo "nuevo" los defaults van vacíos (país Venezuela como sugerencia).
  const m = editing ? members[idx] : null;
  const nameVal      = m?.identity?.name || '';
  const jobTitleVal  = m?.display?.jobTitle || '';
  const photoVal     = m?.identity?.photo || '';
  const countryIso   = m?.identity?.country || (editing ? '' : 'VE');
  const countryVal   = countryLabel(countryIso) || (editing ? '' : 'Venezuela');
  const emailsArr    = Array.isArray(m?.identity?.emails) ? m.identity.emails : [];
  const phonesArr    = Array.isArray(m?.identity?.phones) ? m.identity.phones : [];
  const birthdateVal = m?.identity?.birthdate || '';
  const bio          = m?.display?.bio || {};
  const originalEmail = m?._email || null;  // docId — para detectar rename del primary email
  const [bm, bd] = (birthdateVal).split('-');
  // Los placeholders de la ficha se calculan solo si el miembro existe
  // (necesitamos country, jobTitle, name para generarlos).
  const generic = editing ? generateHeroicBio(m) : { identidad:'', origen:'', superpoder:'', frase:'' };
  // Recordamos si el modal fue abierto desde el perfil grande, para
  // reabrirlo despues de guardar (o cancelar).
  const cameFromProfile = editing && (currentProfileIdx === idx);

  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? `✎ Editar miembro · ${nameVal}` : "✦ Nuevo miembro";
  dialog.className = "member-edit-dialog";
  dialog.innerHTML = `
    <div class="member-form">
      <!-- Uploader de foto (avatar circular + click/drop) -->
      <div class="member-photo-uploader" id="m-photo-uploader">
        <div class="member-photo-avatar">
          <img id="m-photo-img" alt="Foto del miembro"
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

      <sl-input id="m-name" label="Nombre completo"
        value="${esc(nameVal)}" maxlength="60" required clearable></sl-input>

      <sl-input id="m-role" label="Rol / Cargo"
        value="${esc(jobTitleVal)}" maxlength="60" clearable></sl-input>

      <label class="m-native-field">
        <span class="m-native-label">País</span>
        <input id="m-country" type="text" class="m-native-input"
          value="${esc(countryVal)}" maxlength="40"
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
  dialog.querySelector("#m-emails").value = emailsArr.join("\n");
  dialog.querySelector("#m-phones").value = phonesArr.join("\n");

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
    const birthdate = (bmo && bdy) ? `${bmo}-${bdy}` : "";

    // Recomponer la bio a partir del modal si estamos editando.
    // Nota: el campo 'origen' se removio del modal — se autopobla desde
    // identity.country via generateHeroicBio, asi que no lo persistimos.
    // Estructura fija del subdoc bio (identidad/superpoder/frase/union) — si
    // se limpia, guardamos objeto vacío en vez de null para no romper reglas.
    const emptyBio = { identidad: "", superpoder: "", frase: "", union: "" };
    let newBio = null;
    if (editing) {
      const bioFields = {
        identidad: (dialog.querySelector("#bio-identidad").value || "").trim(),
        superpoder: (dialog.querySelector("#bio-superpoder").value || "").trim(),
        union: (dialog.querySelector("#bio-union").value || "").trim(),
        frase: (dialog.querySelector("#bio-frase").value || "").trim(),
      };
      const allEmpty = Object.values(bioFields).every(v => !v);
      newBio = (allEmpty || bioCleared) ? emptyBio : { ...emptyBio, ...bioFields };
    }

    const name = (dialog.querySelector("#m-name").value || "").trim();
    if (!name) {
      dialog.querySelector("#m-name").focus();
      heroToast.error("El nombre es requerido");
      return;
    }

    const emailsList = (dialog.querySelector("#m-emails").value || "")
      .split("\n").map(x => x.trim().toLowerCase()).filter(Boolean);
    const phonesList = (dialog.querySelector("#m-phones").value || "")
      .split("\n").map(x => x.trim()).filter(Boolean);
    const primaryEmail = emailsList[0];
    const jobTitle = (dialog.querySelector("#m-role").value || "").trim();
    const countryStr = (dialog.querySelector("#m-country").value || "").trim();
    const countryIsoResolved = countryStr ? nameToIso(countryStr) : null;
    if (countryStr && !countryIsoResolved) {
      heroToast.error(`País "${countryStr}" no reconocido. Usa un nombre estándar (Venezuela, Colombia, etc.)`);
      return;
    }

    if (!primaryEmail) {
      heroToast.error("Al menos un email es requerido (el primero será el ID del doc en users/)");
      return;
    }

    // En edit, el email principal define el docId — si el usuario lo cambia,
    // sería un rename del doc (borrar+crear). Preferimos bloquearlo y pedir
    // a IT que lo maneje aparte para evitar perder audit-log historial.
    if (editing && originalEmail && primaryEmail !== originalEmail.toLowerCase()) {
      heroToast.error("No se puede cambiar el email principal desde aquí. Contacta a IT si es necesario renombrar el doc.");
      return;
    }

    // Subir la foto si hay una pendiente. Ocurre ANTES del write para que si
    // falla el upload no persistamos referencia a un archivo inexistente.
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
        // updateUserFields con dot paths — solo toca los campos declarados,
        // el resto (access.role, access.updatedBy, prefs.*, meta.*) queda intacto
        await updateUserFields(originalEmail, {
          "identity.name": name,
          "identity.photo": photoPath,
          "identity.country": countryIsoResolved,
          "identity.birthdate": birthdate,
          "identity.phones": phonesList,
          "identity.emails": emailsList,
          "display.jobTitle": jobTitle,
          "display.bio": newBio || emptyBio,
        });
        // Reflejo local (evita refetch)
        const cur = members[idx];
        cur.identity = { ...(cur.identity || {}), name, photo: photoPath,
                         country: countryIsoResolved, birthdate,
                         phones: phonesList, emails: emailsList };
        cur.display = { ...(cur.display || {}), jobTitle, bio: newBio || emptyBio };
      } else {
        const created = await createUser(primaryEmail, {
          name,
          photo: photoPath,
          country: countryIsoResolved,
          birthdate,
          phones: phonesList,
          emails: emailsList,
          jobTitle,
        });
        members.push(created);
        members.sort((a, b) => (a.identity?.name || "").localeCompare(b.identity?.name || ""));
      }
      dialog._savedFlag = true;
      dialog.hide();
      renderGrid();
      heroToast.success(editing ? "Cambios guardados" : `${name} agregado al equipo`);
      if (cameFromProfile) openProfile(idx);
    } catch (e) {
      console.error("[equipo save]", e);
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
  const displayName = m?.identity?.name || m?._email || "este miembro";
  const ok = await heroConfirm({
    title: "Eliminar miembro",
    message: `¿Eliminar a ${displayName}? Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;
  try {
    await deleteUser(m._email);
    members.splice(idx, 1);
    renderGrid();
    heroToast.success(`${displayName} eliminado`);
  } catch (e) {
    console.error("[equipo delete]", e);
    heroToast.error("No se pudo eliminar: " + e.message);
  }
}
