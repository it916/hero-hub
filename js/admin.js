import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, limit, getDocs, Timestamp, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { loadUserRole, isAdmin as isAdminRole } from "./roles.js";
import { initRolesPanel } from "./roles-admin.js";
import { initAuditPanel } from "./audit-panel.js";
import { logEvent, ACTIONS } from "./audit-log.js";

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

  // Exponer email del admin actual para roles-admin.js
  window._currentAdminEmail = user.email;
});

// ══ SPOTLIGHT ══
let spotlightData = { imageUrl: "", message: "", honorees: [] };

async function loadSpotlight() {
  try {
    const snap = await getDoc(doc(db, "shared", "spotlight"));
    if (snap.exists()) spotlightData = snap.data();
    document.getElementById("sp-image").value = spotlightData.imageUrl || "";
    document.getElementById("sp-message").value = spotlightData.message || "";
    renderHonorees();
  } catch (e) { console.error(e); }
}

function renderHonorees() {
  const list = document.getElementById("sp-honorees-list");
  if (!Array.isArray(spotlightData.honorees)) spotlightData.honorees = [];
  list.innerHTML = spotlightData.honorees.map((h, i) => `
    <div class="honoree-row">
      <input placeholder="Nombre" data-field="name" data-idx="${i}" value="${(h.name||'').replace(/"/g,'&quot;')}">
      <input placeholder="Rol" data-field="role" data-idx="${i}" value="${(h.role||'').replace(/"/g,'&quot;')}">
      <button class="btn-ghost-dark" data-del="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      spotlightData.honorees[parseInt(inp.dataset.idx)][inp.dataset.field] = inp.value;
    });
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      spotlightData.honorees.splice(parseInt(btn.dataset.del), 1);
      renderHonorees();
    });
  });
}

document.getElementById("sp-add-honoree").addEventListener("click", () => {
  if (!Array.isArray(spotlightData.honorees)) spotlightData.honorees = [];
  if (spotlightData.honorees.length >= 3) { alert("Máximo 3 honorees"); return; }
  spotlightData.honorees.push({ name: "", role: "" });
  renderHonorees();
});

document.getElementById("sp-save").addEventListener("click", async () => {
  spotlightData.imageUrl = document.getElementById("sp-image").value.trim();
  spotlightData.message = document.getElementById("sp-message").value.trim();
  spotlightData.honorees = (spotlightData.honorees || []).filter(h => h.name);
  try {
    await setDoc(doc(db, "shared", "spotlight"), spotlightData);
    document.getElementById("sp-status").textContent = "✓ Guardado";
    setTimeout(() => document.getElementById("sp-status").textContent = "", 2000);

    // Log de auditoría
    const honoreeNames = spotlightData.honorees.map(h => h.name).join(", ");
    logEvent(ACTIONS.SPOTLIGHT_UPDATE, "", {
      honorees: honoreeNames || "ninguno",
      hasImage: !!spotlightData.imageUrl,
      hasMessage: !!spotlightData.message
    });
  } catch (e) { alert("Error: " + e.message); }
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
        if (!confirm("¿Eliminar este mensaje?")) return;
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

  // Gráfico actividad diaria (últimos 30 días)
  const dailyCounts = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dailyCounts[key] = 0;
  }
  events.forEach(e => {
    if (!e.timestamp) return;
    const key = e.timestamp.toDate().toISOString().split('T')[0];
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
      return `<div class="mt-chart-col" title="${date}: ${count} visitas">
        <div class="mt-chart-bar" style="height:${h}%"></div>
        <div class="mt-chart-lbl">${isFirstOfMonth ? d.toLocaleDateString('es',{month:'short'}) : ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

document.getElementById("mt-refresh").addEventListener("click", () => window.loadMetrics());

document.getElementById("mt-cleanup").addEventListener("click", async () => {
  if (!confirm("¿Eliminar eventos con más de 90 días? Esta acción no se puede deshacer.")) return;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  try {
    const q = query(collection(db, "events"), where("timestamp", "<", Timestamp.fromDate(ninetyDaysAgo)));
    const snap = await getDocs(q);
    let count = 0;
    for (const d of snap.docs) { await deleteDoc(d.ref); count++; }
    alert(`✓ ${count} eventos antiguos eliminados`);
    window.loadMetrics();
  } catch (e) {
    alert("Error: " + e.message);
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

// ══ LOG DE AUDITORÍA ══
// Expone la función para inicializar el panel de auditoría.
// Se llama desde admin.html cuando el usuario abre el tab "Log".
window.loadAuditPanel = async function() {
  await initAuditPanel();
};
