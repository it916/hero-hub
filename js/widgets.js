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
  const theme = currentUserData.theme || "light";
  document.body.dataset.theme = theme;
  // Cachear el tema en localStorage para que las subpáginas lo apliquen
  // al instante (vía el script inline en <body>) sin esperar a Firestore.
  try { localStorage.setItem("hero-theme", theme); } catch (e) {}

  renderArsenal();
  renderSpotlight();
  renderBirthday();
  renderMessageWidget();
  attachUserMenu();
  if (window.refreshIcons) window.refreshIcons();
}

// Dropdown del avatar en el topbar. Muestra header con foto+nombre+email+rol,
// link a Mi perfil y botón Cerrar sesión (dispara #btn-logout que ya tiene el
// handler de signOut en auth.js — así reusamos sin importar Firebase acá).
function attachUserMenu() {
  const btn = document.getElementById("user-avatar-btn");
  const menu = document.getElementById("user-menu");
  if (!btn || !menu || btn.dataset.bound) return;
  btn.dataset.bound = "1";

  const user = auth.currentUser;
  if (user) {
    const nameEl  = document.getElementById("user-menu-name");
    const emailEl = document.getElementById("user-menu-email");
    const photoEl = document.getElementById("user-menu-avatar");
    if (nameEl)  nameEl.textContent  = user.displayName || user.email.split("@")[0];
    if (emailEl) emailEl.textContent = user.email;
    if (photoEl && user.photoURL) photoEl.src = user.photoURL;

    // Rol: leer del body class que aplicó auth.js (patrón role-{nombre}).
    // Además, si es admin, hacer visible el ítem "Admin" del menú.
    const roleClass = [...document.body.classList].find(c => c.startsWith("role-"));
    if (roleClass) {
      const roleName = roleClass.replace("role-", "");
      const roleEl = document.getElementById("user-menu-role");
      if (roleEl) {
        roleEl.textContent = roleName.toUpperCase();
        roleEl.hidden = false;
      }
      if (roleName === "admin") {
        const adminItem = document.getElementById("user-menu-admin");
        if (adminItem) adminItem.hidden = false;
      }
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    }
  });

  const logoutBtn = document.getElementById("user-menu-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const legacyLogoutBtn = document.getElementById("btn-logout");
      if (legacyLogoutBtn) legacyLogoutBtn.click();
    });
  }

  // Ítem de tema día/noche: setea el ícono/label inicial y bindea el toggle.
  syncThemeMenuItem();
  const themeItem = document.getElementById("user-menu-theme");
  if (themeItem) themeItem.addEventListener("click", toggleHubTheme);
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
  container.innerHTML = `<div class="arsenal-grid-2x2">
    ${groups.map(g => {
      const items = arsenal[g.key] || [];
      return `<div class="arsenal-square-card arsenal-${g.cls}">
        <div class="asc-header"><span class="asc-dot"></span>${g.label}</div>
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
    }).join("")}
  </div>`;

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
  const dialog = document.createElement("sl-dialog");
  dialog.label = `✦ Nuevo acceso · ${group}`;
  dialog.className = "hh-dialog hh-tool-dialog";
  dialog.innerHTML = `
    <div class="hh-form">
      <sl-input id="t-label" label="Nombre" maxlength="20" clearable required></sl-input>
      <sl-input id="t-url" label="URL" type="url" placeholder="https://..." clearable required></sl-input>
      <sl-input id="t-icon" label="URL del ícono (PNG/SVG)" type="url" placeholder="https://..." clearable></sl-input>
    </div>
    <sl-button slot="footer" id="t-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="t-save" variant="primary">
      <i data-lucide="plus" slot="prefix" style="width:14px;height:14px;"></i>
      Guardar
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  dialog.addEventListener("sl-after-hide", () => dialog.remove());
  dialog.querySelector("#t-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#t-save").addEventListener("click", async () => {
    const label = (dialog.querySelector("#t-label").value || "").trim();
    const url = (dialog.querySelector("#t-url").value || "").trim();
    const icon = (dialog.querySelector("#t-icon").value || "").trim()
      || "https://cdn-icons-png.flaticon.com/512/1006/1006771.png";
    if (!label || !url) { alert("Nombre y URL requeridos"); return; }

    const arsenal = (currentUserData.arsenal && Object.keys(currentUserData.arsenal).length)
      ? currentUserData.arsenal
      : JSON.parse(JSON.stringify(ARSENAL_DEFAULT));
    if (!arsenal[group]) arsenal[group] = [];
    arsenal[group].push({ label, url, icon });
    currentUserData.arsenal = arsenal;
    await saveUserField({ arsenal });
    dialog.hide();
    renderArsenal();
    if (window.refreshIcons) window.refreshIcons();
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
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

// Estado del confeti (se limpia al re-renderizar)
let bdayConfettiAdded = false;

function bdaySpawnConfetti() {
  const card = document.getElementById('bdayCard');
  if (!card || bdayConfettiAdded) return;
  const COLORS = ['#06a3b6','#3dbccc','#ffc83d','#ff7a59','#ff5d8f','#4fd1b8'];
  for (let i = 0; i < 24; i++) {
    const c = document.createElement('div');
    c.className = 'bdc-confetti';
    c.style.left = (Math.random() * 100) + '%';
    c.style.background = COLORS[i % COLORS.length];
    c.style.animationDuration = (3 + Math.random() * 3) + 's';
    c.style.animationDelay = (Math.random() * 4) + 's';
    if (i % 2 === 0) c.style.borderRadius = '50%';
    card.appendChild(c);
  }
  bdayConfettiAdded = true;
}

function bdayClearConfetti() {
  const card = document.getElementById('bdayCard');
  if (!card) return;
  card.querySelectorAll('.bdc-confetti').forEach(c => c.remove());
  bdayConfettiAdded = false;
}

function renderBirthday() {
  const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

  const withBirthday = SHARED_DATA.team
    .map(m => {
      const date = parseBirthdate(m.birthdate);
      return date ? { p: {...m, date}, d: daysUntil(date) } : null;
    })
    .filter(x => x !== null)
    .sort((a,b) => a.d - b.d);

  const el = id => document.getElementById(id);
  const mega = document.querySelector('.bday-mega');

  if (!withBirthday.length) {
    if (el('bdayName')) el('bdayName').textContent = '—';
    if (el('bdayRole')) el('bdayRole').textContent = 'Sin cumpleaños registrados';
    if (el('bdayBadge')) el('bdayBadge').textContent = '🎈 Próximo cumpleaños';
    if (el('bdayDate')) el('bdayDate').textContent = '—';
    return;
  }

  const { p, d } = withBirthday[0];
  const isToday = d === 0, isTomorrow = d === 1;

  // Marcar "today" para activar efectos especiales
  if (mega) mega.classList.toggle('today', isToday);

  if (el('bdayAvatar')) {
    el('bdayAvatar').src = p.photo;
    el('bdayAvatar').onerror = function(){ this.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=06a3b6&color=fff&size=200`; };
  }
  // Eyebrow dinámico según estado
  if (el('bdayBadge')) {
    el('bdayBadge').textContent =
      isToday    ? 'Hoy celebramos a' :
      isTomorrow ? 'Mañana celebramos a' :
                   'Próximamente celebramos a';
  }
  if (el('bdayName')) el('bdayName').textContent = p.name;
  if (el('bdayRole')) el('bdayRole').textContent = p.role || '';
  if (el('bdayDate')) {
    // Formato legible: "23 de noviembre"
    const MESES_FULL = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    el('bdayDate').textContent = `${p.date.d} de ${MESES_FULL[p.date.m-1]}`;
  }
  // Caja única de días restantes (singular/plural; mensaje especial si es hoy)
  if (el('cdDays') && el('cdDaysLabel')) {
    if (isToday) {
      el('cdDays').textContent = '🎂';
      el('cdDaysLabel').textContent = '¡Hoy!';
    } else {
      el('cdDays').textContent = d;
      el('cdDaysLabel').textContent = d === 1 ? 'Día' : 'Días';
    }
  }

  // Confeti: solo el día del cumple
  if (isToday) bdaySpawnConfetti();
  else bdayClearConfetti();
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

// Toggle día/noche desde el ítem del menú del avatar (antes vivía como
// botón separado en el topbar). Un click alterna, actualiza el ícono y
// el label del ítem, y guarda en Firestore + localStorage.
async function toggleHubTheme() {
  const current = document.body.dataset.theme || "light";
  const next = current === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  currentUserData.theme = next;
  try { localStorage.setItem("hero-theme", next); } catch (e) {}
  syncThemeMenuItem();
  await saveUserField({ theme: next });
}

function syncThemeMenuItem() {
  const item = document.getElementById("user-menu-theme");
  if (!item) return;
  const theme = document.body.dataset.theme || "light";
  const icon = theme === "dark" ? "sun" : "moon";
  const label = theme === "dark" ? "Cambiar a día" : "Cambiar a noche";
  item.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  if (window.refreshIcons) window.refreshIcons();
}
