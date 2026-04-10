import { db } from "./firebase-config.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth } from "./firebase-config.js";

const SHARED_DATA = {
  spotlight: {
    title: "Hero del Mes",
    name: "Anny Medina",
    role: "COO",
    message: "Por su liderazgo excepcional en el cierre del Q1 2026."
  },
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
  tools: [
    { label: "Gmail", url: "https://mail.google.com", icon: "📧" },
    { label: "Drive", url: "https://drive.google.com", icon: "📁" },
    { label: "Calendar", url: "https://calendar.google.com", icon: "📅" },
    { label: "Hub Agentes", url: "https://hub.heroinsuranceusa.com", icon: "👥" },
    { label: "IT Console", url: "https://it916.github.io/hero-it-console/", icon: "🛠️" }
  ]
};

const WIDGET_DEFS = {
  spotlight: { title: "🌟 Hero Spotlight", render: renderSpotlight },
  birthdays: { title: "🎂 Cumpleaños del equipo", render: renderBirthdays },
  messages:  { title: "💬 Mensaje del día",      render: renderMessages },
  tools:     { title: "🛠️ Mis herramientas",     render: renderTools }
};

export function renderWidgets(userData) {
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

  // Activar drag & drop
  Sortable.create(container, {
    handle: ".drag-handle",
    animation: 180,
    ghostClass: "widget-ghost",
    onEnd: saveOrder
  });
}

async function saveOrder() {
  const cards = document.querySelectorAll("#widgets-container .widget-card");
  const newOrder = Array.from(cards).map(c => c.dataset.widget);
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, "users", user.email), { widgetOrder: newOrder });
    console.log("Orden guardado:", newOrder);
  } catch (e) {
    console.error("Error guardando orden:", e);
  }
}

function renderSpotlight() {
  const s = SHARED_DATA.spotlight;
  return `<div class="spotlight">
    <div class="spotlight-name">${s.name}</div>
    <div class="spotlight-role">${s.role}</div>
    <p class="spotlight-msg">${s.message}</p>
  </div>`;
}

function renderBirthdays() {
  return `<ul class="bday-list">${
    SHARED_DATA.birthdays.map(b =>
      `<li><span>${b.name}</span><strong>${b.date}</strong></li>`
    ).join("")
  }</ul>`;
}

function renderMessages() {
  const idx = new Date().getDate() % SHARED_DATA.messages.length;
  return `<p class="motivational">"${SHARED_DATA.messages[idx]}"</p>`;
}

function renderTools(userData) {
  const userTools = (userData.shortcuts && userData.shortcuts.length)
    ? userData.shortcuts
    : SHARED_DATA.tools;
  return `<div class="tools-grid">${
    userTools.map(t =>
      `<a href="${t.url}" target="_blank" class="tool-link">
        <span class="tool-icon">${t.icon || "🔗"}</span>
        <span class="tool-label">${t.label}</span>
      </a>`
    ).join("")
  }</div>`;
}
