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

  // Admin: editar ficha
  document.getElementById("hp-edit-btn").addEventListener("click", () => {
    if (currentProfileIdx !== null) openBioEditModal(currentProfileIdx);
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
      <button class="card-adm-btn edit" data-idx="${realIdx}" title="Editar datos">✎</button>
      <button class="card-adm-btn del" data-idx="${realIdx}" title="Eliminar">×</button>
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

// ═══ MODAL: Editar Bio (admin) ═══
function openBioEditModal(idx) {
  const p = members[idx];
  if (!p) return;
  const bio = p.bio || {};
  const generic = generateHeroicBio(p);

  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = `✦ Editar ficha · ${p.name}`;
  dialog.className = "bio-edit-dialog";
  dialog.innerHTML = `
    <div class="bio-form">
      <p class="bio-note">Los campos vacíos mostrarán el texto genérico automático.</p>

      <sl-input id="bio-identidad" label="🛡️ Identidad secreta (rol)"
        value="${esc(bio.identidad || '')}"
        placeholder="${esc(generic.identidad)}"
        clearable></sl-input>

      <sl-input id="bio-origen" label="📍 Origen (dónde nació)"
        value="${esc(bio.origen || '')}"
        placeholder="${esc(generic.origen)}"
        clearable></sl-input>

      <sl-textarea id="bio-superpoder" label="⚡ Superpoder"
        rows="2" resize="vertical"
        placeholder="${esc(generic.superpoder)}"></sl-textarea>

      <sl-input id="bio-union" label="📅 Se unió al equipo"
        value="${esc(bio.union || '')}"
        placeholder="Ej: Marzo 2024"
        clearable></sl-input>

      <sl-textarea id="bio-frase" label="✦ Frase icónica"
        rows="2" resize="vertical"
        placeholder="${esc(generic.frase)}"></sl-textarea>
    </div>

    <sl-button slot="footer" id="bio-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="bio-clear" variant="warning" outline>
      <i data-lucide="refresh-cw" slot="prefix" style="width:14px;height:14px;"></i>
      Usar genéricos
    </sl-button>
    <sl-button slot="footer" id="bio-save" variant="primary">
      <i data-lucide="save" slot="prefix" style="width:14px;height:14px;"></i>
      Guardar ficha
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  // Los textareas no aceptan value como atributo bien; los seteamos por property
  dialog.querySelector("#bio-superpoder").value = bio.superpoder || "";
  dialog.querySelector("#bio-frase").value = bio.frase || "";

  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#bio-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#bio-clear").addEventListener("click", async () => {
    const ok = await heroConfirm({
      title: "Restablecer ficha",
      message: "¿Limpiar todos los campos? Se mostrarán los textos genéricos automáticos.",
      confirmLabel: "Restablecer",
      variant: "warning"
    });
    if (!ok) return;
    members[idx].bio = null;
    try {
      await setDoc(doc(db, "shared", "team"), { members });
      dialog.hide();
      openProfile(idx);
      heroToast.info("Ficha restablecida a genéricos");
    } catch (e) { heroToast.error("No se pudo restablecer: " + e.message); }
  });

  dialog.querySelector("#bio-save").addEventListener("click", async () => {
    const nuevo = {
      identidad: (dialog.querySelector("#bio-identidad").value || "").trim(),
      origen: (dialog.querySelector("#bio-origen").value || "").trim(),
      superpoder: (dialog.querySelector("#bio-superpoder").value || "").trim(),
      union: (dialog.querySelector("#bio-union").value || "").trim(),
      frase: (dialog.querySelector("#bio-frase").value || "").trim(),
    };
    const allEmpty = Object.values(nuevo).every(v => !v);
    members[idx].bio = allEmpty ? null : nuevo;
    try {
      await setDoc(doc(db, "shared", "team"), { members });
      dialog.hide();
      openProfile(idx);
      heroToast.success("Ficha actualizada");
    } catch (e) { heroToast.error("No se pudo guardar: " + e.message); }
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}

// ═══ MODAL: Editar datos generales (admin) ═══
function openMemberModal(idx) {
  const editing = idx !== null && idx >= 0;
  const m = editing ? members[idx] : { name:'', role:'', email:[''], phone:[''], country:'Venezuela', photo:'', birthdate:'' };
  const [bm, bd] = (m.birthdate || '').split('-');

  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? `✎ Editar miembro · ${m.name}` : "✦ Nuevo miembro";
  dialog.className = "member-edit-dialog";
  dialog.innerHTML = `
    <div class="member-form">
      <sl-input id="m-name" label="Nombre completo"
        value="${esc(m.name || '')}" maxlength="60" required clearable></sl-input>

      <sl-input id="m-role" label="Rol / Cargo"
        value="${esc(m.role || '')}" maxlength="60" clearable></sl-input>

      <sl-input id="m-photo" label="URL de foto" type="url"
        value="${esc(m.photo || '')}" placeholder="https://..." clearable></sl-input>

      <sl-select id="m-country" label="País" hoist>
        <sl-option value="Venezuela">🇻🇪 Venezuela</sl-option>
        <sl-option value="Cuba">🇨🇺 Cuba</sl-option>
        <sl-option value="Colombia">🇨🇴 Colombia</sl-option>
        <sl-option value="Chile">🇨🇱 Chile</sl-option>
        <sl-option value="Estados Unidos">🇺🇸 Estados Unidos</sl-option>
      </sl-select>

      <div class="member-bday">
        <label class="member-bday-label">🎂 Cumpleaños</label>
        <div class="member-bday-row">
          <sl-select id="m-bmonth" placeholder="Mes" hoist>
            <sl-option value="">—</sl-option>
            ${MONTHS.map((x, i) => `<sl-option value="${String(i+1).padStart(2,'0')}">${x}</sl-option>`).join('')}
          </sl-select>
          <sl-select id="m-bday" placeholder="Día" hoist>
            <sl-option value="">—</sl-option>
            ${Array.from({length:31}, (_, i) => i+1).map(d => `<sl-option value="${String(d).padStart(2,'0')}">${d}</sl-option>`).join('')}
          </sl-select>
        </div>
      </div>

      <sl-textarea id="m-emails" label="Emails (uno por línea)"
        rows="2" resize="vertical"
        help-text="Separa múltiples emails con saltos de línea."></sl-textarea>

      <sl-textarea id="m-phones" label="Teléfonos (uno por línea)"
        rows="2" resize="vertical"></sl-textarea>
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

  // sl-select: setear value por property tras el upgrade
  customElements.whenDefined("sl-select").then(() => {
    const sel = (id, v) => { const el = dialog.querySelector(id); if (el) el.value = v || ""; };
    sel("#m-country", m.country || "Venezuela");
    sel("#m-bmonth", bm || "");
    sel("#m-bday", bd || "");
  });

  dialog.addEventListener("sl-after-hide", () => dialog.remove());

  dialog.querySelector("#m-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#m-save").addEventListener("click", async () => {
    const bmo = dialog.querySelector("#m-bmonth").value || "";
    const bdy = dialog.querySelector("#m-bday").value || "";
    const birthdate = (bmo && bdy) ? `${bmo}-${bdy}` : null;

    const nuevo = {
      name: (dialog.querySelector("#m-name").value || "").trim(),
      role: (dialog.querySelector("#m-role").value || "").trim(),
      photo: (dialog.querySelector("#m-photo").value || "").trim(),
      country: dialog.querySelector("#m-country").value || "Venezuela",
      email: (dialog.querySelector("#m-emails").value || "").split("\n").map(x => x.trim()).filter(Boolean),
      phone: (dialog.querySelector("#m-phones").value || "").split("\n").map(x => x.trim()).filter(Boolean),
      birthdate,
      bio: editing ? (members[idx].bio || null) : null,
    };
    if (!nuevo.name) {
      dialog.querySelector("#m-name").focus();
      heroToast.error("El nombre es requerido");
      return;
    }

    if (editing) members[idx] = nuevo;
    else members.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "team"), { members });
      dialog.hide();
      renderGrid();
      heroToast.success(editing ? "Cambios guardados" : `${nuevo.name} agregado al equipo`);
    } catch (e) { heroToast.error("Error guardando: " + e.message); }
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
