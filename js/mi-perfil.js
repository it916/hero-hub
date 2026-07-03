// ═══════════════════════════════════════════
// Hero Hub · Mi perfil
// ═══════════════════════════════════════════
// Página personal del usuario logueado. Muestra:
//   - Hero header con foto, nombre, cargo, rol y email.
//   - Información personal (teléfono, país, cumpleaños, tema).
//   - Sobre mí (bio) con edición inline.
//   - Estadísticas del mes (desde el Sheet de asistencia).
//   - Actividad reciente (desde audit-log en Firestore).

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { guardPage, filterTopbarByRole } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";
import { ACTION_LABELS } from "./audit-log.js";

const ATTENDANCE_URL = "https://script.google.com/macros/s/AKfycbxgZulYURxNjprHfvXuj82HHveHtNueg1J6SYkRPzqh8AjYSduzN9RkK-n5-1zO1N3F/exec";

const FLAG_URLS = {
  'venezuela': 'https://flagicons.lipis.dev/flags/4x3/ve.svg',
  'cuba': 'https://flagicons.lipis.dev/flags/4x3/cu.svg',
  'colombia': 'https://flagicons.lipis.dev/flags/4x3/co.svg',
  'chile': 'https://flagicons.lipis.dev/flags/4x3/cl.svg',
  'honduras': 'https://flagicons.lipis.dev/flags/4x3/hn.svg',
  'estados unidos': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'eeuu': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
  'us': 'https://flagicons.lipis.dev/flags/4x3/us.svg',
};
const getFlagUrl = (c) => c ? (FLAG_URLS[c.toLowerCase().trim()] || null) : null;

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ── Helpers de fecha ─────────────────────────────────────────────

function parseBirthdate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let month, day;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { month = parseInt(m[2], 10); day = parseInt(m[3], 10); }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{2,4}$/))) {
    month = parseInt(m[2], 10); day = parseInt(m[1], 10);
  }
  else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/))) {
    month = parseInt(m[1], 10); day = parseInt(m[2], 10);
  }
  return (month && day) ? { month, day } : null;
}

function formatBirthday({ month, day }) {
  const name = MONTHS_ES[month - 1];
  return `${day} de ${name}`;
}

function daysUntilBirthday({ month, day }) {
  const now = new Date();
  const year = now.getFullYear();
  let target = new Date(year, month - 1, day);
  if (target < startOfDay(now)) target = new Date(year + 1, month - 1, day);
  return Math.ceil((target - now) / (24 * 60 * 60 * 1000));
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function parseAttendanceDate(fecha) {
  if (!fecha) return null;
  if (fecha instanceof Date) return new Date(fecha);
  const [m, d, y] = String(fecha).split("/");
  if (!m || !d || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function relativeTime(date) {
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `hace ${weeks} semana${weeks > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

// ── Bootstrap ─────────────────────────────────────────────────────

let currentUser = null;
let currentMember = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;

  const guard = await guardPage(user);
  if (!guard) return;
  const { userRole } = guard;

  document.body.classList.add(`role-${userRole.role}`);
  try { localStorage.setItem("hero-user-role", userRole.role); } catch (_) {}
  filterTopbarByRole(userRole);

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.body.classList.remove("skip-loading");

  // Foto del topbar
  const freshPhoto = await getFreshGooglePhotoURL(user);
  const avatarEl = document.getElementById("user-avatar");
  if (avatarEl) avatarEl.src = freshPhoto;
  const menuAvatarEl = document.getElementById("user-menu-avatar");
  if (menuAvatarEl) menuAvatarEl.src = freshPhoto;

  // Cargar todos los datos
  await Promise.all([
    loadTeamData(),
    loadActivity(),
    loadStats(),
  ]);

  // Bind del botón editar bio
  wireBioEditor();

  // Handler de cerrar sesión (para el #btn-logout oculto que el dropdown dispara)
  document.getElementById("btn-logout")?.addEventListener("click", () =>
    signOut(auth).then(() => location.href = "index.html")
  );

  if (window.refreshIcons) window.refreshIcons();
});

// ── Carga de datos de shared/team.members[user] ────────────────

async function loadTeamData() {
  try {
    const snap = await getDoc(doc(db, "shared", "team"));
    if (snap.exists()) {
      const members = snap.data().members || [];
      const email = currentUser.email.toLowerCase();
      currentMember = members.find(m => {
        const emails = Array.isArray(m.email) ? m.email : [m.email];
        return emails.some(e => (e || "").toLowerCase() === email);
      }) || null;
    }
  } catch (e) {
    console.error("[mi-perfil] Error cargando shared/team:", e);
  }
  renderHero();
  renderInfo();
  renderBio();
}

function renderHero() {
  const user = currentUser;
  const name = currentMember?.name || user.displayName || user.email.split("@")[0];
  const cargo = currentMember?.role || "";
  const photo = user.photoURL || currentMember?.photo || "";

  document.getElementById("mp-name").textContent = name;
  document.getElementById("mp-cargo").textContent = cargo || "—";
  document.getElementById("mp-email").textContent = user.email;
  if (photo) document.getElementById("mp-photo").src = photo;
  document.title = `${name} — Mi perfil`;

  const roleClass = [...document.body.classList].find(c => c.startsWith("role-"));
  if (roleClass) {
    const badge = document.getElementById("mp-badge");
    badge.textContent = roleClass.replace("role-", "").toUpperCase();
    badge.hidden = false;
  }
}

function renderInfo() {
  const m = currentMember;
  const phone = Array.isArray(m?.phone) ? m.phone.filter(Boolean).join(", ") : (m?.phone || "");
  const country = m?.country || "";
  const flagUrl = country ? getFlagUrl(country) : null;
  const bd = parseBirthdate(m?.birthdate);

  const phoneEl = document.getElementById("mp-phone");
  phoneEl.textContent = phone || "—";
  if (!phone) phoneEl.classList.add("mp-empty");

  const countryEl = document.getElementById("mp-country");
  if (country) {
    countryEl.innerHTML = (flagUrl ? `<img src="${flagUrl}" alt="" class="mp-flag">` : "") + escapeHtml(country);
  } else {
    countryEl.textContent = "—";
    countryEl.classList.add("mp-empty");
  }

  const bdEl = document.getElementById("mp-birthday");
  if (bd) bdEl.textContent = formatBirthday(bd);
  else { bdEl.textContent = "—"; bdEl.classList.add("mp-empty"); }

  const themeEl = document.getElementById("mp-theme");
  themeEl.textContent = document.body.dataset.theme === "dark" ? "Noche" : "Día";
}

// ── Sobre mí (bio) con edición inline ─────────────────────────

function renderBio() {
  const raw = currentMember?.bio;
  const bio = (typeof raw === "string" ? raw : "").trim();
  const view = document.getElementById("mp-bio-view");
  if (bio) {
    view.textContent = bio;
    view.classList.remove("mp-empty");
  } else {
    view.textContent = "Aún no has escrito nada sobre ti. Presiona el lápiz para agregar tu bio.";
    view.classList.add("mp-empty");
  }
}

function wireBioEditor() {
  const editBtn = document.getElementById("mp-bio-edit");
  const view    = document.getElementById("mp-bio-view");
  const editor  = document.getElementById("mp-bio-editor");
  const input   = document.getElementById("mp-bio-input");
  const counter = document.getElementById("mp-bio-counter");
  const cancel  = document.getElementById("mp-bio-cancel");
  const save    = document.getElementById("mp-bio-save");

  const updateCounter = () => { counter.textContent = `${input.value.length}/500`; };

  editBtn.addEventListener("click", () => {
    const raw = currentMember?.bio;
    input.value = typeof raw === "string" ? raw : "";
    updateCounter();
    view.hidden = true;
    editor.hidden = false;
    editBtn.hidden = true;
    input.focus();
  });

  input.addEventListener("input", updateCounter);

  cancel.addEventListener("click", () => {
    editor.hidden = true;
    view.hidden = false;
    editBtn.hidden = false;
  });

  save.addEventListener("click", async () => {
    save.disabled = true;
    save.textContent = "Guardando...";
    try {
      await saveBio(input.value.trim());
      editor.hidden = true;
      view.hidden = false;
      editBtn.hidden = false;
      renderBio();
    } catch (e) {
      alert("No se pudo guardar la bio: " + e.message);
    } finally {
      save.disabled = false;
      save.textContent = "Guardar";
    }
  });
}

async function saveBio(newBio) {
  // Lee shared/team, modifica solo la entry del user (matcheada por email),
  // y reescribe el doc completo con setDoc.
  const ref = doc(db, "shared", "team");
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("El documento shared/team no existe");
  const members = snap.data().members || [];
  const email = currentUser.email.toLowerCase();
  const idx = members.findIndex(m => {
    const emails = Array.isArray(m.email) ? m.email : [m.email];
    return emails.some(e => (e || "").toLowerCase() === email);
  });
  if (idx < 0) throw new Error("No encontramos tu tarjeta en el equipo");
  members[idx].bio = newBio || null;
  await setDoc(ref, { members }, { merge: true });
  currentMember = members[idx];
}

// ── Estadísticas del mes ──────────────────────────────────────

async function loadStats() {
  const bd = parseBirthdate(currentMember?.birthdate);
  const bdEl = document.getElementById("mp-stat-birthday-in");
  if (bd) {
    const d = daysUntilBirthday(bd);
    if (d === 0) bdEl.textContent = "¡Hoy!";
    else if (d === 1) bdEl.textContent = "mañana";
    else bdEl.textContent = String(d);
  } else {
    bdEl.textContent = "—";
    bdEl.classList.add("mp-empty");
  }

  // Asistencia: fetch al Sheet y contar del mes actual.
  try {
    const resp = await fetch(ATTENDANCE_URL, { method: "GET", redirect: "follow" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "Respuesta inválida del Apps Script");
    const events = data.data || [];
    const monthStart = startOfMonth(new Date());
    const email = currentUser.email.toLowerCase();

    const mine = events.filter(ev => {
      if (!ev.email || String(ev.email).toLowerCase() !== email) return false;
      const d = parseAttendanceDate(ev.fecha);
      return d && d >= monthStart;
    });

    // Días únicos con al menos una "Entrada"
    const workDays = new Set();
    let breaks = 0;
    for (const ev of mine) {
      if (ev.tipo === "Entrada") {
        const d = parseAttendanceDate(ev.fecha);
        if (d) workDays.add(d.toDateString());
      }
      if (ev.tipo === "Inicio Break") breaks++;
    }
    document.getElementById("mp-stat-days").textContent = String(workDays.size);
    document.getElementById("mp-stat-breaks").textContent = String(breaks);
  } catch (e) {
    console.error("[mi-perfil] Error cargando asistencia:", e);
    document.getElementById("mp-stat-days").textContent = "—";
    document.getElementById("mp-stat-breaks").textContent = "—";
  }
}

// ── Actividad reciente (audit-log) ─────────────────────────────

async function loadActivity() {
  const container = document.getElementById("mp-activity");
  try {
    const q = query(
      collection(db, "audit-log"),
      where("actor", "==", currentUser.email),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      container.innerHTML = `<p class="mp-empty">Aún no hay actividad registrada.</p>`;
      return;
    }
    const rows = [];
    snap.forEach(docSnap => {
      const ev = docSnap.data();
      const meta = ACTION_LABELS[ev.action] || { label: ev.action, icon: "circle", color: "#94a3b8" };
      const when = ev.timestamp?.toDate ? ev.timestamp.toDate() : new Date();
      const target = ev.target ? ` · ${escapeHtml(ev.target)}` : "";
      rows.push(`
        <div class="mp-activity-row">
          <div class="mp-activity-icon" style="background:${meta.color}1a;color:${meta.color};">
            <i data-lucide="${meta.icon}"></i>
          </div>
          <div class="mp-activity-body">
            <div class="mp-activity-label">${escapeHtml(meta.label)}${target}</div>
            <div class="mp-activity-time">${relativeTime(when)}</div>
          </div>
        </div>
      `);
    });
    container.innerHTML = rows.join("");

    // Mostrar link "Ver todo" solo para admins.
    if (document.body.classList.contains("role-admin")) {
      document.getElementById("mp-activity-more").hidden = false;
    }
    if (window.refreshIcons) window.refreshIcons();
  } catch (e) {
    console.error("[mi-perfil] Error cargando audit-log:", e);
    container.innerHTML = `<p class="mp-empty">No se pudo cargar la actividad.</p>`;
  }
}
