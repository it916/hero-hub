import { db, auth } from "./firebase-config.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const SHARED_DATA = {
  spotlight: { name: "Anny Medina", role: "COO", message: "Por su liderazgo excepcional en el cierre del Q1 2026." },
  birthdays: [
    { name: "Fernando Romero", date: "15 Nov" },
    { name: "Jesús Gutiérrez", date: "03 Abr" },
    { name: "Anny Medina", date: "22 Abr" },
    { name: "Aurys Rodriguez", date: "10 May" },
    { name: "Eduardo Romero", date: "28 May" }
  ],
  messages: [
    "El éxito es la suma de pequeños esfuerzos repetidos día tras día.",
    "Un equipo unido es imparable. ¡Gracias por ser parte de Hero!",
    "Cada cliente atendido con excelencia es una historia de éxito.",
    "La constancia vence lo que la dicha no alcanza."
  ],
  defaultTools: [
    { label: "Gmail", url: "https://mail.google.com", icon: "📧" },
    { label: "Drive", url: "https://drive.google.com", icon: "📁" },
    { label: "Calendar", url: "https://calendar.google.com", icon: "📅" },
    { label: "Hub Agentes", url: "https://hub.heroinsuranceusa.com", icon: "👥" }
  ]
};

const WIDGET_DEFS = {
  spotlight: { title: "🌟 Hero Spotlight", render: renderSpotlight },
  birthdays: { title: "🎂 Cumpleaños del equipo", render: renderBirthdays },
  messages:  { title: "💬 Mensaje del día", render: renderMessages },
  tools:     { title: "🛠️ Mis herramientas", render: renderTools }
};

let currentUserData = null;

export function renderWidgets(userData) {
  currentUserData = userData;
  if (!userData.shortcuts || userData.shortcuts.length === 0) {
    userData.shortcuts = [...SHARED_DATA.defaultTools];
  }
  // Aplicar tema
  document.body.dataset.theme = userData.theme || "light";
  // Aplicar saludo
  document.getElementById("user-greeting").textContent =
    userData.greeting || `¡Hola, ${auth.currentUser.displayName.split(" ")[0]}!`;

  const container = document.getElementById("widgets-container");
  container.innerHTML = "";
  const order = userData.widgetOrder || Object.keys(WIDGET_DEFS);
  const hidden = userData.hiddenWidgets || [];

  order.forEach(key => {
    if (hidden.includes(key) || !WIDGET_DEFS[key]) return;
    const card = document.createElement("section");
    card.className = "widget-card";
    card.dataset.widget = key;
    card.innerHTML = `
      <h2 class="widget-title">
        <span class="drag-handle" title="Arrastra para reordenar">⋮⋮</span>
        ${WIDGET_DEFS[key].title}
      </h2>
      <div class="widget-body">${WIDGET_DEFS[key].render(userData)}</div>
    `;
    container.appendChild(card);
  });

  Sortable.create(container, { handle: ".drag-handle", animation: 180, ghostClass: "widget-ghost", onEnd: saveOrder });
  attachToolHandlers();
  attachSettingsHandler();
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
  return `<div class="spotlight"><div class="spotlight-name">${s.name}</div><div class="spotlight-role">${s.role}</div><p class="spotlight-msg">${s.message}</p></div>`;
}
function renderBirthdays() {
  return `<ul class="bday-list">${SHARED_DATA.birthdays.map(b => `<li><span>${b.name}</span><strong>${b.date}</strong></li>`).join("")}</ul>`;
}
function renderMessages() {
  const idx = new Date().getDate() % SHARED_DATA.messages.length;
  return `<p class="motivational">"${SHARED_DATA.messages[idx]}"</p>`;
}
function renderTools(userData) {
  const tools = userData.shortcuts || [];
  return `<div class="tools-grid">${tools.map((t, i) => `
    <div class="tool-link-wrapper">
      <a href="${t.url}" target="_blank" class="tool-link">
        <span class="tool-icon">${t.icon || "🔗"}</span>
        <span class="tool-label">${t.label}</span>
      </a>
      <button class="tool-delete" data-index="${i}" title="Eliminar">×</button>
    </div>`).join("")}
    <button class="tool-add" title="Agregar"><span class="tool-icon">➕</span><span class="tool-label">Agregar</span></button>
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
    <label>Nombre <input id="t-label" placeholder="Ej: Slack" maxlength="20"></label>
    <label>URL <input id="t-url" placeholder="https://..." type="url"></label>
    <label>Ícono (emoji) <input id="t-icon" placeholder="🔗" maxlength="2"></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="t-cancel">Cancelar</button>
      <button class="btn-primary" id="t-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#t-cancel").onclick = () => modal.remove();
  modal.querySelector("#t-save").onclick = async () => {
    const label = modal.querySelector("#t-label").value.trim();
    const url = modal.querySelector("#t-url").value.trim();
    const icon = modal.querySelector("#t-icon").value.trim() || "🔗";
    if (!label || !url) { alert("Nombre y URL son requeridos"); return; }
    currentUserData.shortcuts.push({ label, url, icon });
    await saveUserField({ shortcuts: currentUserData.shortcuts });
    modal.remove();
    renderWidgets(currentUserData);
  };
}

function attachSettingsHandler() {
  const btn = document.getElementById("btn-settings");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", openSettingsModal);
  }
}

function openSettingsModal() {
  const hidden = currentUserData.hiddenWidgets || [];
  const theme = currentUserData.theme || "light";
  const greeting = currentUserData.greeting || "";

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>⚙️ Configuración</h3>

    <label>Saludo personalizado
      <input id="s-greeting" value="${greeting.replace(/"/g, '&quot;')}" maxlength="50">
    </label>

    <label>Tema
      <div class="theme-toggle">
        <button class="theme-btn ${theme === 'light' ? 'active' : ''}" data-theme="light">☀️ Claro</button>
        <button class="theme-btn ${theme === 'dark' ? 'active' : ''}" data-theme="dark">🌙 Oscuro</button>
      </div>
    </label>

    <label>Widgets visibles</label>
    <div class="widget-toggles">
      ${Object.keys(WIDGET_DEFS).map(key => `
        <label class="checkbox-row">
          <input type="checkbox" data-widget="${key}" ${hidden.includes(key) ? '' : 'checked'}>
          ${WIDGET_DEFS[key].title}
        </label>
      `).join("")}
    </div>

    <div class="modal-buttons">
      <button class="btn-primary" id="s-close">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Saludo
  modal.querySelector("#s-greeting").addEventListener("blur", async (e) => {
    currentUserData.greeting = e.target.value.trim();
    await saveUserField({ greeting: currentUserData.greeting });
  });

  // Tema
  modal.querySelectorAll(".theme-btn").forEach(b => {
    b.addEventListener("click", async () => {
      const newTheme = b.dataset.theme;
      currentUserData.theme = newTheme;
      document.body.dataset.theme = newTheme;
      modal.querySelectorAll(".theme-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      await saveUserField({ theme: newTheme });
    });
  });

  // Widgets
  modal.querySelectorAll(".widget-toggles input").forEach(cb => {
    cb.addEventListener("change", async () => {
      const key = cb.dataset.widget;
      let hidden = currentUserData.hiddenWidgets || [];
      if (cb.checked) hidden = hidden.filter(w => w !== key);
      else if (!hidden.includes(key)) hidden.push(key);
      currentUserData.hiddenWidgets = hidden;
      await saveUserField({ hiddenWidgets: hidden });
    });
  });

  modal.querySelector("#s-close").onclick = () => {
    modal.remove();
    renderWidgets(currentUserData);
  };
}
