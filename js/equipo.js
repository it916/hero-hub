// Módulo Equipo: vista read-only del organigrama. Desde v2.23.3 toda
// la gestión de usuarios (crear/editar/eliminar/asignar rol) vive en
// admin.html → tab Usuarios (js/roles-admin.js). Aquí solo se lee.

import { auth } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";
import { getAllUsers, countryLabel, countryFlagUrl } from "./user-store.js";

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
let filter = "";

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

  document.getElementById("user-avatar").src = await getFreshGooglePhotoURL(user);
  // Vista 100% read-only desde v2.23.3 — la gestión de usuarios vive en
  // admin.html → tab Usuarios. Los botones de edición/agregar del HTML
  // legacy siguen presentes pero permanecen ocultos (display:none por CSS).
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

  // Cerrar perfil (X, click en overlay, ESC)
  document.getElementById("hp-close").addEventListener("click", closeProfile);
  document.getElementById("hero-profile").addEventListener("click", (e) => {
    if (e.target.id === "hero-profile") closeProfile();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProfile();
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

  card.addEventListener('click', () => openProfile(realIdx));

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
}
