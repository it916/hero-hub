import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
// ADMIN_EMAILS eliminado: usamos el sistema de roles

let teamData = { jesus: [], anny: [] };
let personalData = [];
let isAdmin = false;
let currentAccount = 'jesus';
let currentZone = 'team';
let teamFilter = '';
let personalFilter = '';

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { location.href = "index.html"; }
    return;
  }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    alert("Acceso restringido a cuentas @heroinsuranceusa.com");
    location.href = "index.html";
    return;
  }

  // Esperar a que page-guard cargue el rol
  const ctx = await window.getPageContext();
  isAdmin = isAdminRole(ctx.userRole);
  const isAgente = ctx.userRole && ctx.userRole.role === "agente";

  document.getElementById("user-avatar").src = user.photoURL;
  if (isAdmin) {
    document.getElementById("btn-add-team").style.display = "inline-flex";
    document.getElementById("team-admin-note").style.display = "inline";
  }
  // btn-admin ya fue manejado por page-guard.js

  // Para agentes: ocultar la pestaña "Cuentas del Equipo" y mostrar solo "Mis Carriers"
  if (isAgente) {
    const teamZoneTab = document.querySelector('.zone-tab[data-zone="team"]');
    const personalZoneTab = document.querySelector('.zone-tab[data-zone="personal"]');
    const teamZone = document.getElementById("zone-team");
    const personalZone = document.getElementById("zone-personal");

    if (teamZoneTab) teamZoneTab.style.display = "none";
    if (teamZone) teamZone.style.display = "none";
    if (personalZoneTab) {
      personalZoneTab.classList.add("active");
      // Los agentes entran directo a Mis Carriers
      currentZone = "personal";
    }
    if (personalZone) personalZone.style.display = "block";
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  // Los agentes no necesitan cargar team (no lo verán)
  if (isAgente) {
    await loadPersonal();
  } else {
    await Promise.all([loadTeam(), loadPersonal()]);
  }
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth).then(() => location.href = "index.html"));

async function loadTeam() {
  try {
    const snap = await getDoc(doc(db, "shared", "carriers-team"));
    if (snap.exists()) {
      teamData.jesus = snap.data().jesus || [];
      teamData.anny = snap.data().anny || [];
    }
    renderTeam();
  } catch (e) {
    console.error(e);
    document.getElementById("team-grid").innerHTML = `<p class="empty">Error: ${e.message}</p>`;
  }
}

async function loadPersonal() {
  try {
    const snap = await getDoc(doc(db, "users", auth.currentUser.email));
    if (snap.exists() && Array.isArray(snap.data().carriers)) {
      personalData = snap.data().carriers;
    } else {
      personalData = [];
    }
    renderPersonal();
  } catch (e) {
    console.error(e);
    personalData = [];
  }
}

function wireHandlers() {
  // Zone tabs
  document.querySelectorAll('.zone-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.zone-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentZone = b.dataset.zone;
      document.getElementById('zone-team').style.display = currentZone === 'team' ? 'block' : 'none';
      document.getElementById('zone-personal').style.display = currentZone === 'personal' ? 'block' : 'none';
    });
  });

  // Account tabs
  document.querySelectorAll('.account-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.account-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentAccount = b.dataset.account;
      teamFilter = '';
      document.getElementById('team-search').value = '';
      renderTeam();
    });
  });

  // Search
  document.getElementById('team-search').addEventListener('input', e => {
    teamFilter = e.target.value.toLowerCase().trim();
    renderTeam();
  });
  document.getElementById('personal-search').addEventListener('input', e => {
    personalFilter = e.target.value.toLowerCase().trim();
    renderPersonal();
  });

  // Add buttons
  document.getElementById('btn-add-team').addEventListener('click', () => openCarrierModal('team', null));
  document.getElementById('btn-add-personal').addEventListener('click', () => openCarrierModal('personal', null));
}

function getInitials(name) {
  return (name||'').split(/[\s(]+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
}

function renderTeam() {
  const grid = document.getElementById('team-grid');
  const list = teamData[currentAccount] || [];
  const filtered = teamFilter
    ? list.filter(p => (p.nombre||'').toLowerCase().includes(teamFilter) || (p.user||'').toLowerCase().includes(teamFilter))
    : list;

  document.getElementById('team-count').textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = teamFilter
      ? `<p class="empty">Sin resultados para "${teamFilter}"</p>`
      : `<p class="empty">No hay portales en esta cuenta.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const realIdx = list.indexOf(p);
    return buildCardHTML(p, 'team', realIdx);
  }).join('');

  wireCardEvents('team');
  if (window.refreshIcons) window.refreshIcons();
}

function renderPersonal() {
  const grid = document.getElementById('personal-grid');
  const filtered = personalFilter
    ? personalData.filter(p => (p.nombre||'').toLowerCase().includes(personalFilter) || (p.user||'').toLowerCase().includes(personalFilter))
    : personalData;

  document.getElementById('personal-count').textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = personalFilter
      ? `<p class="empty">Sin resultados para "${personalFilter}"</p>`
      : `<p class="empty">Aún no has agregado carriers personales. Click en "Agregar carrier" para empezar.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const realIdx = personalData.indexOf(p);
    return buildCardHTML(p, 'personal', realIdx);
  }).join('');

  wireCardEvents('personal');
  if (window.refreshIcons) window.refreshIcons();
}

function buildCardHTML(p, scope, idx) {
  const canEdit = scope === 'personal' || isAdmin;
  return `
    <div class="carrier-card" data-scope="${scope}" data-idx="${idx}">
      ${canEdit ? `<div class="carrier-card-actions">
        <button class="carrier-act edit" title="Editar">✎</button>
        <button class="carrier-act del" title="Eliminar">×</button>
      </div>` : ''}
      <div class="carrier-icon">${getInitials(p.nombre)}</div>
      <div class="carrier-info">
        <div class="carrier-name">${p.nombre || '—'}</div>
        <div class="carrier-user">${p.user || '—'}</div>
      </div>
      <div class="carrier-arrow">›</div>
    </div>
  `;
}

function wireCardEvents(scope) {
  const grid = document.getElementById(scope === 'team' ? 'team-grid' : 'personal-grid');
  grid.querySelectorAll('.carrier-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.carrier-act')) return;
      const idx = parseInt(card.dataset.idx);
      const list = scope === 'team' ? teamData[currentAccount] : personalData;
      openDetailModal(list[idx], scope, idx);
    });
    const editBtn = card.querySelector('.carrier-act.edit');
    if (editBtn) editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCarrierModal(scope, parseInt(card.dataset.idx));
    });
    const delBtn = card.querySelector('.carrier-act.del');
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCarrier(scope, parseInt(card.dataset.idx));
    });
  });
}

// ═══ MODAL DE DETALLE (ver credencial) ═══
function openDetailModal(p, scope, idx) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal carrier-modal">
    <div class="carrier-modal-header">
      <div class="cm-label">Acceso al portal</div>
      <div class="cm-name">${p.nombre || '—'}</div>
      <button class="modal-close-x">✕</button>
    </div>
    <div class="carrier-modal-body">
      <div class="cred-row">
        <div class="cred-label">Usuario</div>
        <div class="cred-value-wrap">
          <span class="cred-value" id="dv-user">${p.user || '—'}</span>
          <button class="copy-btn-c" data-target="dv-user" title="Copiar">⧉</button>
        </div>
      </div>
      <div class="cred-row" ${!p.pass ? 'style="display:none;"' : ''}>
        <div class="cred-label">Contraseña</div>
        <div class="cred-value-wrap">
          <span class="cred-value pwd" id="dv-pass" data-pwd="${(p.pass||'').replace(/"/g,'&quot;')}" data-shown="0">••••••••</span>
          <button class="copy-btn-c eye-btn" id="eye-btn" title="Mostrar/ocultar">👁</button>
          <button class="copy-btn-c" data-pwd-copy="1" title="Copiar">⧉</button>
        </div>
      </div>
      ${p.notas ? `<div class="cred-notes"><strong>⚠ Nota</strong>${p.notas}</div>` : ''}
    </div>
    <div class="carrier-modal-footer">
      ${p.url
        ? `<a href="${p.url}" target="_blank" rel="noopener" class="btn-primary btn-acceder-c">Ir al portal <i data-lucide="external-link"></i></a>`
        : `<button class="btn-acceder-c disabled" disabled>URL no disponible</button>`}
    </div>
  </div>`;
  document.body.appendChild(modal);
  if (window.refreshIcons) window.refreshIcons();

  modal.querySelector('.modal-close-x').onclick = () => closeModal(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });

  // Eye button (toggle password)
  let autoHideTimer = null;
  const eyeBtn = modal.querySelector('#eye-btn');
  if (eyeBtn) {
    eyeBtn.addEventListener('click', () => {
      const span = modal.querySelector('#dv-pass');
      const shown = span.dataset.shown === '1';
      if (shown) {
        span.textContent = '••••••••';
        span.dataset.shown = '0';
        eyeBtn.textContent = '👁';
        if (autoHideTimer) clearTimeout(autoHideTimer);
      } else {
        span.textContent = span.dataset.pwd;
        span.dataset.shown = '1';
        eyeBtn.textContent = '🙈';
        // Auto-hide a los 30s
        autoHideTimer = setTimeout(() => {
          span.textContent = '••••••••';
          span.dataset.shown = '0';
          eyeBtn.textContent = '👁';
        }, 30000);
      }
    });
  }

  // Copy buttons
  modal.querySelectorAll('.copy-btn-c').forEach(btn => {
    if (btn.classList.contains('eye-btn')) return;
    btn.addEventListener('click', () => {
      let texto = '';
      if (btn.dataset.pwdCopy === '1') {
        texto = modal.querySelector('#dv-pass').dataset.pwd;
      } else {
        const target = btn.dataset.target;
        texto = modal.querySelector('#' + target).textContent;
      }
      copyToClipboard(texto, btn);
    });
  });
}

function copyToClipboard(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => indicate(btn)).catch(() => fallbackCopy(text, btn));
  } else {
    fallbackCopy(text, btn);
  }
}
function fallbackCopy(text, btn) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); indicate(btn); } catch(e) { alert('No se pudo copiar'); }
  document.body.removeChild(ta);
}
function indicate(btn) {
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
}

function closeModal(modal) { modal.remove(); }

// ═══ MODAL DE EDICIÓN ═══
function openCarrierModal(scope, idx) {
  const editing = idx !== null && idx >= 0;
  const list = scope === 'team' ? teamData[currentAccount] : personalData;
  const p = editing ? list[idx] : { nombre:'', user:'', pass:'', url:'', notas:'' };

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal modal-wide">
    <h3>${editing ? 'Editar carrier' : 'Nuevo carrier'} · ${scope === 'team' ? 'Cuenta '+currentAccount.toUpperCase() : 'Personal'}</h3>
    <label>Nombre del portal * <input id="cr-nombre" value="${(p.nombre||'').replace(/"/g,'&quot;')}" maxlength="50" placeholder="Ej. AETNA"></label>
    <div class="modal-grid-2">
      <label>Usuario <input id="cr-user" value="${(p.user||'').replace(/"/g,'&quot;')}" maxlength="80" placeholder="usuario o email"></label>
      <label>Contraseña <input id="cr-pass" type="text" value="${(p.pass||'').replace(/"/g,'&quot;')}" maxlength="80" placeholder="contraseña"></label>
    </div>
    <label>URL del portal <input id="cr-url" type="url" value="${(p.url||'').replace(/"/g,'&quot;')}" placeholder="https://..."></label>
    <label>Notas / PIN / Writing ID <textarea id="cr-notas" rows="2" maxlength="300" placeholder="Cualquier información adicional...">${p.notas||''}</textarea></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="cr-cancel">Cancelar</button>
      <button class="btn-primary" id="cr-save">${editing ? 'Guardar' : 'Agregar'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector('#cr-cancel').onclick = () => closeModal(modal);
  modal.querySelector('#cr-save').onclick = async () => {
    const nombre = modal.querySelector('#cr-nombre').value.trim();
    if (!nombre) { alert("El nombre del portal es obligatorio"); return; }
    const nuevo = {
      nombre,
      user: modal.querySelector('#cr-user').value.trim(),
      pass: modal.querySelector('#cr-pass').value,
      url: modal.querySelector('#cr-url').value.trim(),
      notas: modal.querySelector('#cr-notas').value.trim(),
    };

    try {
      if (scope === 'team') {
        if (editing) teamData[currentAccount][idx] = nuevo;
        else teamData[currentAccount].push(nuevo);
        // Ordenar alfabéticamente
        teamData[currentAccount].sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
        await setDoc(doc(db, "shared", "carriers-team"), teamData);

        // Log de auditoría (solo carriers del equipo, no los personales)
        logEvent(
          editing ? ACTIONS.CARRIER_TEAM_EDIT : ACTIONS.CARRIER_TEAM_ADD,
          nuevo.nombre,
          { account: currentAccount }
        );

        closeModal(modal);
        renderTeam();
      } else {
        if (editing) personalData[idx] = nuevo;
        else personalData.push(nuevo);
        personalData.sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
        await updateDoc(doc(db, "users", auth.currentUser.email), { carriers: personalData });
        closeModal(modal);
        renderPersonal();
      }
    } catch (e) {
      alert("Error guardando: " + e.message);
    }
  };
}

async function deleteCarrier(scope, idx) {
  const list = scope === 'team' ? teamData[currentAccount] : personalData;
  const p = list[idx];
  if (!confirm(`¿Eliminar carrier "${p.nombre}"?`)) return;
  try {
    if (scope === 'team') {
      teamData[currentAccount].splice(idx, 1);
      await setDoc(doc(db, "shared", "carriers-team"), teamData);

      // Log de auditoría
      logEvent(ACTIONS.CARRIER_TEAM_DELETE, p.nombre, { account: currentAccount });

      renderTeam();
    } else {
      personalData.splice(idx, 1);
      await updateDoc(doc(db, "users", auth.currentUser.email), { carriers: personalData });
      renderPersonal();
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}
