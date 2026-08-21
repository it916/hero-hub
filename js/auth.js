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

  // Pop-up mensaje del día
  setTimeout(() => checkDailyPopup(), 1200);

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

// ══ MODAL INICIO DE JORNADA (antes: pop-up mensaje del día) ══
// Se muestra si el usuario abre el Hub y aún no ha marcado asistencia hoy.
// Desde v2.24.0 esperamos a window.hhAttendanceReady (que attendance.js
// resuelve tras el primer snapshot de Firestore) para decidir con la
// verdad del backend, no solo con el cache local. Si Firestore tarda
// demasiado, caemos al fallback de localStorage.

function _isSameLocalDay(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function _hasAttendanceToday() {
  try {
    // Flag persistente: cada vez que se marca Entrada, attendance.js escribe
    // aquí el día (YYYY-MM-DD). Esto sobrevive a Break/Salida posteriores.
    const entryDay = localStorage.getItem("hh-attendance-entry-day");
    const todayKey = new Date().toISOString().slice(0, 10);
    if (entryDay === todayKey) return true;

    // Fallback: si el último evento cacheado es de hoy Y es de tipo activo,
    // cuenta como que ya marcó algo hoy.
    const raw = localStorage.getItem("hh-attendance-last");
    if (!raw) return false;
    const last = JSON.parse(raw);
    if (!last.type) return false;
    return _isSameLocalDay(last.timestamp, new Date().toISOString());
  } catch { return false; }
}

async function checkDailyPopup() {
  try {
    // Esperar el primer snapshot de asistencia (o timeout) para que la
    // decisión use la verdad de Firestore. Timeout 2s → fallback cache.
    if (window.hhAttendanceReady && typeof window.hhAttendanceReady.then === "function") {
      await Promise.race([
        window.hhAttendanceReady,
        new Promise(r => setTimeout(r, 2000)),
      ]);
    }

    if (_hasAttendanceToday()) return;

    // Si el usuario está en Break, attendance.js abrirá el break-modal.
    // No mostrar el modal de inicio de jornada encima.
    const rawLast = localStorage.getItem("hh-attendance-last");
    if (rawLast) {
      const last = JSON.parse(rawLast);
      if (last.type === "Inicio Break" && _isSameLocalDay(last.timestamp, new Date().toISOString())) return;
    }

    const msgSnap = await getDoc(doc(db, "shared", "messages"));
    let msg = null;
    if (msgSnap.exists()) {
      const items = msgSnap.data().items || [];
      if (items.length) {
        const raw = items[Math.floor(Math.random() * items.length)];
        msg = typeof raw === "string"
          ? { frase: raw, autor: "—", created_at: null }
          : raw;
      }
    }
    showDailyPopup(msg);
  } catch (e) {
    console.warn("Daily popup failed:", e.message);
  }
}

function showDailyPopup(msg) {
  const popup = document.getElementById("daily-popup");
  if (!popup) return;

  // Saludo
  const helloName = document.getElementById("dp-hello-name");
  if (helloName) helloName.textContent = getFirstName(currentUser);

  // Vista 1 (inicio) visible; vista 2 (confirmación) oculta
  const viewStart = document.getElementById("dp-view-start");
  const viewConfirm = document.getElementById("dp-view-confirm");
  if (viewStart) viewStart.style.display = "";
  if (viewConfirm) viewConfirm.style.display = "none";

  // Frase del día — si no hay mensaje, escondemos el bloque
  const fraseEl = document.getElementById("dp-frase");
  const nameEl = document.getElementById("dp-author-name");
  const avEl = document.getElementById("dp-author-av");
  const dateEl = document.getElementById("dp-author-date");
  const mensajeLabel = document.querySelector(".dp-mensaje-label");
  const authorBlock = document.querySelector("#dp-view-start .dp-author");

  if (msg && fraseEl) {
    fraseEl.textContent = msg.frase || "—";
    if (nameEl) nameEl.textContent = msg.autor || "Anónimo";
    if (avEl) {
      const initials = (msg.autor || "A").split(" ").slice(0,2).map(w => w[0] || "").join("").toUpperCase();
      avEl.textContent = initials;
    }
    if (dateEl && msg.created_at) {
      const d = new Date(msg.created_at);
      dateEl.textContent = d.toLocaleDateString("es-ES", { day:"2-digit", month:"short", year:"numeric" });
    } else if (dateEl) {
      dateEl.textContent = "";
    }
    if (fraseEl) fraseEl.style.display = "";
    if (mensajeLabel) mensajeLabel.style.display = "";
    if (authorBlock) authorBlock.style.display = "";
  } else {
    if (fraseEl) fraseEl.style.display = "none";
    if (mensajeLabel) mensajeLabel.style.display = "none";
    if (authorBlock) authorBlock.style.display = "none";
  }

  // Botón "Iniciar mi día" → click proxy al botón Entrada del HQCC.
  // La vista de confirmación se dispara desde attendance.js cuando la
  // marca tiene éxito — así también funciona si marcan desde el HQCC.
  const btnStart = document.getElementById("dp-btn-start");
  if (btnStart) {
    btnStart.onclick = () => {
      btnStart.disabled = true;
      const hqEntrada = document.querySelector(".att-entrada");
      if (hqEntrada) hqEntrada.click();
    };
  }

  popup.style.display = "flex";
  if (window.refreshIcons) window.refreshIcons();
}

// Muestra la vista de confirmación (checkmark + barra 5s) y auto-cierra.
function _showJornadaConfirmation() {
  const popup = document.getElementById("daily-popup");
  const viewStart = document.getElementById("dp-view-start");
  const viewConfirm = document.getElementById("dp-view-confirm");
  const fill = document.getElementById("dp-progress-fill");
  if (!popup || !viewConfirm) return;

  if (viewStart) viewStart.style.display = "none";
  viewConfirm.style.display = "";

  // Sub-mensaje con la hora
  const sub = document.getElementById("dp-confirm-sub");
  if (sub) {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes().toString().padStart(2, "0");
    const ampm = now.getHours() >= 12 ? "pm" : "am";
    sub.textContent = `Entrada registrada a las ${h}:${m} ${ampm} · ¡que tengas un gran día! ✨`;
  }

  // Reinicia y arranca la barra (removeClass fuerza restart de la animación)
  if (fill) {
    fill.classList.remove("running");
    void fill.offsetWidth;
    fill.classList.add("running");
  }

  setTimeout(() => { popup.style.display = "none"; }, 5000);
}

// Expuesto para que attendance.js dispare la confirmación cuando se marca
// Entrada, sin importar si el usuario clickeó "Iniciar mi día" en el modal
// o el botón Entrada directo del HQCC.
window.showJornadaConfirmation = _showJornadaConfirmation;

const dpClose = document.getElementById("dp-close");
if (dpClose) {
  dpClose.addEventListener("click", () => {
    document.getElementById("daily-popup").style.display = "none";
  });
}

// Cargar tema al inicio
const savedTheme = localStorage.getItem("hero-theme");
if (savedTheme) document.body.dataset.theme = savedTheme;
