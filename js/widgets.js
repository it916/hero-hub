import { db, auth } from "./firebase-config.js";
import { doc, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

let SHARED_DATA = { spotlight:{imageUrl:'',message:'',honorees:[]}, messages:[], team:[] };
let currentUserData = null;
let isAdmin = false;

async function loadSharedData() {
  try {
    const [sp, ms, tm] = await Promise.all([
      getDoc(doc(db, "shared", "spotlight")),
      getDoc(doc(db, "shared", "messages")),
      getDoc(doc(db, "shared", "team"))
    ]);
    if (sp.exists()) {
      const d = sp.data();
      if (d.honorees) SHARED_DATA.spotlight = { imageUrl:d.imageUrl||'', message:d.message||'', honorees:d.honorees||[] };
      else if (d.name) SHARED_DATA.spotlight = { imageUrl:'', message:d.message||'', honorees:[{name:d.name,role:d.role||''}] };
    }
    if (ms.exists()) {
      const data = ms.data();
      if (Array.isArray(data.items)) {
        SHARED_DATA.messages = data.items.map(x => typeof x === 'string' ? { id:crypto.randomUUID(), frase:x, autor:'—', created_at:new Date().toISOString() } : x);
      }
    }
    if (tm.exists() && Array.isArray(tm.data().members)) {
      SHARED_DATA.team = tm.data().members;
    }
  } catch (e) { console.warn("Error cargando shared:", e.message); }
}

export async function renderWidgets(userData) {
  currentUserData = userData || {};
  isAdmin = auth.currentUser && ADMIN_EMAILS.includes(auth.currentUser.email);
  await loadSharedData();
  document.body.dataset.theme = currentUserData.theme || "light";

  renderArsenal();
  renderSpotlight();
  renderBirthday();
  renderMessageWidget();
  attachSettingsHandler();
  if (window.refreshIcons) window.refreshIcons();
}

// ═══ ARSENAL ═══
function renderArsenal() {
  const container = document.getElementById("tools-container");
  if (!container) return;
  const arsenal = (currentUserData.arsenal && Object.keys(currentUserData.arsenal).length) ? currentUserData.arsenal : ARSENAL_DEFAULT;
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
          <i data-lucide="plus"></i><span>Agregar</span>
        </button>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll('.tool-add-card').forEach(b => b.addEventListener('click', () => openAddToolModal(b.dataset.group)));
  container.querySelectorAll('.tool-delete-btn').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("¿Eliminar este acceso?")) return;
    const arsenal = (currentUserData.arsenal && Object.keys(currentUserData.arsenal).length) ? currentUserData.arsenal : JSON.parse(JSON.stringify(ARSENAL_DEFAULT));
    arsenal[b.dataset.group].splice(parseInt(b.dataset.idx), 1);
    currentUserData.arsenal = arsenal;
    await saveUserField({ arsenal });
    renderArsenal();
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
    const arsenal = (currentUserData.arsenal && Object.keys(currentUserData.arsenal).length) ? currentUserData.arsenal : JSON.parse(JSON.stringify(ARSENAL_DEFAULT));
    if (!arsenal[group]) arsenal[group] = [];
    arsenal[group].push({ label, url, icon });
    currentUserData.arsenal = arsenal;
    await saveUserField({ arsenal });
    modal.remove();
    renderArsenal();
    if (window.refreshIcons) window.refreshIcons();
  };
}

// ═══ SPOTLIGHT ═══
function renderSpotlight() {
  const s = SHARED_DATA.spotlight;
  const banner = document.getElementById('spotlight-banner');
  const imgBg = document.getElementById('sp-image-bg');
  const honoreesEl = document.getElementById('sp-honorees');
  const msgEl = document.getElementById('sp-message');

  if (imgBg) {
    if (s.imageUrl) { imgBg.style.backgroundImage = `url(${s.imageUrl})`; banner?.classList.add('has-image'); }
    else { imgBg.style.backgroundImage = ''; banner?.classList.remove('has-image'); }
  }
  if (honoreesEl) {
    if (s.honorees?.length) {
      honoreesEl.dataset.count = s.honorees.length;
      honoreesEl.innerHTML = s.honorees.map(h => `
        <div class="honoree-item">
          <div class="honoree-name-display">${h.name || ''}</div>
          ${h.role ? `<div class="honoree-role-display">${h.role}</div>` : ''}
        </div>
      `).join('');
    } else {
      honoreesEl.innerHTML = '<div class="honoree-name-display">—</div>';
    }
  }
  if (msgEl) msgEl.textContent = s.message || '';
}

// ═══ CUMPLEAÑOS (desde shared/team) ═══
function parseBirthdate(bd) {
  // Formato "MM-DD"
  if (!bd || typeof bd !== 'string' || !/^\d{2}-\d{2}$/.test(bd)) return null;
  const [m, d] = bd.split('-').map(x => parseInt(x));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { m, d };
}

function daysUntil(bd) {
  const today = new Date(); today.setHours(0,0,0,0);
  const thisYear = new Date(today.getFullYear(), bd.m-1, bd.d);
  if (thisYear.getTime() === today.getTime()) return 0;
  const target = thisYear > today ? thisYear : new Date(today.getFullYear()+1, bd.m-1, bd.d);
  return Math.ceil((target - today) / (1000*60*60*24));
}

function renderBirthday() {
  const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

  // Filtrar solo miembros con birthdate válido
  const withBirthday = SHARED_DATA.team
    .map(m => {
      const date = parseBirthdate(m.birthdate);
      return date ? { p: {...m, date}, d: daysUntil(date) } : null;
    })
    .filter(x => x !== null)
    .sort((a,b) => a.d - b.d);

  const el = id => document.getElementById(id);

  if (!withBirthday.length) {
    if (el('bdayName')) el('bdayName').textContent = '—';
    if (el('bdayRole')) el('bdayRole').textContent = 'Sin cumpleaños registrados';
    if (el('bdayBadge')) el('bdayBadge').textContent = '🎈 Próximo cumpleaños';
    if (el('bdayDate')) el('bdayDate').textContent = '—';
    if (el('bdayCountdown')) el('bdayCountdown').innerHTML = '—';
    return;
  }

  const { p, d } = withBirthday[0];
  const isToday = d === 0, isTomorrow = d === 1;

  if (el('bdayAvatar')) {
    el('bdayAvatar').src = p.photo;
    el('bdayAvatar').onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=200`; };
  }
  if (el('bdayFloat')) el('bdayFloat').textContent = isToday ? '🎊' : '🎈';
  if (el('bdayBadge')) el('bdayBadge').textContent = isToday ? '🎂 Cumpleaños hoy' : '🎈 Próximo cumpleaños';
  if (el('bdayName')) el('bdayName').textContent = p.name;
  if (el('bdayRole')) el('bdayRole').textContent = p.role || '';
  if (el('bdayDate')) el('bdayDate').textContent = `🗓️ ${p.date.d} ${MONTHS[p.date.m-1]}`;
  if (el('bdayCountdown')) {
    if (isToday) el('bdayCountdown').innerHTML = '<strong>¡Es hoy! 🎉</strong>';
    else if (isTomorrow) el('bdayCountdown').innerHTML = 'Faltan <strong>¡solo 1 día!</strong>';
    else el('bdayCountdown').innerHTML = `Faltan <strong>${d} días</strong>`;
  }
  if (el('bdayConfetti')) el('bdayConfetti').textContent = isToday ? '🎊🎂🎊' : '🎈🎂🎈';
}

// ═══ MENSAJE DEL DÍA ═══
let msgIdx = 0, msgTimer = null, msgProg = 0;

function initials(name) {
  return (name||'?').split(' ').slice(0,2).map(w => w[0]||'').join('').toUpperCase() || '?';
}
function relDate(iso) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d/60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m/60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h/24)}d`;
}

function renderMessageWidget() {
  const msgs = SHARED_DATA.messages;
  if (!msgs.length) {
    document.getElementById('msgBody').innerHTML = '<p class="empty">Sin frases aún. ¡Sé el primero en agregar una!</p>';
    document.getElementById('msgMeta').style.display = 'none';
  } else {
    msgIdx = msgIdx % msgs.length;
    showCurrentMsg();
    startMsgTimer();
  }
  renderPlaylist();
  wireMsgForm();
}
function showCurrentMsg() {
  const msgs = SHARED_DATA.messages;
  if (!msgs.length) return;
  const f = msgs[msgIdx];
  const body = document.getElementById('msgBody');
  body.classList.add('fading');
  setTimeout(() => {
    body.innerHTML = `<div class="msg-quote"><span class="q-mark">\u201c</span>${f.frase}</div>`;
    body.classList.remove('fading');
  }, 250);
  document.getElementById('msgMeta').style.display = 'flex';
  document.getElementById('authorAv').textContent = initials(f.autor);
  document.getElementById('authorNm').textContent = f.autor;
  document.getElementById('authorDt').textContent = '· ' + relDate(f.created_at);
  document.getElementById('msgCounter').textContent = `${msgIdx+1} / ${msgs.length}`;
  document.getElementById('btnDelCurrent').style.display = isAdmin ? 'flex' : 'none';
  renderPlaylist();
}
function startMsgTimer() {
  if (msgTimer) clearInterval(msgTimer);
  msgProg = 0;
  document.getElementById('msgProgFill').style.width = '0%';
  msgTimer = setInterval(() => {
    msgProg += (40/12000)*100;
    const pf = document.getElementById('msgProgFill');
    if (pf) pf.style.width = msgProg + '%';
    if (msgProg >= 100) nextMsg();
  }, 40);
}
function nextMsg() { if (!SHARED_DATA.messages.length) return; msgIdx = (msgIdx+1) % SHARED_DATA.messages.length; showCurrentMsg(); startMsgTimer(); }
function prevMsg() { if (!SHARED_DATA.messages.length) return; msgIdx = (msgIdx-1+SHARED_DATA.messages.length) % SHARED_DATA.messages.length; showCurrentMsg(); startMsgTimer(); }
function randMsg() { if (!SHARED_DATA.messages.length) return; msgIdx = Math.floor(Math.random()*SHARED_DATA.messages.length); showCurrentMsg(); startMsgTimer(); }
function goToMsg(i) { msgIdx = i; showCurrentMsg(); startMsgTimer(); }

function renderPlaylist() {
  const list = document.getElementById('plList');
  if (!list) return;
  const count = document.getElementById('plCount');
  const msgs = SHARED_DATA.messages;
  if (count) count.textContent = `${msgs.length} frase${msgs.length !== 1 ? 's' : ''}`;
  if (!msgs.length) { list.innerHTML = '<div class="pl-empty">🎵 La playlist está vacía.</div>'; return; }
  list.innerHTML = msgs.map((f, i) => {
    const active = i === msgIdx ? ' pl-active' : '';
    const del = isAdmin ? `<button class="pl-del" data-id="${f.id}" title="Eliminar">🗑</button>` : '';
    return `<div class="pl-item${active}" data-i="${i}">
      <div class="pl-num">${i+1}</div>
      <div class="pl-content">
        <div class="pl-text">${f.frase}</div>
        <div class="pl-by">— ${f.autor} · ${relDate(f.created_at)}</div>
      </div>
      ${del}
    </div>`;
  }).join('');
  list.querySelectorAll('.pl-item').forEach(it => {
    it.addEventListener('click', e => { if (!e.target.closest('.pl-del')) goToMsg(parseInt(it.dataset.i)); });
  });
  list.querySelectorAll('.pl-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm("¿Eliminar esta frase?")) return;
      SHARED_DATA.messages = SHARED_DATA.messages.filter(x => x.id !== btn.dataset.id);
      await setDoc(doc(db, "shared", "messages"), { items: SHARED_DATA.messages });
      if (msgIdx >= SHARED_DATA.messages.length) msgIdx = Math.max(0, SHARED_DATA.messages.length-1);
      renderMessageWidget();
    });
  });
}

function wireMsgForm() {
  const btn = document.getElementById('msgPubBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener('click', publishMsg);
  }
  const nombre = document.getElementById('msgNombre');
  if (nombre) {
    const saved = localStorage.getItem('hero_msg_nombre');
    if (saved && !nombre.value) nombre.value = saved;
    if (!nombre.dataset.bound) {
      nombre.dataset.bound = "1";
      nombre.addEventListener('input', () => localStorage.setItem('hero_msg_nombre', nombre.value.trim()));
    }
  }
  const frase = document.getElementById('msgFrase');
  if (frase && !frase.dataset.bound) {
    frase.dataset.bound = "1";
    frase.addEventListener('input', () => {
      const cc = document.getElementById('msgChar');
      if (cc) { cc.textContent = `${frase.value.length}/200`; cc.classList.toggle('warn', frase.value.length > 180); }
    });
  }
  ['msgPrev','msgNext','msgRand','btnDelCurrent'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener('click', () => {
        if (id === 'msgPrev') prevMsg();
        if (id === 'msgNext') nextMsg();
        if (id === 'msgRand') randMsg();
        if (id === 'btnDelCurrent') deleteCurrent();
      });
    }
  });
}
async function publishMsg() {
  const nombre = document.getElementById('msgNombre').value.trim();
  const frase = document.getElementById('msgFrase').value.trim();
  if (!nombre) { alert("Ingresa tu nombre"); return; }
  if (frase.length < 10) { alert("La frase debe tener al menos 10 caracteres"); return; }
  const btn = document.getElementById('msgPubBtn');
  btn.disabled = true;
  try {
    const nueva = { id: crypto.randomUUID(), frase, autor: nombre, created_at: new Date().toISOString() };
    SHARED_DATA.messages.push(nueva);
    await setDoc(doc(db, "shared", "messages"), { items: SHARED_DATA.messages });
    document.getElementById('msgFrase').value = '';
    document.getElementById('msgChar').textContent = '0/200';
    msgIdx = SHARED_DATA.messages.length - 1;
    renderMessageWidget();
  } catch (e) { alert("Error al publicar: " + e.message); }
  finally { btn.disabled = false; }
}
async function deleteCurrent() {
  if (!isAdmin || !SHARED_DATA.messages.length) return;
  if (!confirm("¿Eliminar esta frase?")) return;
  SHARED_DATA.messages.splice(msgIdx, 1);
  await setDoc(doc(db, "shared", "messages"), { items: SHARED_DATA.messages });
  if (msgIdx >= SHARED_DATA.messages.length) msgIdx = Math.max(0, SHARED_DATA.messages.length-1);
  renderMessageWidget();
}

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
  const tEl = document.getElementById('greet-text');
  const nEl = document.getElementById('greet-name');
  if (tEl) tEl.textContent = custom || greet;
  if (nEl) nEl.textContent = firstName;
}
