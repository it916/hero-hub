import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

const FLAGS = {
  'venezuela':      'https://flagicons.lipis.dev/flags/4x3/ve.svg',
  'cuba':           'https://flagicons.lipis.dev/flags/4x3/cu.svg',
  'colombia':       'https://flagicons.lipis.dev/flags/4x3/co.svg',
  'chile':          'https://flagicons.lipis.dev/flags/4x3/cl.svg',
  'estados unidos': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'eeuu':           'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'us':             'https://flagicons.lipis.dev/flags/4x3/us.svg',
};
const getFlag = (c) => c ? (FLAGS[c.toLowerCase().trim()] || null) : null;

const ICONS = {
  email: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2"/><path d="M22 6l-10 7L2 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5.09 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 5 5l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="2"/></svg>`,
};

let members = [];
let isAdmin = false;
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

  isAdmin = ADMIN_EMAILS.includes(user.email);
  document.getElementById("user-avatar").src = user.photoURL;
  if (isAdmin) {
    document.getElementById("btn-admin").style.display = "inline-flex";
    document.getElementById("btn-add-member").style.display = "inline-flex";
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
      document.getElementById("team-grid").innerHTML = '<p class="empty">Aún no se ha cargado el equipo. Ejecuta <code>migrar-equipo.html</code> como admin para cargar los 19 miembros.</p>';
      return;
    }
    renderGrid();
  } catch (e) {
    console.error(e);
    document.getElementById("team-grid").innerHTML = `<p class="empty">Error cargando equipo: ${e.message}</p>`;
  }
}

function wireHandlers() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    filter = e.target.value.toLowerCase().trim();
    renderGrid();
  });

  document.getElementById("btn-add-member").addEventListener("click", () => openMemberModal(null));

  // Click afuera → cerrar overlays abiertos
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".card-outer") && !e.target.closest(".modal-overlay")) {
      document.querySelectorAll(".card-outer.open").forEach(c => c.classList.remove("open"));
    }
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
  const flag = getFlag(person.country);
  const emails = (person.email || []).filter(e => e).map(e =>
    `<div class="overlay-item">${ICONS.email}<a href="mailto:${e}" title="${e}">${e}</a></div>`
  ).join('');
  const phones = (person.phone || []).filter(p => p).map(p =>
    `<div class="overlay-item">${ICONS.phone}<a href="tel:${p.replace(/\s|\(|\)|-/g,'')}">${p}</a></div>`
  ).join('');

  const card = document.createElement('div');
  card.className = 'card-outer';
  card.style.animationDelay = `${Math.min(idx, 19) * 0.03}s`;
  card.setAttribute('tabindex', '0');

  const adminActions = isAdmin ? `
    <div class="card-admin-actions">
      <button class="card-adm-btn edit" data-idx="${members.indexOf(person)}" title="Editar">✎</button>
      <button class="card-adm-btn del" data-idx="${members.indexOf(person)}" title="Eliminar">×</button>
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
    <div class="card-overlay">
      <button class="overlay-close">✕</button>
      <img class="overlay-photo" src="${person.photo}" alt="${person.name}"
           onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=06a3b6&color=fff&size=120'"/>
      <div>
        <div class="overlay-name">${person.name}</div>
        <div class="overlay-role">${person.role || ''}</div>
      </div>
      <div class="overlay-divider"></div>
      <div class="overlay-contacts">${emails}${phones || '<div class="overlay-item" style="opacity:.6;">Sin teléfono registrado</div>'}</div>
      ${flag ? `<div class="overlay-flag"><img src="${flag}" alt=""/>${person.country}</div>` : ''}
    </div>
  `;

  // Click en card
  card.addEventListener('click', (e) => {
    if (e.target.closest('.overlay-close')) { e.stopPropagation(); card.classList.remove('open'); return; }
    if (e.target.closest('a')) return;
    if (e.target.closest('.card-adm-btn')) {
      const btn = e.target.closest('.card-adm-btn');
      const idx = parseInt(btn.dataset.idx);
      if (btn.classList.contains('edit')) openMemberModal(idx);
      else deleteMember(idx);
      e.stopPropagation();
      return;
    }
    document.querySelectorAll('.card-outer.open').forEach(c => { if (c !== card) c.classList.remove('open'); });
    card.classList.toggle('open');
  });

  return card;
}

// ═══ MODAL AGREGAR / EDITAR ═══
function openMemberModal(idx) {
  const editing = idx !== null && idx >= 0;
  const m = editing ? members[idx] : { name:'', role:'', email:[''], phone:[''], country:'Venezuela', photo:'' };

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
    <label>Emails (uno por línea) <textarea id="m-emails" rows="2" placeholder="correo@heroinsuranceusa.com">${(m.email||[]).join('\n')}</textarea></label>
    <label>Teléfonos (uno por línea) <textarea id="m-phones" rows="2" placeholder="+1 (555) 555-5555">${(m.phone||[]).join('\n')}</textarea></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="m-cancel">Cancelar</button>
      <button class="btn-primary" id="m-save">${editing ? 'Guardar cambios' : 'Agregar'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#m-cancel").onclick = () => modal.remove();
  modal.querySelector("#m-save").onclick = async () => {
    const nuevo = {
      name: modal.querySelector("#m-name").value.trim(),
      role: modal.querySelector("#m-role").value.trim(),
      photo: modal.querySelector("#m-photo").value.trim(),
      country: modal.querySelector("#m-country").value,
      email: modal.querySelector("#m-emails").value.split('\n').map(x=>x.trim()).filter(x=>x),
      phone: modal.querySelector("#m-phones").value.split('\n').map(x=>x.trim()).filter(x=>x),
    };
    if (!nuevo.name) { alert("Nombre requerido"); return; }

    if (editing) members[idx] = nuevo;
    else members.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "team"), { members });
      modal.remove();
      renderGrid();
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
  };
}

async function deleteMember(idx) {
  const m = members[idx];
  if (!confirm(`¿Eliminar a ${m.name}?`)) return;
  members.splice(idx, 1);
  try {
    await setDoc(doc(db, "shared", "team"), { members });
    renderGrid();
  } catch (e) {
    alert("Error: " + e.message);
  }
}
