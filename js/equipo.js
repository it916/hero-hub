import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

const FLAGS_EMOJI = {
  'venezuela':'🇻🇪',
  'cuba':'🇨🇺',
  'colombia':'🇨🇴',
  'chile':'🇨🇱',
  'estados unidos':'🇺🇸',
  'eeuu':'🇺🇸',
  'us':'🇺🇸',
};
const FLAGS = {
  'venezuela':'https://flagicons.lipis.dev/flags/4x3/ve.svg',
  'cuba':'https://flagicons.lipis.dev/flags/4x3/cu.svg',
  'colombia':'https://flagicons.lipis.dev/flags/4x3/co.svg',
  'chile':'https://flagicons.lipis.dev/flags/4x3/cl.svg',
  'estados unidos':'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'eeuu':'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'us':'https://flagicons.lipis.dev/flags/4x3/us.svg',
};
const getFlag = (c) => c ? (FLAGS[c.toLowerCase().trim()] || null) : null;
const getFlagEmoji = (c) => c ? (FLAGS_EMOJI[c.toLowerCase().trim()] || '') : '';

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

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

  isAdmin = ADMIN_EMAILS.includes(user.email);
  document.getElementById("user-avatar").src = user.photoURL;
  if (isAdmin) {
    document.getElementById("btn-admin").style.display = "inline-flex";
    document.getElementById("btn-add-member").style.display = "inline-flex";
    document.getElementById("hp-edit-btn").classList.add("visible");
  }
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
      members = snap.data().members;
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
    grid.innerHTML = `<p class="empty">${filter ? 'Sin resultados para "' + filter + '"' : 'Aún no hay miembros.'}</p>`;
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
    formacion: bio.formacion || generic.formacion,
    superpoder: bio.superpoder || generic.superpoder,
    frase: bio.frase || generic.frase,
    union: bio.union || generic.union,
  };

  const overlay = document.getElementById("hero-profile");

  document.getElementById("hp-avatar").src = p.photo || '';
  document.getElementById("hp-avatar").onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=300`; };
  document.getElementById("hp-flag").textContent = getFlagEmoji(p.country);
  document.getElementById("hp-name").textContent = p.name || '—';
  document.getElementById("hp-role").textContent = p.role || '—';

  // Rellenar campos
  overlay.querySelector('[data-field="identidad"]').textContent = merged.identidad;
  overlay.querySelector('[data-field="origen"]').textContent = merged.origen;
  overlay.querySelector('[data-field="formacion"]').textContent = merged.formacion;
  overlay.querySelector('[data-field="superpoder"]').textContent = merged.superpoder;
  overlay.querySelector('[data-field="union"]').textContent = merged.union;
  overlay.querySelector('[data-field="frase"]').textContent = merged.frase;

  // Contactos
  const contacts = [];
  (p.email || []).filter(e => e).forEach(e => {
    contacts.push(`<div class="hp-contact-row">${ICONS.email}<a href="mailto:${e}">${e}</a></div>`);
  });
  (p.phone || []).filter(ph => ph).forEach(ph => {
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

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal modal-wide">
    <h3>Editar ficha heroica · ${p.name}</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">Los campos vacíos mostrarán el texto genérico automático.</p>

    <label>🛡️ Identidad secreta (rol)
      <input id="bio-identidad" value="${(bio.identidad || '').replace(/"/g,'&quot;')}" placeholder="${generic.identidad}">
    </label>
    <label>📍 Origen (dónde nació)
      <input id="bio-origen" value="${(bio.origen || '').replace(/"/g,'&quot;')}" placeholder="${generic.origen}">
    </label>
    <label>🎓 Formación
      <input id="bio-formacion" value="${(bio.formacion || '').replace(/"/g,'&quot;')}" placeholder="${generic.formacion}">
    </label>
    <label>⚡ Superpoder
      <textarea id="bio-superpoder" rows="2" placeholder="${generic.superpoder}">${bio.superpoder || ''}</textarea>
    </label>
    <label>📅 Se unió al equipo
      <input id="bio-union" value="${(bio.union || '').replace(/"/g,'&quot;')}" placeholder="Ej: Marzo 2024">
    </label>
    <label>✦ Frase icónica
      <textarea id="bio-frase" rows="2" placeholder="${generic.frase}">${bio.frase || ''}</textarea>
    </label>

    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="bio-cancel">Cancelar</button>
      <button class="btn-ghost-dark" id="bio-clear">🔄 Usar genéricos</button>
      <button class="btn-primary" id="bio-save">Guardar ficha</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#bio-cancel").onclick = () => modal.remove();
  modal.querySelector("#bio-clear").onclick = async () => {
    if (!confirm("¿Limpiar todos los campos? Se mostrarán los textos genéricos automáticos.")) return;
    members[idx].bio = null;
    try {
      await setDoc(doc(db, "shared", "team"), { members });
      modal.remove();
      openProfile(idx); // Recargar perfil
    } catch (e) { alert("Error: " + e.message); }
  };
  modal.querySelector("#bio-save").onclick = async () => {
    const nuevo = {
      identidad: modal.querySelector("#bio-identidad").value.trim(),
      origen: modal.querySelector("#bio-origen").value.trim(),
      formacion: modal.querySelector("#bio-formacion").value.trim(),
      superpoder: modal.querySelector("#bio-superpoder").value.trim(),
      union: modal.querySelector("#bio-union").value.trim(),
      frase: modal.querySelector("#bio-frase").value.trim(),
    };
    // Si todos están vacíos, guardamos null
    const allEmpty = Object.values(nuevo).every(v => !v);
    members[idx].bio = allEmpty ? null : nuevo;
    try {
      await setDoc(doc(db, "shared", "team"), { members });
      modal.remove();
      openProfile(idx); // Recargar perfil
    } catch (e) { alert("Error: " + e.message); }
  };
}

// ═══ MODAL: Editar datos generales (admin) ═══
function openMemberModal(idx) {
  const editing = idx !== null && idx >= 0;
  const m = editing ? members[idx] : { name:'', role:'', email:[''], phone:[''], country:'Venezuela', photo:'', birthdate:'' };
  const [bm, bd] = (m.birthdate || '').split('-');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal modal-wide">
    <h3>${editing ? 'Editar miembro' : 'Nuevo miembro'}</h3>
    <label>Nombre completo <input id="m-name" value="${(m.name||'').replace(/"/g,'&quot;')}" maxlength="60"></label>
    <label>Rol / Cargo <input id="m-role" value="${(m.role||'').replace(/"/g,'&quot;')}" maxlength="60"></label>
    <label>URL de foto <input id="m-photo" type="url" value="${(m.photo||'').replace(/"/g,'&quot;')}" placeholder="https://..."></label>
    <label>País
      <select id="m-country">
        <option value="Venezuela"${m.country==='Venezuela'?' selected':''}>🇻🇪 Venezuela</option>
        <option value="Cuba"${m.country==='Cuba'?' selected':''}>🇨🇺 Cuba</option>
        <option value="Colombia"${m.country==='Colombia'?' selected':''}>🇨🇴 Colombia</option>
        <option value="Chile"${m.country==='Chile'?' selected':''}>🇨🇱 Chile</option>
        <option value="Estados Unidos"${m.country==='Estados Unidos'?' selected':''}>🇺🇸 Estados Unidos</option>
      </select>
    </label>
    <label>🎂 Cumpleaños
      <div style="display:flex;gap:8px;margin-top:8px;">
        <select id="m-bmonth" style="flex:1;">
          <option value="">—</option>
          ${MONTHS.map((x,i) => `<option value="${String(i+1).padStart(2,'0')}"${bm===String(i+1).padStart(2,'0')?' selected':''}>${x}</option>`).join('')}
        </select>
        <select id="m-bday" style="flex:1;">
          <option value="">—</option>
          ${Array.from({length:31},(_,i)=>i+1).map(d => `<option value="${String(d).padStart(2,'0')}"${bd===String(d).padStart(2,'0')?' selected':''}>${d}</option>`).join('')}
        </select>
      </div>
    </label>
    <label>Emails (uno por línea) <textarea id="m-emails" rows="2">${(m.email||[]).join('\n')}</textarea></label>
    <label>Teléfonos (uno por línea) <textarea id="m-phones" rows="2">${(m.phone||[]).join('\n')}</textarea></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="m-cancel">Cancelar</button>
      <button class="btn-primary" id="m-save">${editing ? 'Guardar cambios' : 'Agregar'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#m-cancel").onclick = () => modal.remove();
  modal.querySelector("#m-save").onclick = async () => {
    const bmo = modal.querySelector("#m-bmonth").value;
    const bdy = modal.querySelector("#m-bday").value;
    const birthdate = (bmo && bdy) ? `${bmo}-${bdy}` : null;

    const nuevo = {
      name: modal.querySelector("#m-name").value.trim(),
      role: modal.querySelector("#m-role").value.trim(),
      photo: modal.querySelector("#m-photo").value.trim(),
      country: modal.querySelector("#m-country").value,
      email: modal.querySelector("#m-emails").value.split('\n').map(x=>x.trim()).filter(x=>x),
      phone: modal.querySelector("#m-phones").value.split('\n').map(x=>x.trim()).filter(x=>x),
      birthdate,
      bio: editing ? (members[idx].bio || null) : null
    };
    if (!nuevo.name) { alert("Nombre requerido"); return; }

    if (editing) members[idx] = nuevo;
    else members.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "team"), { members });
      modal.remove();
      renderGrid();
    } catch (e) { alert("Error guardando: " + e.message); }
  };
}

async function deleteMember(idx) {
  const m = members[idx];
  if (!confirm(`¿Eliminar a ${m.name}?`)) return;
  members.splice(idx, 1);
  try {
    await setDoc(doc(db, "shared", "team"), { members });
    renderGrid();
  } catch (e) { alert("Error: " + e.message); }
}
