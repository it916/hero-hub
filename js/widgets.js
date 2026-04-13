import { db, auth } from "./firebase-config.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ════ EQUIPO HERO (cumpleaños) ════
const TEAM = [
  {name:'Anny Medina', role:'COO', date:{m:10,d:6}, photo:'https://i.imgur.com/QAKNQU6.png'},
  {name:'Aurys Rodriguez', role:'CFO', date:{m:12,d:28}, photo:'https://i.imgur.com/wrUIReK.png'},
  {name:'Jesus Gutierrez', role:'CEO', date:{m:5,d:13}, photo:'https://i.imgur.com/mZ1PkXU.png'},
  {name:'Jeyxi Suárez', role:'COO Assistant', date:{m:7,d:6}, photo:'https://i.imgur.com/lw8CulK.png'},
  {name:'María Alejandra Iribarren', role:'Relations Manager', date:{m:9,d:8}, photo:'https://i.imgur.com/n1HfSfc.png'},
  {name:'Oscar Palacios', role:'Assistance Department', date:{m:11,d:13}, photo:'https://i.imgur.com/7LMl99i.png'},
  {name:'Fernando Romero', role:'IT & Technology Manager', date:{m:11,d:15}, photo:'https://i.imgur.com/zUyf42Y.png'},
  {name:'Ramón Portillo', role:'Broker Support', date:{m:2,d:22}, photo:'https://i.imgur.com/uDgo3D2.png'},
  {name:'Eduardo Romero', role:'Office Manager', date:{m:10,d:26}, photo:'https://i.ibb.co/h0GTBhG/circulo-EDUARDO-OO.png'},
];

// ════ ARSENAL (tools agrupados) ════
const ARSENAL_DEFAULT = {
  google: [
    {label:'Gmail', url:'https://mail.google.com', icon:'https://cdn4.iconfinder.com/data/icons/logos-brands-in-colors/48/google-gmail-512.png'},
    {label:'Drive', url:'https://drive.google.com', icon:'https://cdn4.iconfinder.com/data/icons/logos-brands-in-colors/48/google-drive-512.png'},
    {label:'Calendar', url:'https://calendar.google.com', icon:'https://cdn4.iconfinder.com/data/icons/logos-brands-in-colors/48/google-calendar-512.png'},
    {label:'Meet', url:'https://meet.google.com', icon:'https://cdn4.iconfinder.com/data/icons/logos-brands-in-colors/48/google-meet-512.png'},
    {label:'Chat', url:'https://chat.google.com', icon:'https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/google-chat-icon.svg'},
    {label:'Sheets', url:'https://docs.google.com/spreadsheets', icon:'https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/google-sheets-icon.svg'},
    {label:'Docs', url:'https://docs.google.com', icon:'https://cdn-icons-png.flaticon.com/512/5968/5968517.png'},
    {label:'Slides', url:'https://slides.google.com', icon:'https://www.gstatic.com/images/branding/productlogos/slides_2020q4/v12/192px.svg'},
  ],
  ai: [
    {label:'ChatGPT', url:'https://chatgpt.com', icon:'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg'},
    {label:'Gemini', url:'https://gemini.google.com', icon:'https://brandlogos.net/wp-content/uploads/2025/03/gemini_icon-logo_brandlogos.net_aacx5.png'},
    {label:'Claude', url:'https://claude.ai', icon:'https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/claude-ai-icon.png'},
  ],
  work: [
    {label:'ClickUp', url:'https://app.clickup.com', icon:'https://www.applivery.com/wp-content/uploads/2024/11/clickup.png'},
    {label:'Canva', url:'https://www.canva.com', icon:'https://iaperfecta.com/wp-content/uploads/2025/05/Canva-icon.png'},
    {label:'Scribe', url:'https://scribehow.com', icon:'https://d3m1fwcc59lqhy.cloudfront.net/images/icons/scribe.png'},
    {label:'DeepL', url:'https://www.deepl.com/translator', icon:'https://www.deepl.com/img/favicon/favicon_96.png'},
    {label:'ExpressVPN', url:'https://expressvpn.com', icon:'https://img.icons8.com/color/1200/express-vpn.jpg'},
  ],
  crm: [
    {label:'HubSpot', url:'https://app.hubspot.com', icon:'https://cdn-icons-png.flaticon.com/512/5968/5968872.png'},
    {label:'GoHighLevel', url:'https://app.gohighlevel.com', icon:'https://i.ibb.co/C3NrTC8s/unnamed.jpg'},
  ],
};

// ════ DATOS COMPARTIDOS ════
let SHARED_DATA = {
  spotlight: { name:'—', role:'', message:'' },
  messages: []
};

let currentUserData = null;

async function loadSharedData() {
  try {
    const [sp, ms] = await Promise.all([
      getDoc(doc(db, "shared", "spotlight")),
      getDoc(doc(db, "shared", "messages"))
    ]);
    if (sp.exists()) SHARED_DATA.spotlight = sp.data();
    if (ms.exists()) SHARED_DATA.messages = ms.data().items || [];
  } catch (e) { console.error("Error leyendo shared:", e); }
}

export async function renderWidgets(userData) {
  currentUserData = userData;
  await loadSharedData();
  document.body.dataset.theme = userData.theme || "light";

  renderArsenal(userData);
  renderSpotlight();
  renderBirthday();
  renderMessages();
  attachSettingsHandler();
  if (window.refreshIcons) window.refreshIcons();
}

// ════ ARSENAL ════
function renderArsenal(userData) {
  const container = document.getElementById("tools-container");
  if (!container) return;
  const arsenal = userData.arsenal || ARSENAL_DEFAULT;
  const groups = [
    { key:'google', label:'Google Workspace', cls:'google' },
    { key:'ai', label:'Inteligencia Artificial', cls:'ai' },
    { key:'work', label:'Herramientas de Trabajo', cls:'work' },
    { key:'crm', label:'CRM', cls:'crm' },
  ];
  container.innerHTML = groups.map(g => {
    const items = arsenal[g.key] || [];
    return `<div class="tools-group">
      <div class="tools-group-label ${g.cls}">${g.label}</div>
      <div class="tools-grid">
        ${items.map((t,i) => `
          <div class="tool-item-wrap">
            <a href="${t.url}" target="_blank" rel="noopener" class="tool-item">
              <span class="open-mark">↗</span>
              <div class="icon-tile"><img src="${t.icon}" alt="${t.label}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1006/1006771.png'"></div>
              <span class="tool-name">${t.label}</span>
            </a>
            <button class="tool-delete-btn" data-group="${g.key}" data-idx="${i}" title="Eliminar">×</button>
          </div>`).join("")}
        <button class="tool-add-card" data-group="${g.key}">
          <i data-lucide="plus"></i>
          <span>Agregar</span>
        </button>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll('.tool-add-card').forEach(b => b.addEventListener('click', () => openAddToolModal(b.dataset.group)));
  container.querySelectorAll('.tool-delete-btn').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("¿Eliminar este acceso?")) return;
    const arsenal = currentUserData.arsenal || JSON.parse(JSON.stringify(ARSENAL_DEFAULT));
    arsenal[b.dataset.group].splice(parseInt(b.dataset.idx), 1);
    currentUserData.arsenal = arsenal;
    await saveUserField({ arsenal });
    renderArsenal(currentUserData);
    if (window.refreshIcons) window.refreshIcons();
  }));
}

function openAddToolModal(group) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>Nuevo acceso · ${group}</h3>
    <label>Nombre <input id="t-label" maxlength="20"></label>
    <label>URL <input id="t-url" type="url" placeholder="https://..."></label>
    <label>URL del ícono (PNG/SVG) <input id="t-icon" type="url" placeholder="https://..."></label>
    <div class="modal-buttons"><button class="btn-ghost-dark" id="t-cancel">Cancelar</button><button class="btn-primary" id="t-save">Guardar</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#t-cancel").onclick = () => modal.remove();
  modal.querySelector("#t-save").onclick = async () => {
    const label = modal.querySelector("#t-label").value.trim();
    const url = modal.querySelector("#t-url").value.trim();
    const icon = modal.querySelector("#t-icon").value.trim() || 'https://cdn-icons-png.flaticon.com/512/1006/1006771.png';
    if (!label || !url) { alert("Nombre y URL requeridos"); return; }
    const arsenal = currentUserData.arsenal || JSON.parse(JSON.stringify(ARSENAL_DEFAULT));
    if (!arsenal[group]) arsenal[group] = [];
    arsenal[group].push({ label, url, icon });
    currentUserData.arsenal = arsenal;
    await saveUserField({ arsenal });
    modal.remove();
    renderArsenal(currentUserData);
    if (window.refreshIcons) window.refreshIcons();
  };
}

// ════ SPOTLIGHT ════
function renderSpotlight() {
  const s = SHARED_DATA.spotlight;
  const n = document.getElementById("spName"); if (n) n.textContent = s.name || '—';
  const r = document.getElementById("spRole"); if (r) r.textContent = s.role || '';
  const m = document.getElementById("spMessage"); if (m) m.textContent = s.message || '';
}

// ════ CUMPLEAÑOS ════
function daysUntil(bd) {
  const today = new Date(); today.setHours(0,0,0,0);
  const thisYear = new Date(today.getFullYear(), bd.m-1, bd.d);
  if (thisYear.getTime() === today.getTime()) return 0;
  const target = thisYear > today ? thisYear : new Date(today.getFullYear()+1, bd.m-1, bd.d);
  return Math.ceil((target - today) / (1000*60*60*24));
}
function renderBirthday() {
  const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const sorted = TEAM.map(p => ({ p, d: daysUntil(p.date) })).sort((a,b) => a.d - b.d);
  const { p, d } = sorted[0];
  const isToday = d === 0, isTomorrow = d === 1;
  const el = id => document.getElementById(id);
  if (el('bdayAvatar')) {
    el('bdayAvatar').src = p.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=200`;
    el('bdayAvatar').onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=200`; };
  }
  if (el('bdayFloat')) el('bdayFloat').textContent = isToday ? '🎊' : '🎈';
  if (el('bdayBadge')) el('bdayBadge').textContent = isToday ? '🎂 Cumpleaños hoy' : '🎈 Próximo cumpleaños';
  if (el('bdayName')) el('bdayName').textContent = p.name;
  if (el('bdayRole')) el('bdayRole').textContent = p.role;
  if (el('bdayDate')) el('bdayDate').textContent = `🗓️ ${p.date.d} ${MONTHS[p.date.m-1]}`;
  if (el('bdayCountdown')) {
    if (isToday) el('bdayCountdown').innerHTML = '<strong>¡Es hoy! 🎉</strong>';
    else if (isTomorrow) el('bdayCountdown').innerHTML = 'Faltan <strong>¡solo 1 día!</strong>';
    else el('bdayCountdown').innerHTML = `Faltan <strong>${d} días</strong>`;
  }
  if (el('bdayConfetti')) el('bdayConfetti').textContent = isToday ? '🎊🎂🎊' : '🎈🎂🎈';
}

// ════ MENSAJES ════
let msgIdx = 0, msgTimer = null, msgProg = 0;
function renderMessages() {
  if (!SHARED_DATA.messages.length) {
    document.getElementById('msgBody').innerHTML = '<p class="empty">Sin mensajes aún. Agrega frases desde el panel admin.</p>';
    document.getElementById('msgCounter').textContent = '0 / 0';
    return;
  }
  msgIdx = msgIdx % SHARED_DATA.messages.length;
  showMsg();
  if (msgTimer) clearInterval(msgTimer);
  msgProg = 0;
  msgTimer = setInterval(() => {
    msgProg += (40/12000)*100;
    document.getElementById('msgProgFill').style.width = msgProg + '%';
    if (msgProg >= 100) { msgIdx = (msgIdx+1) % SHARED_DATA.messages.length; showMsg(); msgProg = 0; }
  }, 40);
}
function showMsg() {
  const body = document.getElementById('msgBody');
  body.classList.add('fading');
  setTimeout(() => {
    body.innerHTML = `<div class="msg-quote"><span class="q-mark">\u201c</span>${SHARED_DATA.messages[msgIdx]}</div>`;
    body.classList.remove('fading');
  }, 250);
  document.getElementById('msgCounter').textContent = `${msgIdx+1} / ${SHARED_DATA.messages.length}`;
  msgProg = 0;
  document.getElementById('msgProgFill').style.width = '0%';
}
document.addEventListener('click', e => {
  if (e.target.closest('#msgPrev')) { msgIdx = (msgIdx-1+SHARED_DATA.messages.length) % SHARED_DATA.messages.length; showMsg(); }
  if (e.target.closest('#msgNext')) { msgIdx = (msgIdx+1) % SHARED_DATA.messages.length; showMsg(); }
  if (e.target.closest('#msgRand')) { msgIdx = Math.floor(Math.random()*SHARED_DATA.messages.length); showMsg(); }
});

// ════ SAVE & SETTINGS ════
async function saveUserField(fields) {
  const user = auth.currentUser;
  if (!user) return;
  try { await updateDoc(doc(db, "users", user.email), fields); }
  catch (e) { console.error("Error guardando:", e); }
}

function attachSettingsHandler() {
  const btn = document.getElementById("btn-settings");
  if (btn && !btn.dataset.bound) { btn.dataset.bound = "1"; btn.addEventListener("click", openSettingsModal); }
}
function openSettingsModal() {
  const theme = currentUserData.theme || "light";
  const greeting = currentUserData.greeting || "";
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>Configuración</h3>
    <label>Saludo personalizado <input id="s-greeting" value="${greeting.replace(/"/g,'&quot;')}" maxlength="50" placeholder="(Vacío = automático)"></label>
    <label>Tema<div class="theme-toggle">
      <button class="theme-btn ${theme==='light'?'active':''}" data-theme="light">☀ Día</button>
      <button class="theme-btn ${theme==='dark'?'active':''}" data-theme="dark">☾ Noche</button>
    </div></label>
    <div class="modal-buttons"><button class="btn-primary" id="s-close">Cerrar</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#s-greeting").addEventListener("blur", async (e) => {
    currentUserData.greeting = e.target.value.trim();
    await saveUserField({ greeting: currentUserData.greeting });
    updateGreeting();
  });
  modal.querySelectorAll(".theme-btn").forEach(b => {
    b.addEventListener("click", async () => {
      currentUserData.theme = b.dataset.theme;
      document.body.dataset.theme = b.dataset.theme;
      modal.querySelectorAll(".theme-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      await saveUserField({ theme: b.dataset.theme });
    });
  });
  modal.querySelector("#s-close").onclick = () => modal.remove();
}

export function updateGreeting() {
  const user = auth.currentUser;
  if (!user) return;
  const h = new Date().getHours();
  let greet = "Buenas noches";
  if (h >= 5 && h < 12) greet = "Buenos días";
  else if (h >= 12 && h < 19) greet = "Buenas tardes";
  const firstName = user.displayName.split(" ")[0];
  const custom = currentUserData?.greeting?.trim();
  document.getElementById('greet-text').textContent = custom || greet;
  document.getElementById('greet-name').textContent = firstName;
}
