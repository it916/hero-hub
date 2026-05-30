import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

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

// Tipos de productos (lista cerrada)
const PRODUCT_TYPES = ["ACA", "MEDICARE", "LIFE", "SUPLEMENTARIOS"];

// Estados de EE.UU. — los 50 + DC + PR
const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "PR", name: "Puerto Rico" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }
];

let contacts = [];
let filter = { text:'', dept:'all', products:[], state:'all' };

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

  document.getElementById("user-avatar").src = await getFreshGooglePhotoURL(user);
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
  document.querySelectorAll("#filter-row .filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#filter-row .filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filter.dept = chip.dataset.dept;
      renderDirectory();
    });
  });

  // Filtro por productos (multi-select AND)
  document.querySelectorAll(".dir-product-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const product = chip.dataset.product;
      const idx = filter.products.indexOf(product);
      if (idx === -1) {
        filter.products.push(product);
        chip.classList.add("active");
      } else {
        filter.products.splice(idx, 1);
        chip.classList.remove("active");
      }
      const clearBtn = document.getElementById("product-clear");
      if (clearBtn) clearBtn.style.display = filter.products.length > 0 ? "inline-flex" : "none";
      renderDirectory();
    });
  });

  const productClear = document.getElementById("product-clear");
  if (productClear) {
    productClear.addEventListener("click", () => {
      filter.products = [];
      document.querySelectorAll(".dir-product-chip").forEach(c => c.classList.remove("active"));
      productClear.style.display = "none";
      renderDirectory();
    });
  }

  // Poblar dropdown de estados y wire change
  const stateSelect = document.getElementById("dir-state-filter");
  if (stateSelect) {
    US_STATES.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.code;
      opt.textContent = `${s.name} (${s.code})`;
      stateSelect.appendChild(opt);
    });
    stateSelect.addEventListener("change", (e) => {
      filter.state = e.target.value;
      renderDirectory();
    });
  }

  document.getElementById("btn-add-contact").addEventListener("click", () => openContactModal(null));
}

function renderDirectory() {
  const body = document.getElementById("dir-body");

  // Filtrar
  let filtered = contacts.filter(c => {
    if (filter.dept !== 'all' && c.dept !== filter.dept) return false;

    // Filtro por productos (AND: el contacto debe tener TODOS los productos seleccionados)
    if (filter.products.length > 0) {
      const cProds = c.products || [];
      if (!filter.products.every(p => cProds.includes(p))) return false;
    }

    // Filtro por estado
    if (filter.state !== 'all') {
      if (c.state !== filter.state) return false;
    }

    if (filter.text) {
      const hay = `${c.name||''} ${c.company||''} ${c.dept||''} ${c.email||''} ${(c.phones||[]).join(' ')} ${c.notes||''} ${(c.products||[]).join(' ')} ${c.state||''}`.toLowerCase();
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

      // Log de auditoría
      logEvent(ACTIONS.CONTACT_DELETE, c.name || c.company || "—", {
        company: c.company || "—",
        dept: c.dept || "—"
      });

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

  // Productos
  const products = (c.products || []).filter(p => PRODUCT_TYPES.includes(p))
    .map(p => `<span class="dir-product-mini dir-product-${p.toLowerCase()}">${p}</span>`)
    .join('');
  const productsBlock = products ? `<div class="dir-products-row">${products}</div>` : '';

  // Estado
  const stateBlock = c.state ? `<span class="dir-state-pill">📍 ${c.state}</span>` : '';

  return `<div class="dir-card" data-id="${c.id}">
    <div class="dir-card-actions">
      <button class="dir-act dir-edit" data-id="${c.id}" title="Editar">✎</button>
      <button class="dir-act dir-del" data-id="${c.id}" title="Eliminar">×</button>
    </div>
    <div class="dir-card-tags">
      ${c.dept ? `<span class="dir-dept" style="${deptStyle}">${c.dept}</span>` : ''}
      ${stateBlock}
    </div>
    ${c.name ? `<div class="dir-name">${c.name}</div>` : ''}
    ${phones}
    ${email}
    ${productsBlock}
    ${notes}
  </div>`;
}

function openContactModal(idx) {
  const editing = idx !== null && idx >= 0;
  const c = editing ? contacts[idx] : { name:'', company:'', dept:'', phones:[''], email:'', notes:'', products:[], state:'' };
  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? `✎ Editar contacto · ${c.company || c.name}` : "✦ Nuevo contacto";
  dialog.className = "hh-dialog contact-dialog";
  dialog.innerHTML = `
    <div class="hh-form contact-form">
      <div class="modal-grid-2">
        <sl-input id="c-name" label="Nombre"
          value="${esc(c.name)}" maxlength="60" placeholder="Ej. María García" clearable></sl-input>
        <sl-input id="c-company" label="Empresa *"
          value="${esc(c.company)}" maxlength="40" placeholder="Ej. HUMANA" required clearable></sl-input>
      </div>

      <div class="modal-grid-2">
        <sl-select id="c-dept" label="Departamento" hoist clearable>
          <sl-option value="">— Sin departamento —</sl-option>
          ${Object.keys(DEPT_COLORS).map(d => `<sl-option value="${d}">${d}</sl-option>`).join('')}
        </sl-select>
        <sl-input id="c-email" label="Email" type="email"
          value="${esc(c.email)}" placeholder="correo@empresa.com" clearable></sl-input>
      </div>

      <sl-textarea id="c-phones" label="Teléfonos (uno por línea)"
        rows="2" resize="vertical" placeholder="(305) 000-0000"></sl-textarea>

      <div class="hh-field">
        <label class="hh-field-label">Productos</label>
        <div class="dir-modal-products">
          ${PRODUCT_TYPES.map(p => {
            const checked = (c.products||[]).includes(p) ? 'checked' : '';
            return `<label class="dir-modal-product-check">
              <input type="checkbox" name="c-product" value="${p}" ${checked}>
              <span class="dir-product-mini dir-product-${p.toLowerCase()}">${p}</span>
            </label>`;
          }).join('')}
        </div>
      </div>

      <sl-select id="c-state" label="Estado" hoist clearable>
        <sl-option value="">— Sin estado asignado —</sl-option>
        ${US_STATES.map(s => `<sl-option value="${s.code}">${s.name} (${s.code})</sl-option>`).join('')}
      </sl-select>

      <sl-input id="c-notes" label="Notas"
        value="${esc(c.notes)}" maxlength="120" placeholder="Ej. Contactar para entrenamientos" clearable></sl-input>
    </div>

    <sl-button slot="footer" id="c-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="c-save" variant="primary">
      <i data-lucide="${editing ? 'check' : 'plus'}" slot="prefix" style="width:14px;height:14px;"></i>
      ${editing ? 'Guardar' : 'Agregar'}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  // Valores que no van bien como atributo
  dialog.querySelector("#c-phones").value = (c.phones || []).join("\n");
  customElements.whenDefined("sl-select").then(() => {
    dialog.querySelector("#c-dept").value = c.dept || "";
    dialog.querySelector("#c-state").value = c.state || "";
  });

  dialog.addEventListener("sl-after-hide", () => dialog.remove());
  dialog.querySelector("#c-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#c-save").addEventListener("click", async () => {
    const company = (dialog.querySelector("#c-company").value || "").trim();
    if (!company) {
      alert("Empresa es obligatoria");
      dialog.querySelector("#c-company").focus();
      return;
    }
    const products = Array.from(dialog.querySelectorAll('input[name="c-product"]:checked')).map(i => i.value);
    const nuevo = {
      id: editing ? c.id : crypto.randomUUID(),
      name: (dialog.querySelector("#c-name").value || "").trim(),
      company,
      dept: dialog.querySelector("#c-dept").value || "",
      email: (dialog.querySelector("#c-email").value || "").trim(),
      phones: (dialog.querySelector("#c-phones").value || "").split("\n").map(x => x.trim()).filter(Boolean),
      products,
      state: dialog.querySelector("#c-state").value || "",
      notes: (dialog.querySelector("#c-notes").value || "").trim(),
      updatedBy: auth.currentUser.email,
      updatedAt: new Date().toISOString()
    };

    if (editing) contacts[idx] = nuevo;
    else contacts.push(nuevo);

    try {
      await setDoc(doc(db, "shared", "directorio"), { contacts });
      logEvent(
        editing ? ACTIONS.CONTACT_EDIT : ACTIONS.CONTACT_ADD,
        nuevo.name || nuevo.company,
        { company: nuevo.company || "—", dept: nuevo.dept || "—", state: nuevo.state || "—", products: products.join(", ") || "—" }
      );
      dialog.hide();
      renderDirectory();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}
