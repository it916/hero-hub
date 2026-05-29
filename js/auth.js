import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets } from "./widgets.js";
import { openBirthdayCardModal, checkBirthdayPopup } from "./birthday-card.js";
import { loadUserRole, filterTopbarByRole, isAdmin as isAdminRole, clearRoleCache, canAccessPage } from "./roles.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

let currentUser = null;
let currentUserRole = null;  // Objeto { role, definition } del sistema de roles
let isAdmin = false;
let teamMembers = [];

// ══ AUTH ══
onAuthStateChanged(auth, async (user) => {
  if (!user) { showLogin(); return; }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    alert("Acceso restringido a cuentas @heroinsuranceusa.com");
    showLogin();
    return;
  }

  // Cargar el rol del usuario desde Firestore (sistema de roles)
  const roleInfo = await loadUserRole(user.email);
  if (!roleInfo) {
    await signOut(auth);
    alert(
      `La cuenta ${user.email} no tiene un rol asignado en el Hero Hub.\n\n` +
      `Contacta a IT para que te asignen permisos.`
    );
    showLogin();
    return;
  }

  currentUser = user;
  currentUserRole = roleInfo;
  isAdmin = isAdminRole(roleInfo);
  showDashboard();
});

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("dashboard").style.display = "none";
  if (window.refreshIcons) window.refreshIcons();
}

// Devuelve la foto más fresca de Google: prioriza la del provider —que
// Firebase refresca en cada login— sobre el perfil top-level, que puede
// quedar cacheado con una URL vieja desde el primer inicio de sesión.
function getGooglePhotoURL(user) {
  const g = user?.providerData?.find(p => p.providerId === "google.com");
  return (g && g.photoURL) || user?.photoURL || "";
}

async function showDashboard() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  try { await currentUser.reload(); } catch (e) { /* sin refrescar: usamos lo cacheado */ }
  document.getElementById("user-avatar").src = getGooglePhotoURL(auth.currentUser || currentUser);

  // Filtrar el topbar según el rol del usuario
  // (oculta links a páginas no permitidas y maneja el botón admin)
  filterTopbarByRole(currentUserRole);

  // Marcar el body con el rol para que el CSS pueda mostrar/ocultar widgets
  // (ej. tarjeta de Portales solo para "agente", celebraciones ocultas para "agente", etc.)
  document.body.classList.add(`role-${currentUserRole.role}`);

  // Ocultar el banner de Onboarding si el rol no tiene acceso a esa página
  // (evita que el usuario haga clic y termine redirigido por page-guard.js).
  if (!canAccessPage("onboarding", currentUserRole)) {
    const obBanner = document.getElementById("ob-welcome");
    if (obBanner) {
      obBanner.style.display = "none";
      const prevConnector = obBanner.previousElementSibling;
      if (prevConnector && prevConnector.classList.contains("connector")) {
        prevConnector.style.display = "none";
      }
    }
  }

  // Cargar datos del usuario desde Firestore
  let userData = {};
  try {
    const userSnap = await getDoc(doc(db, "users", currentUser.email));
    if (userSnap.exists()) userData = userSnap.data();
  } catch (e) { console.warn("Error cargando user data:", e.message); }

  // Cargar equipo (para pop-up de cumple y botón felicitación)
  try {
    const teamSnap = await getDoc(doc(db, "shared", "team"));
    if (teamSnap.exists() && Array.isArray(teamSnap.data().members)) {
      teamMembers = teamSnap.data().members;
    }
  } catch (e) { console.warn("Error cargando equipo:", e.message); }

  initHeroCover();

  // Renderizar widgets (arsenal, spotlight, cumple, mensajes)
  await renderWidgets(userData);

  // Conectar botón "Preparar felicitación"
  wireBirthdayButton();

  // Pop-up mensaje del día
  setTimeout(() => checkDailyPopup(), 1200);

  // Pop-up cumpleaños del día (si corresponde)
  setTimeout(() => checkBirthdayPopup(currentUser, teamMembers), 1800);

  if (window.refreshIcons) window.refreshIcons();
}

document.getElementById("btn-login")?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    document.getElementById("login-error").textContent = "Error: " + e.message;
  }
});
document.getElementById("btn-logout")?.addEventListener("click", () => {
  clearRoleCache();
  signOut(auth);
});

// ══ Botón Preparar Felicitación ══
function wireBirthdayButton() {
  const btn = document.getElementById("bdayWishBtn");
  if (!btn) return;
  btn.onclick = () => {
    // Determinar al cumpleañero próximo (el mismo que muestra el banner)
    const person = findNextBirthday();
    if (!person) {
      alert("No hay cumpleaños próximos registrados.");
      return;
    }
    openBirthdayCardModal(person, currentUser);
  };
}

function findNextBirthday() {
  const today = new Date();
  today.setHours(0,0,0,0);

  const withDates = teamMembers
    .map(m => {
      if (!m.birthdate || !/^\d{2}-\d{2}$/.test(m.birthdate)) return null;
      const [mo, d] = m.birthdate.split('-').map(x => parseInt(x));
      const thisYear = new Date(today.getFullYear(), mo-1, d);
      const target = thisYear >= today ? thisYear : new Date(today.getFullYear()+1, mo-1, d);
      const days = Math.ceil((target - today) / (1000*60*60*24));
      return { m, days };
    })
    .filter(x => x !== null)
    .sort((a, b) => a.days - b.days);

  return withDates.length ? withDates[0].m : null;
}

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
  const greetNameEl = document.getElementById("greet-name");
  const heroKickerEl = document.getElementById("hero-kicker");
  const heroSubEl = document.getElementById("hero-sub");
  const heroIssueEl = document.getElementById("hero-issue");
  const metaDateEl = document.getElementById("meta-date");

  if (greetNameEl) greetNameEl.textContent = getFirstName(currentUser);
  if (heroKickerEl) heroKickerEl.textContent = getDayKicker();
  if (heroSubEl) heroSubEl.textContent = getDaySub();

  const start = new Date(new Date().getFullYear(), 0, 1);
  const diff = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24)) + 1;
  if (heroIssueEl) heroIssueEl.textContent = `VOL. II · EDICIÓN Nº ${diff}`;

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"short" });
  if (metaDateEl) metaDateEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  updateClock();
  setInterval(updateClock, 60000);
  loadWeather();
}

function updateClock() {
  const el = document.getElementById("meta-time");
  if (!el) return;
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  el.textContent = `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

async function loadWeather() {
  const iconEl = document.getElementById("meta-weather-icon");
  const tempEl = document.getElementById("meta-weather");
  if (!iconEl || !tempEl) return;
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=25.7617&longitude=-80.1918&current=temperature_2m,weather_code&temperature_unit=fahrenheit");
    const data = await res.json();
    const t = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const icons = {0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌦️",55:"🌦️",61:"🌧️",63:"🌧️",65:"⛈️",71:"🌨️",73:"🌨️",75:"❄️",80:"🌧️",81:"🌧️",82:"⛈️",95:"⛈️"};
    iconEl.textContent = icons[code] || "⛅";
    tempEl.textContent = `${t}°F`;
  } catch (e) {
    tempEl.textContent = "—";
  }
}

// ══ POP-UP MENSAJE DEL DÍA ══
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}

async function checkDailyPopup() {
  try {
    const userSnap = await getDoc(doc(db, "users", currentUser.email));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const lastSeen = userData.lastMessageSeenDate;
    const todayKey = getTodayKey();

    if (lastSeen === todayKey) return;

    const msgSnap = await getDoc(doc(db, "shared", "messages"));
    if (!msgSnap.exists()) return;
    const items = msgSnap.data().items || [];
    if (!items.length) return;

    const seed = hashString(todayKey);
    const idx = seed % items.length;
    const msg = items[idx];
    if (!msg) return;

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

function showDailyPopup(msg, idx) {
  const fraseEl = document.getElementById("dp-frase");
  const nameEl = document.getElementById("dp-author-name");
  const avEl = document.getElementById("dp-author-av");
  const dateEl = document.getElementById("dp-author-date");
  const popup = document.getElementById("daily-popup");

  if (!popup || !fraseEl) return;

  fraseEl.textContent = msg.frase || "—";
  nameEl.textContent = msg.autor || "Anónimo";

  const initials = (msg.autor || "A").split(" ").slice(0,2).map(w => w[0] || "").join("").toUpperCase();
  avEl.textContent = initials;

  if (msg.created_at) {
    const d = new Date(msg.created_at);
    dateEl.textContent = d.toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" });
  } else {
    dateEl.textContent = "—";
  }

  renderReactions(msg);

  document.querySelectorAll(".dp-react-btn").forEach(btn => {
    btn.onclick = () => reactToMessage(btn.dataset.emoji, idx);
  });

  popup.style.display = "flex";
  if (window.refreshIcons) window.refreshIcons();
}

function renderReactions(msg) {
  const reactions = msg.reactions || {};
  const summaryEl = document.getElementById("dp-reactions-summary");
  if (!summaryEl) return;

  const byEmoji = {};
  Object.entries(reactions).forEach(([email, emoji]) => {
    if (!byEmoji[emoji]) byEmoji[emoji] = [];
    byEmoji[emoji].push(email);
  });

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

    if (items[idx].reactions[currentUser.email] === emoji) {
      delete items[idx].reactions[currentUser.email];
    } else {
      items[idx].reactions[currentUser.email] = emoji;
    }

    await updateDoc(doc(db, "shared", "messages"), { items });
    renderReactions(items[idx]);
  } catch (e) {
    alert("Error guardando reacción: " + e.message);
  }
}

const dpClose = document.getElementById("dp-close");
if (dpClose) {
  dpClose.addEventListener("click", async () => {
    try {
      await setDoc(doc(db, "users", currentUser.email), {
        lastMessageSeenDate: getTodayKey()
      }, { merge:true });
    } catch (e) { console.warn(e); }
    document.getElementById("daily-popup").style.display = "none";
  });
}

// Cargar tema al inicio
const savedTheme = localStorage.getItem("hero-theme");
if (savedTheme) document.body.dataset.theme = savedTheme;
