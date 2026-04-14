import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

let currentUser = null;
let isAdmin = false;

// ══ AUTH ══
onAuthStateChanged(auth, async (user) => {
  if (!user) { showLogin(); return; }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    alert("Acceso restringido a cuentas @heroinsuranceusa.com");
    showLogin();
    return;
  }
  currentUser = user;
  isAdmin = ADMIN_EMAILS.includes(user.email);
  showDashboard();
});

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("dashboard").style.display = "none";
  if (window.refreshIcons) window.refreshIcons();
}

function showDashboard() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("user-avatar").src = currentUser.photoURL;
  if (isAdmin) document.getElementById("btn-admin").style.display = "inline-flex";

  initHeroCover();
  loadWidgets();

  if (window.refreshIcons) window.refreshIcons();
}

document.getElementById("btn-login")?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    document.getElementById("login-error").textContent = "Error: " + e.message;
  }
});
document.getElementById("btn-logout")?.addEventListener("click", () => signOut(auth));
document.getElementById("btn-settings")?.addEventListener("click", () => openSettings());

// ══ HERO COVER ══
function getFirstName(user) {
  if (user.displayName) return user.displayName.split(" ")[0];
  return user.email.split("@")[0].split(".")[0].charAt(0).toUpperCase() + user.email.split("@")[0].split(".")[0].slice(1);
}

function getDayKicker() {
  const day = new Date().getDay();
  const kickers = [
    "Domingo · Recargando superpoderes",
    "Lunes · A activar misiones",
    "Martes · Construyendo momentum",
    "Miércoles · Mitad de la misión",
    "Jueves · Empuje final semanal",
    "Viernes · Cerrando con gloria",
    "Sábado · Descansa, héroe"
  ];
  return kickers[day];
}

function getDaySub() {
  const day = new Date().getDay();
  const subs = [
    "Un nuevo día para hacer la diferencia.",
    "Cada llamada es una oportunidad de impactar una vida.",
    "El equipo está contigo. Dale con todo.",
    "Ya pasamos la mitad. El impulso es nuestro.",
    "Un día más cerca de lograrlo. Vamos.",
    "Terminemos la semana con el pie firme.",
    "Descansar también es parte de la misión."
  ];
  return subs[day];
}

function initHeroCover() {
  document.getElementById("greet-name").textContent = getFirstName(currentUser);
  document.getElementById("hero-kicker").textContent = getDayKicker();
  document.getElementById("hero-sub").textContent = getDaySub();

  // Issue number basado en los días desde Enero 1
  const start = new Date(new Date().getFullYear(), 0, 1);
  const diff = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24)) + 1;
  document.getElementById("hero-issue").textContent = `VOL. II · EDICIÓN Nº ${diff}`;

  // Date chip
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"short" });
  document.getElementById("meta-date").textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  // Clock
  updateClock();
  setInterval(updateClock, 60000);

  // Weather
  loadWeather();
}

function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  document.getElementById("meta-time").textContent = `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

async function loadWeather() {
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=25.7617&longitude=-80.1918&current=temperature_2m,weather_code&temperature_unit=fahrenheit");
    const data = await res.json();
    const t = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const icons = {0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌦️",55:"🌦️",61:"🌧️",63:"🌧️",65:"⛈️",71:"🌨️",73:"🌨️",75:"❄️",80:"🌧️",81:"🌧️",82:"⛈️",95:"⛈️"};
    document.getElementById("meta-weather-icon").textContent = icons[code] || "⛅";
    document.getElementById("meta-weather").textContent = `${t}°F`;
  } catch (e) {
    document.getElementById("meta-weather").textContent = "—";
  }
}

// ══ LOAD WIDGETS ══
async function loadWidgets() {
  // Cumpleaños, Spotlight, Mensajes — delegamos a widgets.js si existe
  if (window.initWidgets) {
    window.initWidgets(currentUser, isAdmin);
  }

  // Pop-up mensaje del día (después de 800ms para dejar que cargue todo)
  setTimeout(() => checkDailyPopup(), 800);
}

// ══ POP-UP MENSAJE DEL DÍA ══
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}

async function checkDailyPopup() {
  try {
    // 1. Verificar si el usuario ya vio hoy
    const userSnap = await getDoc(doc(db, "users", currentUser.email));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const lastSeen = userData.lastMessageSeenDate;
    const todayKey = getTodayKey();

    if (lastSeen === todayKey) return; // Ya lo vio hoy

    // 2. Cargar mensajes
    const msgSnap = await getDoc(doc(db, "shared", "messages"));
    if (!msgSnap.exists()) return;
    const items = msgSnap.data().items || [];
    if (!items.length) return;

    // 3. Elegir uno aleatorio DETERMINÍSTICO para el día
    const seed = hashString(todayKey);
    const idx = seed % items.length;
    const msg = items[idx];
    if (!msg) return;

    // 4. Mostrar popup
    showDailyPopup(msg, idx);
  } catch (e) {
    console.warn("Daily popup failed:", e.message);
  }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

let currentPopupMsgIdx = null;

function showDailyPopup(msg, idx) {
  currentPopupMsgIdx = idx;

  document.getElementById("dp-frase").textContent = msg.frase || "—";
  document.getElementById("dp-author-name").textContent = msg.autor || "Anónimo";

  // Avatar con iniciales
  const initials = (msg.autor || "A").split(" ").slice(0,2).map(w => w[0] || "").join("").toUpperCase();
  document.getElementById("dp-author-av").textContent = initials;

  // Fecha
  if (msg.created_at) {
    const d = new Date(msg.created_at);
    document.getElementById("dp-author-date").textContent = d.toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" });
  } else {
    document.getElementById("dp-author-date").textContent = "—";
  }

  // Reacciones: cargar las existentes
  renderReactions(msg);

  // Listener emojis
  document.querySelectorAll(".dp-react-btn").forEach(btn => {
    btn.onclick = () => reactToMessage(btn.dataset.emoji, idx);
  });

  // Mostrar popup
  document.getElementById("daily-popup").style.display = "flex";
  if (window.refreshIcons) window.refreshIcons();
}

function renderReactions(msg) {
  const reactions = msg.reactions || {};
  const summaryEl = document.getElementById("dp-reactions-summary");

  // Agrupar por emoji
  const byEmoji = {};
  Object.entries(reactions).forEach(([email, emoji]) => {
    if (!byEmoji[emoji]) byEmoji[emoji] = [];
    byEmoji[emoji].push(email);
  });

  // Mostrar chips
  summaryEl.innerHTML = Object.keys(byEmoji).length
    ? Object.entries(byEmoji).map(([emoji, emails]) => {
        const isMine = emails.includes(currentUser.email);
        const names = emails.map(e => e.split("@")[0].split(".")[0]).slice(0,3);
        const extra = emails.length > 3 ? ` +${emails.length-3}` : "";
        return `<div class="dp-react-chip ${isMine ? 'mine':''}">
          <span class="react-emoji">${emoji}</span>
          <span class="react-names">${names.join(", ")}${extra}</span>
        </div>`;
      }).join("")
    : `<span style="color:var(--muted);font-size:11.5px;">Sé el primero en reaccionar</span>`;

  // Marcar el botón seleccionado si el usuario ya reaccionó
  document.querySelectorAll(".dp-react-btn").forEach(btn => btn.classList.remove("selected"));
  const myReaction = reactions[currentUser.email];
  if (myReaction) {
    const myBtn = document.querySelector(`.dp-react-btn[data-emoji="${myReaction}"]`);
    if (myBtn) myBtn.classList.add("selected");
  }
}

async function reactToMessage(emoji, idx) {
  try {
    const msgSnap = await getDoc(doc(db, "shared", "messages"));
    if (!msgSnap.exists()) return;
    const items = msgSnap.data().items || [];
    if (!items[idx]) return;

    if (!items[idx].reactions) items[idx].reactions = {};

    // Si clickeó el mismo emoji, lo quita. Si no, lo cambia.
    if (items[idx].reactions[currentUser.email] === emoji) {
      delete items[idx].reactions[currentUser.email];
    } else {
      items[idx].reactions[currentUser.email] = emoji;
    }

    await updateDoc(doc(db, "shared", "messages"), { items });

    // Re-renderizar
    renderReactions(items[idx]);
  } catch (e) {
    alert("Error guardando reacción: " + e.message);
  }
}

document.getElementById("dp-close").addEventListener("click", async () => {
  // Marcar como visto
  try {
    await setDoc(doc(db, "users", currentUser.email), {
      lastMessageSeenDate: getTodayKey()
    }, { merge:true });
  } catch (e) { console.warn(e); }

  document.getElementById("daily-popup").style.display = "none";
});

// ══ SETTINGS ══
function openSettings() {
  const existing = document.getElementById("settings-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "settings-modal";
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal">
    <h3>⚙️ Configuración</h3>
    <label>Tema
      <select id="pref-theme">
        <option value="light">Claro</option>
        <option value="dark">Oscuro</option>
      </select>
    </label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="pref-cancel">Cancelar</button>
      <button class="btn-primary" id="pref-save">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Cargar valor actual
  const theme = document.body.dataset.theme || "light";
  modal.querySelector("#pref-theme").value = theme;

  modal.querySelector("#pref-cancel").onclick = () => modal.remove();
  modal.querySelector("#pref-save").onclick = async () => {
    const newTheme = modal.querySelector("#pref-theme").value;
    document.body.dataset.theme = newTheme;
    localStorage.setItem("hero-theme", newTheme);
    try {
      await setDoc(doc(db, "users", currentUser.email), { theme: newTheme }, { merge:true });
    } catch (e) { console.warn(e); }
    modal.remove();
  };
}

// Cargar tema al inicio
const savedTheme = localStorage.getItem("hero-theme");
if (savedTheme) document.body.dataset.theme = savedTheme;
