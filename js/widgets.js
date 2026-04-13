import { db, auth } from "./firebase-config.js";
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let SHARED_DATA = {
  spotlight: { name: "—", role: "", message: "" },
  birthdays: [], messages: [],
  defaultTools: [
    { label: "Gmail", url: "https://mail.google.com", icon: "mail" },
    { label: "Drive", url: "https://drive.google.com", icon: "hard-drive" },
    { label: "Calendar", url: "https://calendar.google.com", icon: "calendar" },
    { label: "Hub Agentes", url: "https://hub.heroinsuranceusa.com", icon: "users" }
  ]
};

const WIDGET_DEFS = {
  spotlight: { title: "Hero Spotlight",       icon: "award",       render: renderSpotlight },
  birthdays: { title: "Cumpleaños del equipo", icon: "cake",        render: renderBirthdays },
  messages:  { title: "Mensaje del día",       icon: "quote",       render: renderMessages },
  tools:     { title: "Mis herramientas",      icon: "layout-grid", render: renderTools }
};

let currentUserData = null;

async function loadSharedData() {
  try {
    const [sp, bd, ms] = await Promise.all([
      getDoc(doc(db, "shared", "spotlight")),
      getDoc(doc(db, "shared", "birthdays")),
      getDoc(doc(db, "shared", "messages"))
    ]);
    if (sp.exists()) SHARED_DATA.spotlight = sp.data();
    if (bd.exists()) SHARED_DATA.birthdays = bd.data().items || [];
    if (ms.exists()) SHARED_DATA.messages = ms.data().items || [];
  } catch (e) { console.error("Error leyendo shared:", e); }
}

export async function renderWidgets(userData) {
  currentUserData = userData;
  await loadSharedData();
  if (!userData.shortcuts || userData.shortcuts.length === 0) {
    userData.shortcuts = [...SHARED_DATA.defaultTools];
  }
  document.body.dataset.theme = userData.theme || "light";
  document.getElementById("user-greeting").textContent =
    userData.greeting || `Hola, ${auth.currentUser.displayName.split(" ")[0]}`;

  const container = document.getElementById("widgets-container");
  container.innerHTML = "";
  const order = userData.widgetOrder || Object.keys(WIDGET_DEFS);
  const hidden = userData.hiddenWidgets || [];

  order.forEach(key => {
    if (hidden.includes(key) || !WIDGET_DEFS[key]) return;
    const def = WIDGET_DEFS[key];
    const card = document.createElement("section");
    card.className = "widget-card";
    card.dataset.widget = key;
    card.innerHTML = `
      <div class="widget-title">
        <i data-lucide="${def.icon}" class="widget-title-icon"></i>
        <span>${def.title}</span>
        <span class="drag-handle" title="Arrastra"><i data-lucide="grip-vertical" class="w-4 h-4"></i></span>
      </div>
      ${def.render(userData)}`;
    container.appendChild(card);
  });

  Sortable.create(container, { handle: ".drag-handle", animation: 200, ghostClass: "widget-ghost", onEnd: saveOrder });
  attachToolHandlers();
  attachSettingsHandler();
  if (window.refreshIcons) window.refreshIcons();
}

async function saveOrder() {
  const cards = document.querySelectorAll("#widgets-container .widget-card");
  await saveUserField({ widgetOrder: Array.from(cards).map(c => c.dataset.widget) });
}
async function saveUserField(fields) {
  const user = auth.currentUser;
  if (!user) return;
  try { await updateDoc(doc(db, "users", user.email), fields); }
  catch (e) { console.error("Error guardando:", e); }
}

function renderSpotlight() {
  const s = SHARED_DATA.spotlight;
  return `<div class="spotlight-card">
    <span class="spotlight-badge"><i data-lucide="sparkles" class="w-3 h-3"></i> Hero del mes</span>
    <div class="spotlight-name">${s.name||"—"}</div>
    <div class="spotlight-role">${s.role||""}</div>
    ${s.message ? `<p class="spotlight-msg">${s.message}</p>` : ""}
  </div>`;
}
function renderBirthdays() {
  if (!SHARED_DATA.birthdays.length) return `<p class="empty">Sin cumpleaños registrados.</p>`;
  return `<ul class="bday-list">${SHARED_DATA.birthdays.map(b =>
    `<li><span class="bday-name">${b.name}</span><span class="bday-date">${b.date}</span></li>`
  ).join("")}</ul>`;
}
function renderMessages() {
  if (!SHARED_DATA.messages.length) return `<p class="empty">Sin mensajes.</p>`;
  const idx = new Date().getDate() % SHARED_DATA.messages.length;
  return `<div class="motivational-card"><p class="motivational">${SHARED_DATA.messages[idx]}</p></div>`;
}
function renderTools(userData) {
  const tools = userData.shortcuts || [];
  return `<div class="tools-grid">${tools.map((t,i) => `
    <div class="tool-link-wrapper">
      <a href="${t.url}" target="_blank" class="tool-link">
        <span class="tool-icon-wrap"><i data-lucide="${t.icon||'link'}" class="w-5 h-5"></i></span>
        <span class="tool-label">${t.label}</span>
      </a>
      <button class="tool-delete" data-index="${i}" title="Eliminar">×</button>
    </div>`).join("")}
    <button class="tool-add">
      <span class="tool-icon-wrap"><i data-lucide="plus" class="w-5 h-5"></i></span>
      <span class="tool-label">Agregar</span>
    </button>
  </div>`;
}

function attachToolHandlers() {
  const addBtn = document.querySelector(".tool-add");
  if (addBtn) addBtn.addEventListener("click", openAddModal);
  document.querySelectorAll(".tool-delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("¿Eliminar este acceso?")) return;
      currentUserData.shortcuts.splice(parseInt(btn.dataset.index), 1);
      await saveUserField({ shortcuts: currentUserData.shortcuts });
      renderWidgets(currentUserData);
    });
  });
}
function openAddModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>Nuevo acceso rápido</h3>
    <label>Nombre <input id="t-label" maxlength="20" placeholder="Slack"></label>
    <label>URL <input id="t-url" type="url" placeholder="https://..."></label>
    <label>Ícono (nombre lucide) <input id="t-icon" placeholder="link, slack, github..." maxlength="30"></label>
    <div class="modal-buttons"><button class="btn-ghost-dark" id="t-cancel">Cancelar</button><button class="btn-primary" id="t-save">Guardar</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#t-cancel").onclick = () => modal.remove();
  modal.querySelector("#t-save").onclick = async () => {
    const label = modal.querySelector("#t-label").value.trim();
    const url = modal.querySelector("#t-url").value.trim();
    const icon = modal.querySelector("#t-icon").value.trim() || "link";
    if (!label || !url) { alert("Nombre y URL requeridos"); return; }
    currentUserData.shortcuts.push({ label, url, icon });
    await saveUserField({ shortcuts: currentUserData.shortcuts });
    modal.remove();
    renderWidgets(currentUserData);
  };
}

function attachSettingsHandler() {
  const btn = document.getElementById("btn-settings");
  if (btn && !btn.dataset.bound) { btn.dataset.bound = "1"; btn.addEventListener("click", openSettingsModal); }
}
function openSettingsModal() {
  const hidden = currentUserData.hiddenWidgets || [];
  const theme = currentUserData.theme || "light";
  const greeting = currentUserData.greeting || "";
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>Configuración</h3>
    <label>Saludo personalizado <input id="s-greeting" value="${greeting.replace(/"/g,'&quot;')}" maxlength="50"></label>
    <label>Tema<div class="theme-toggle">
      <button class="theme-btn ${theme==='light'?'active':''}" data-theme="light">☀ Claro</button>
      <button class="theme-btn ${theme==='dark'?'active':''}" data-theme="dark">☾ Oscuro</button>
    </div></label>
    <label>Widgets visibles</label>
    <div class="widget-toggles">${Object.keys(WIDGET_DEFS).map(k => `
      <label class="checkbox-row"><input type="checkbox" data-widget="${k}" ${hidden.includes(k)?'':'checked'}>${WIDGET_DEFS[k].title}</label>`).join("")}</div>
    <div class="modal-buttons"><button class="btn-primary" id="s-close">Cerrar</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#s-greeting").addEventListener("blur", async (e) => {
    currentUserData.greeting = e.target.value.trim();
    await saveUserField({ greeting: currentUserData.greeting });
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
  modal.querySelectorAll(".widget-toggles input").forEach(cb => {
    cb.addEventListener("change", async () => {
      let h = currentUserData.hiddenWidgets || [];
      if (cb.checked) h = h.filter(w => w !== cb.dataset.widget);
      else if (!h.includes(cb.dataset.widget)) h.push(cb.dataset.widget);
      currentUserData.hiddenWidgets = h;
      await saveUserField({ hiddenWidgets: h });
    });
  });
  modal.querySelector("#s-close").onclick = () => { modal.remove(); renderWidgets(currentUserData); };
}
