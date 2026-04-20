import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
// ADMIN_EMAILS eliminado: usamos el sistema de roles

const DEPT_COLORS = {
  'Broker Support':    { color:'#0097CC', bg:'rgba(0,151,204,.15)',   border:'rgba(0,151,204,.30)' },
  'Broker Manager':    { color:'#0065F3', bg:'rgba(0,101,243,.15)',   border:'rgba(0,101,243,.30)' },
  'Finance':           { color:'#2ecc71', bg:'rgba(46,204,113,.12)',  border:'rgba(46,204,113,.28)' },
  'Contract':          { color:'#a78bfa', bg:'rgba(167,139,250,.12)', border:'rgba(167,139,250,.28)' },
  'Sales':             { color:'#fb923c', bg:'rgba(251,146,60,.12)',  border:'rgba(251,146,60,.28)' },
  'Marketing':         { color:'#f472b6', bg:'rgba(244,114,182,.12)', border:'rgba(244,114,182,.28)' },
  'Events':            { color:'#F5C842', bg:'rgba(245,200,66,.12)',  border:'rgba(245,200,66,.28)' },
  'Technical Support': { color:'#19CDEB', bg:'rgba(25,205,235,.12)',  border:'rgba(25,205,235,.28)' },
};

let contacts = [];
let filter = { text:'', dept:'all' };

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
  // btn-admin ya fue manejado por page-guard.js

  document.getElementById("user-avatar").src = user.photoURL;
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  await loadContacts();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth).then(() => location.href = "index.html"));

async function loadContacts() {
  try {
    const snap = await getDoc(doc(db, "shared", "directorio"));
    if (snap.exists() && Array.isArray(snap.data().contacts)) {
      contacts = snap.data().contacts;
    } else {
      contacts = [];
    }
    renderDirectory();
  } catch (e) {
    console.error(e);
    document.getElementById("dir-body").innerHTML = `<p class="empty">Error: ${e.message}</p>`;
  }
}

function wireHandlers() {
  document.getElementById("dir-search").addEventListener("input", (e) => {
    filter.text = e.target.value.toLowerCase().trim();
    renderDirectory();
  });
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.dept = chip.dataset.dept;
      renderDirectory();
    });
  });
  document.getElementById("btn-add-contact").addEventListener("click", () => openContactModal(null));
}

function renderDirectory() {
  const body = document.getElementById("dir-body");

  // Filtrar
  let filtered = contacts.filter(c => {
    if (filter.dept !== 'all' && c.dept !== filter.dept) return false;
    if (filter.text) {
      const hay = `${c.name||''} ${c.company||''} ${c.dept||''} ${c.email||''} ${(c.phones||[]).join(' ')} ${c.notes||''}`.toLowerCase();
      if (!hay.includes(filter.text)) return false;
    }
    return true;
  });

  // Contadores
  document.getElementById("stat-contacts").textContent = filtered.length;
  const companies = new Set(filtered.map(c => c.company).filter(x=>x));
  document.getElementById("stat-companies").textContent = companies.size;

  if (!filtered.length) {
    body.innerHTML = '<p class="empty">Sin resultados.</p>';
    return;
  }

  // Agrupar por empresa
  const grouped = {};
  filtered.forEach(c => {
    const comp = c.company || 'Sin empresa';
    if (!grouped[comp]) grouped[comp] = [];
    grouped[comp].push(c);
  });
  const companyOrder = Object.keys(grouped).sort();

  body.innerHTML = companyOrder.map(company => {
    const cards = grouped[company].map(c => buildCardHTML(c)).join('');
    return `<div class="dir-company-block">
      <div class="dir-company-name">${company}</div>
      <div class="dir-cards-row">${cards}</div>
    </div>`;
  }).join('');

  // Wire card actions
  body.querySelectorAll(".dir-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const idx = contacts.findIndex(c => c.id === id);
      if (idx >= 0) openContactModal(idx);
    });
  });
  body.querySelectorAll(".dir-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const c = contacts.find(x => x.id === id);
      if (!c || !confirm(`¿Eliminar contacto "${c.name || c.company}"?`)) return;
      contacts = contacts.filter(x => x.id !== id);
      await setDoc(doc(db, "shared", "directorio"), { contacts });
      renderDirectory();
    });
  });

  if (window.refreshIcons) window.refreshIcons();
}

function buildCardHTML(c) {
  const colors = DEPT_COLORS[c.dept] || { color:'#888', bg:'rgba(255,255,255,.08)', border:'rgba(255,255,255,.15)' };
  const deptStyle = `color:${colors.color};background:${colors.bg};border-color:${colors.border};`;
  const phones = (c.phones || []).filter(p => p).map(p =>
    `<a class="dir-phone" href="tel:${p.replace(/\s|\(|\)|-/g,'')}">${p}</a>`
  ).join('');
  const email = c.email ? `<a class="dir-email" href="mailto:${c.email}">${c.email}</a>` : '';
  const notes = c.notes ? `<div class="dir-notes">💬 ${c.notes}</div>` : '';

  return `<div class="dir-card" data-id="${c.id}">
    <div class="dir-card-actions">
      <button class="dir-act dir-edit" data-id="${c.id}" title="Editar">✎</button>
      <button class="dir-act dir-del" data-id="${c.id}" title="Eliminar">×</button>
    </div>
    ${c.dept ? `<span class="dir-dept" style="${deptStyle}">${c.dept}</span>` : ''}
    ${c.name ? `<div class="dir-name">${c.name}</div>` : ''}
    ${phones}
    ${email}
    ${notes}
  </div>`;
}

function openContactModal(idx) {
  const editing = idx !== null && idx >= 0;
  const c = editing ? contacts[idx] : { name:'', company:'', dept:'', phones:[''], email:'', notes:'' };

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal modal-wide">
    <h3>${editing ? 'Editar contacto' : 'Nuevo contacto'}</h3>
    <div class="modal-grid-2">
      <label>Nombre <input id="c-name" value="${(c.name||'').replace(/"/g,'&quot;')}" maxlength="60" placeholder="Ej. María García"></label>
      <label>Empresa * <input id="c-company" value="${(c.company||'').replace(/"/g,'&quot;')}" maxlength="40" placeholder="Ej. HUMANA"></label>
    </div>
    <div class="modal-grid-2">
      <label>Departamento
        <select id="c-dept">
          <option value="">— Sin departamento —</option>
          ${Object.keys(DEPT_COLORS).map(d => `<option value="${d}"${c.dept===d?' selected':''}>${d}</option>`).join('')}
        </select>
      </label>
      <label>Email <input id="c-email" type="email" value="${(c.email||'').replace(/"/g,'&quot;')}" placeholder="correo@empresa.com"></label>
    </div>
    <label>Teléfonos (uno por línea) <textarea id="c-phones" rows="2" placeholder="(305) 000-0000">${(c.phones||[]).join('\n')}</textarea></label>
    <label>Notas <input id="c-notes" value="${(c.notes||'').replace(/"/g,'&quot;')}" maxlength="120" placeholder="Ej. Contactar para entrenamientos"></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="c-cancel">Cancelar</button>
      <button class="btn-primary" id="c-save">${editing ? 'Guardar' : 'Agregar'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#c-cancel").onclick = () => modal.remove();
  modal.querySelector("#c-save").onclick = async () => {
    const company = modal.querySelector("#c-company").value.trim();
    if (!company) { alert("Empresa es obligatoria"); return; }
    const nuevo = {
      id: editing ? c.id : crypto.randomUUID(),
      name: modal.querySelector("#c-name").value.trim(),
      company,
      dept: modal.querySelector("#c-dept").value,
      email: modal.querySelector("#c-email").value.trim(),
      phones: modal.querySelector("#c-phones").value.split('\n').map(x=>x.trim()).filter(x=>x),
      notes: modal.querySelector("#c-notes").value.trim(),
      updatedBy: auth.currentUser.email,
      updatedAt: new Date().toISOString()
    };

    if (editing) contacts[idx] = nuevo;
    else contacts.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "directorio"), { contacts });
      modal.remove();
      renderDirectory();
    } catch (e) {
      alert("Error: " + e.message);
    }
  };
}
