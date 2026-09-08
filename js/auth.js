import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets } from "./widgets.js";
import { openBirthdayCardModal, checkBirthdayPopup } from "./birthday-card.js";
import { checkBirthdayInvitePopup } from "./birthday-invite.js";
import { loadUserRole, filterTopbarByRole, isAdmin as isAdminRole, clearRoleCache, canAccessPage, applyRoleClasses } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";

let currentUser = null;
let currentUserRole = null;  // Objeto { role, definition } del sistema de roles
let isAdmin = false;
let teamMembers = [];

// ══ AUTH ══
onAuthStateChanged(auth, async (user) => {
  if (!user) { clearRoleCache(); showLogin(); return; }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    clearRoleCache();
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

async function showDashboard() {
  // Las clases van ANTES de mostrar el dashboard: entre el display:block y
  // la foto del avatar hay un await, y en ese hueco se vería el dashboard
  // sin features aplicadas (todos los tiles ocultos, apareciendo de golpe
  // un instante después).
  applyRoleClasses(currentUserRole);

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  const photoUrl = await getFreshGooglePhotoURL(currentUser);
  document.getElementById("user-avatar").src = photoUrl;
  const menuAvatarEl = document.getElementById("user-menu-avatar");
  if (menuAvatarEl) menuAvatarEl.src = photoUrl;

  // Filtrar el topbar según el rol del usuario
  // (oculta links a páginas no permitidas y maneja el botón admin)
  filterTopbarByRole(currentUserRole);

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

  // Pop-up cumpleaños del día (si corresponde)
  setTimeout(() => checkBirthdayPopup(currentUser, teamMembers), 1800);

  // Pop-up invitando a felicitar a otro cumpleañero (D-1 y D)
  setTimeout(() => checkBirthdayInvitePopup(currentUser, teamMembers), 2400);

  if (window.refreshIcons) window.refreshIcons();
}

document.getElementById("btn-login")?.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
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
      heroToast.info("No hay cumpleaños próximos registrados.");
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

// ══ HQ COMMAND CENTER (banner del dashboard) ══
function getFirstName(user) {
  if (user.displayName) return user.displayName.split(" ")[0];
  return user.email.split("@")[0].split(".")[0].charAt(0).toUpperCase() + user.email.split("@")[0].split(".")[0].slice(1);
}

function getSalutation() {
  const h = new Date().getHours();
  if (h < 12) return "¡Buenos días";
  if (h < 19) return "¡Buenas tardes";
  return "¡Buenas noches";
}

function initHeroCover() {
  const greetNameEl = document.getElementById("greet-name");
  if (greetNameEl) greetNameEl.textContent = getFirstName(currentUser);

  const salutationEl = document.getElementById("greet-salutation");
  if (salutationEl) salutationEl.textContent = getSalutation();

  // Sync del avatar del ribbon con la foto del topbar (que se pobla en initAuth).
  const topAv = document.getElementById("user-avatar");
  const hqAv = document.getElementById("hqcc-avatar");
  if (topAv && hqAv) {
    const sync = () => {
      const src = topAv.src;
      if (src && !src.endsWith("/") && !src.startsWith("data:")) hqAv.src = src;
    };
    new MutationObserver(sync).observe(topAv, { attributes:true, attributeFilter:["src"] });
    sync();
  }

  updateDateTime();
  setInterval(updateDateTime, 30000);
}

function updateDateTime() {
  const dateEl = document.getElementById("hqcc-date");
  const timeEl = document.getElementById("hqcc-time");
  if (!dateEl && !timeEl) return;

  const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;

  if (dateEl) {
    const larga = `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;
    dateEl.textContent = larga;
    dateEl.title = larga;
  }
  if (timeEl) {
    timeEl.textContent = `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
  }
}

// Cargar tema al inicio
const savedTheme = localStorage.getItem("hero-theme");
if (savedTheme) document.body.dataset.theme = savedTheme;
