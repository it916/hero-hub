import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, limit, getDocs, Timestamp, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { loadUserRole, isAdmin as isAdminRole, hasFeature } from "./roles.js";
import { initRolesPanel } from "./roles-admin.js";
import { initAuditPanel } from "./audit-panel.js";
import { initAsistenciaDashboard } from "./asistencia-dashboard.js";
import { logEvent, ACTIONS } from "./audit-log.js";
import { getAllUsers } from "./user-store.js";

// ══ AUTH ══
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { location.href = "index.html"; }
    return;
  }

  // Verificar dominio
  if (!user.email.endsWith("@heroinsuranceusa.com")) {
    alert("Acceso restringido a cuentas @heroinsuranceusa.com");
    location.href = "index.html";
    return;
  }

  // Verificar rol admin mediante el sistema de roles
  const userRole = await loadUserRole(user.email);
  if (!isAdminRole(userRole)) {
    alert("Solo los administradores pueden acceder a este panel.");
    location.href = "index.html";
    return;
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("admin-panel").style.display = "block";
  if (window.refreshIcons) window.refreshIcons();
  loadSpotlight();
  loadMessages();
  initAsistenciaDashboard();

  // Exponer email del admin actual para roles-admin.js
  window._currentAdminEmail = user.email;

  // Migración de datos es housekeeping técnico: no debería aparecerle a todo
  // admin para evitar disparos accidentales. Depende de la feature
  // admin-migracion, configurable en el tab Permisos. it@ la ve siempre.
  const veMigracion = hasFeature(userRole, "admin-migracion")
    || user.email === "it@heroinsuranceusa.com";
  if (veMigracion) {
    document.querySelectorAll(".only-it").forEach(el => { el.style.display = ""; });
  }
});

// ══ SPOTLIGHT ══
// Nuevo formato de honoree: { email, customRole } — el nombre, foto y cargo
// se resuelven en render leyendo de users/{email}. Compatibilidad legacy:
// entradas con { name, role } (sin email) se preservan y se muestran sin foto.
let spotlightData = { imageUrl: "", message: "", honorees: [] };
let allUsersCache = []; // array de users/{email} para poblar el <select>

async function loadSpotlight() {
  try {
    const [snap, users] = await Promise.all([
      getDoc(doc(db, "shared", "spotlight")),
      getAllUsers({ includeExcluded: false }).catch(() => [])
    ]);
    if (snap.exists()) spotlightData = snap.data();
    if (!Array.isArray(spotlightData.honorees)) spotlightData.honorees = [];
    allUsersCache = users.sort((a, b) =>
      (a.identity?.name || "").localeCompare(b.identity?.name || "", "es")
    );
    document.getElementById("sp-message").value = spotlightData.message || "";
    renderHonorees();
  } catch (e) { console.error(e); }
}

// Devuelve el user cacheado por email (case-insensitive), null si no está.
function findUserByEmail(email) {
  if (!email) return null;
  const key = email.toLowerCase();
  return allUsersCache.find(u =>
    (u._email || "").toLowerCase() === key ||
    (u.identity?.emails || []).some(e => (e || "").toLowerCase() === key)
  ) || null;
}

function renderHonorees() {
  const list = document.getElementById("sp-honorees-list");
  if (!Array.isArray(spotlightData.honorees)) spotlightData.honorees = [];
  list.replaceChildren();
  spotlightData.honorees.forEach((h, i) => list.appendChild(buildHonoreeRow(h, i)));
}

// Construye una fila del panel admin usando DOM API (no innerHTML) para pasar
// el hook de seguridad y evitar XSS con nombres/emails con caracteres raros.
function buildHonoreeRow(h, i) {
  const user = findUserByEmail(h.email);
  const photo = user?.identity?.photo || "";
  const name = user?.identity?.name || h.name || "";
  const jobTitle = user?.display?.jobTitle || "";
  const roleValue = (h.customRole ?? h.role ?? "");

  const row = document.createElement("div");
  row.className = "honoree-row";
  row.dataset.idx = String(i);

  // Preview de foto o iniciales
  const photoEl = document.createElement("div");
  photoEl.className = "honoree-photo-preview";
  if (photo) {
    photoEl.style.backgroundImage = `url('${photo.replace(/'/g, "\\'")}')`;
  } else {
    photoEl.classList.add("honoree-photo-empty");
    photoEl.textContent = (name || "?").charAt(0).toUpperCase();
  }
  row.appendChild(photoEl);

  // Campos
  const fields = document.createElement("div");
  fields.className = "honoree-row-fields";

  // Selector de usuario
  const emailLabel = document.createElement("label");
  emailLabel.className = "honoree-field";
  const emailLabelSpan = document.createElement("span");
  emailLabelSpan.className = "honoree-field-label";
  emailLabelSpan.textContent = "Usuario";
  if (!h.email && h.name) {
    const badge = document.createElement("span");
    badge.className = "honoree-legacy-badge";
    badge.title = "Entrada antigua sin email. Elige un usuario para modernizar.";
    badge.textContent = "legacy";
    emailLabelSpan.appendChild(document.createTextNode(" "));
    emailLabelSpan.appendChild(badge);
  }
  emailLabel.appendChild(emailLabelSpan);

  const select = document.createElement("select");
  select.className = "honoree-select";
  select.dataset.field = "email";
  select.dataset.idx = String(i);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Elegir —";
  select.appendChild(placeholder);
  allUsersCache.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u._email;
    opt.textContent = u.identity?.name || u._email;
    select.appendChild(opt);
  });
  select.value = h.email || "";
  select.addEventListener("change", () => {
    spotlightData.honorees[i].email = select.value;
    // Al elegir user, limpiar campos legacy para que la próxima carga tome del store.
    delete spotlightData.honorees[i].name;
    delete spotlightData.honorees[i].role;
    renderHonorees();
  });
  emailLabel.appendChild(select);
  fields.appendChild(emailLabel);

  // Motivo opcional
  const roleLabel = document.createElement("label");
  roleLabel.className = "honoree-field";
  const roleLabelSpan = document.createElement("span");
  roleLabelSpan.className = "honoree-field-label";
  roleLabelSpan.textContent = "Motivo (opcional)";
  roleLabel.appendChild(roleLabelSpan);

  const roleInput = document.createElement("input");
  roleInput.type = "text";
  roleInput.dataset.field = "customRole";
  roleInput.dataset.idx = String(i);
  roleInput.placeholder = jobTitle
    ? `${jobTitle} (por defecto)`
    : "Ej. Ventas del mes";
  roleInput.value = roleValue;
  roleInput.addEventListener("input", () => {
    spotlightData.honorees[i].customRole = roleInput.value;
  });
  roleLabel.appendChild(roleInput);
  fields.appendChild(roleLabel);

  row.appendChild(fields);

  // Botón quitar
  const delBtn = document.createElement("button");
  delBtn.className = "btn-ghost-dark honoree-del";
  delBtn.dataset.del = String(i);
  delBtn.title = "Quitar";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    spotlightData.honorees.splice(i, 1);
    renderHonorees();
  });
  row.appendChild(delBtn);

  return row;
}

document.getElementById("sp-add-honoree").addEventListener("click", () => {
  if (!Array.isArray(spotlightData.honorees)) spotlightData.honorees = [];
  if (spotlightData.honorees.length >= 3) { heroToast.error("Máximo 3 honorees"); return; }
  spotlightData.honorees.push({ email: "", customRole: "" });
  renderHonorees();
});

document.getElementById("sp-save").addEventListener("click", async () => {
  // imageUrl deprecado: siempre "" al guardar. El banner ahora usa el fondo del
  // CSS (:not(.has-image)) — las fotos de los honorees son los protagonistas.
  spotlightData.imageUrl = "";
  spotlightData.message = document.getElementById("sp-message").value.trim();
  // Un honoree es válido si tiene email seleccionado O si es una entrada legacy con name.
  spotlightData.honorees = (spotlightData.honorees || []).filter(h => h.email || h.name);
  try {
    await setDoc(doc(db, "shared", "spotlight"), spotlightData);
    document.getElementById("sp-status").textContent = "✓ Guardado";
    setTimeout(() => document.getElementById("sp-status").textContent = "", 2000);

    // Log de auditoría: preferir nombre del user cacheado; fallback a email o legacy name.
    const honoreeNames = spotlightData.honorees.map(h => {
      const u = findUserByEmail(h.email);
      return u?.identity?.name || h.email || h.name || "?";
    }).join(", ");
    logEvent(ACTIONS.SPOTLIGHT_UPDATE, "", {
      honorees: honoreeNames || "ninguno",
      hasMessage: !!spotlightData.message
    });
  } catch (e) { heroToast.error("No se pudo guardar: " + e.message); }
});

// ══ MENSAJES ══
async function loadMessages() {
  try {
    const snap = await getDoc(doc(db, "shared", "messages"));
    const items = snap.exists() ? (snap.data().items || []) : [];
    const list = document.getElementById("ms-list");
    if (!items.length) { list.innerHTML = "<p class='admin-note'>No hay mensajes todavía.</p>"; return; }
    list.innerHTML = items.map((m, i) => `
      <div class="msg-row">
        <div>
          <div class="msg-row-text">${m.frase || ''}</div>
          <div class="msg-row-meta">— ${m.autor || 'Anónimo'}${m.created_at ? ' · ' + new Date(m.created_at).toLocaleDateString('es-ES') : ''}</div>
        </div>
        <button class="btn-ghost-dark" data-del="${i}" title="Eliminar">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await heroConfirm({
          title: "Eliminar mensaje",
          message: "¿Eliminar este mensaje de la playlist?",
          confirmLabel: "Eliminar",
          variant: "danger"
        });
        if (!ok) return;
        const idx = parseInt(btn.dataset.del);
        const deletedMsg = items[idx];
        items.splice(idx, 1);
        await updateDoc(doc(db, "shared", "messages"), { items });

        // Log de auditoría
        logEvent(ACTIONS.MESSAGE_DELETE, deletedMsg?.autor || "—", {
          frase: (deletedMsg?.frase || "").slice(0, 80)
        });

        loadMessages();
      });
    });
  } catch (e) {
    document.getElementById("ms-list").innerHTML = `<p class='admin-note'>Error: ${e.message}</p>`;
  }
}

// ══ MÉTRICAS ══
window.loadMetrics = async function() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const q = query(
      collection(db, "events"),
      where("timestamp", ">=", Timestamp.fromDate(thirtyDaysAgo)),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderMetrics(events);
  } catch (e) {
    console.error("Error cargando métricas:", e);
    if (e.message && e.message.includes("index")) {
      document.getElementById("mt-chart").innerHTML = `<p class="empty">Firestore necesita crear un índice. Abre la consola del navegador (F12), busca el link en el error y créalo. Luego vuelve a cargar.</p>`;
    } else {
      document.getElementById("mt-chart").innerHTML = `<p class="empty">Error: ${e.message}</p>`;
    }
  }
}

function renderMetrics(events) {
  // Card: visitas totales
  document.getElementById("mt-total").textContent = events.length.toLocaleString();

  // Card: usuarios activos únicos
  const uniqueUsers = new Set(events.map(e => e.email));
  document.getElementById("mt-users").textContent = uniqueUsers.size;

  // Conteo por página
  const pageCounts = {};
  events.forEach(e => { pageCounts[e.page] = (pageCounts[e.page] || 0) + 1; });
  const topPages = Object.entries(pageCounts).sort((a,b) => b[1] - a[1]);

  // Card: página top
  if (topPages.length) {
    document.getElementById("mt-toppage").textContent = topPages[0][0];
    document.getElementById("mt-toppage-count").textContent = topPages[0][1] + " visitas";
  }

  // Conteo por día de la semana
  const daysOfWeek = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const dayCounts = {};
  events.forEach(e => {
    if (!e.timestamp) return;
    const d = e.timestamp.toDate();
    const day = daysOfWeek[d.getDay()];
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  });
  const topDays = Object.entries(dayCounts).sort((a,b) => b[1] - a[1]);
  if (topDays.length) {
    document.getElementById("mt-topday").textContent = topDays[0][0];
    document.getElementById("mt-topday-count").textContent = topDays[0][1] + " visitas";
  }

  // Gráfico actividad diaria (últimos 30 días, en fecha local del usuario)
  const dailyCounts = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyCounts[ymdLocal(d)] = 0;
  }
  events.forEach(e => {
    if (!e.timestamp) return;
    const key = ymdLocal(e.timestamp.toDate());
    if (key in dailyCounts) dailyCounts[key]++;
  });
  renderChart(dailyCounts);

  // Top 5 páginas
  const topPagesList = topPages.slice(0, 5);
  const maxPageCount = topPagesList[0]?.[1] || 1;
  document.getElementById("mt-top-pages").innerHTML = topPagesList.length
    ? topPagesList.map(([page, count]) => `
        <div class="mt-bar-row">
          <div class="mt-bar-label">${page}</div>
          <div class="mt-bar-wrap"><div class="mt-bar-fill" style="width:${(count/maxPageCount)*100}%"></div></div>
          <div class="mt-bar-val">${count}</div>
        </div>`).join('')
    : `<p class="empty">Sin datos todavía.</p>`;

  // Top 5 usuarios
  const userCounts = {};
  events.forEach(e => { userCounts[e.email] = (userCounts[e.email] || 0) + 1; });
  const topUsers = Object.entries(userCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const maxUserCount = topUsers[0]?.[1] || 1;
  document.getElementById("mt-top-users").innerHTML = topUsers.length
    ? topUsers.map(([email, count]) => `
        <div class="mt-bar-row">
          <div class="mt-bar-label">${email.split('@')[0]}</div>
          <div class="mt-bar-wrap"><div class="mt-bar-fill" style="width:${(count/maxUserCount)*100}%"></div></div>
          <div class="mt-bar-val">${count}</div>
        </div>`).join('')
    : `<p class="empty">Sin datos todavía.</p>`;

  // Últimos 10 eventos
  document.getElementById("mt-events").innerHTML = events.length
    ? events.slice(0, 10).map(e => {
        const d = e.timestamp?.toDate();
        const when = d ? d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        return `<div class="mt-event-row">
          <span class="mt-event-user">${e.email.split('@')[0]}</span>
          <span class="mt-event-arrow">→</span>
          <span class="mt-event-page">${e.page}</span>
          <span class="mt-event-time">${when}</span>
        </div>`;
      }).join('')
    : `<p class="empty">Sin eventos todavía. Las visitas empezarán a registrarse cuando el equipo use el Hub.</p>`;
}

// YYYY-MM-DD en la zona horaria local (NO usar toISOString — devuelve UTC)
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderChart(dailyCounts) {
  const entries = Object.entries(dailyCounts);
  const maxVal = Math.max(...entries.map(([,v]) => v), 1);
  const chart = document.getElementById("mt-chart");
  chart.innerHTML = `<div class="mt-chart-inner">
    ${entries.map(([date, count]) => {
      const h = (count / maxVal) * 100;
      const d = new Date(date + 'T12:00');
      const label = d.getDate();
      const isFirstOfMonth = label === 1 || entries[0][0] === date;
      const barClass = count > 0 ? "mt-chart-bar has-value" : "mt-chart-bar";
      return `<div class="mt-chart-col" title="${date}: ${count} visitas">
        <div class="${barClass}" style="height:${h}%"></div>
        <div class="mt-chart-lbl">${isFirstOfMonth ? d.toLocaleDateString('es',{month:'short'}) : ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

document.getElementById("mt-refresh").addEventListener("click", () => window.loadMetrics());

document.getElementById("mt-cleanup").addEventListener("click", async () => {
  const ok = await heroConfirm({
    title: "Limpiar eventos antiguos",
    message: "¿Eliminar eventos con más de 90 días? Esta acción no se puede deshacer.",
    confirmLabel: "Eliminar",
    variant: "danger"
  });
  if (!ok) return;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  try {
    const q = query(collection(db, "events"), where("timestamp", "<", Timestamp.fromDate(ninetyDaysAgo)));
    const snap = await getDocs(q);
    let count = 0;
    for (const d of snap.docs) { await deleteDoc(d.ref); count++; }
    heroToast.success(`${count} eventos antiguos eliminados`);
    window.loadMetrics();
  } catch (e) {
    heroToast.error("No se pudo limpiar: " + e.message);
  }
});

// ══ ROLES ══
// Expone la función para inicializar el panel de roles.
// Se llama desde admin.html cuando el usuario abre el tab "Roles".
window.loadRolesPanel = async function() {
  if (!window._currentAdminEmail) {
    console.warn("Admin email no disponible todavía");
    return;
  }
  await initRolesPanel(window._currentAdminEmail);
};

// ══ PERMISOS POR ROL ══
// Se llama desde admin.html al abrir el tab "Permisos". Carga perezosa: el
// módulo solo se descarga si el admin entra al tab.
window.loadPermisosPanel = async function() {
  if (!window._currentAdminEmail) {
    console.warn("Admin email no disponible todavía");
    return;
  }
  const { initPermisosPanel } = await import("./permisos-admin.js");
  await initPermisosPanel(window._currentAdminEmail);
};

// ══ LOG DE AUDITORÍA ══
// Expone la función para inicializar el panel de auditoría.
// Se llama desde admin.html cuando el usuario abre el tab "Log".
window.loadAuditPanel = async function() {
  await initAuditPanel();
};

// ══ DASHBOARD DE ASISTENCIA ══
// Se llama desde admin.html cuando el usuario abre el tab "Asistencia".
window.loadAsistenciaDashboard = async function() {
  await initAsistenciaDashboard();
};
