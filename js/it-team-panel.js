// ═══════════════════════════════════════════════════════════════
// IT Console · Módulo Equipo Interno (Hero Team) — Fase 1
// ═══════════════════════════════════════════════════════════════
// Vista person-centric del equipo Hero: usa users/{email} del Hub como fuente
// única de personas y agrupa por persona sus dispositivos (match por nombre
// con dev.usuario) e historial de intervenciones. Las notas IT viven en
// it-team/{email}.
//
// Depende de globals de it-console.js:
//   - allDevices, WORKER_URL, authFetch, setLastUpdated
//   - DEV_ESTADO_COLOR, INT_TIPO_COLOR
//   - escHtml, escJs
//   - showPage, openDeviceDetail (para navegar al detalle del dispositivo)
//
// Fase 2 pendiente: checklist mensual recurrente + templates configurables.

const IT_ROLES_INTERNOS = ['admin', 'interno', 'IT', 'finanzas'];

let internalTeam = [];         // users/{email} filtrados por rol
let filteredInternal = [];
let currentInternalMember = null;
let internalTeamLoaded = false;

// ── Control de vista (toggle Workspace / Interno) ─────────────
async function switchUsersView(view) {
  const tabWs = document.getElementById('uv-tab-workspace');
  const tabIn = document.getElementById('uv-tab-internal');
  const viewWs = document.getElementById('users-view-workspace');
  const viewIn = document.getElementById('users-view-internal');
  if (!tabWs || !tabIn || !viewWs || !viewIn) return;
  const isInternal = view === 'internal';
  tabWs.classList.toggle('active', !isInternal);
  tabIn.classList.toggle('active', isInternal);
  viewWs.hidden = isInternal;
  viewIn.hidden = !isInternal;
  if (isInternal && !internalTeamLoaded) await loadInternalTeam();
}
window.switchUsersView = switchUsersView;

// ── Carga desde user-store + devices ──────────────────────────
async function loadInternalTeam() {
  const grid = document.getElementById('itm-grid');
  if (grid) _renderGridPlaceholder(grid, 'tabler:users-group', 'Cargando equipo interno…');
  try {
    const userStore = await import('/js/user-store.js');
    const users = await userStore.getAllUsers({ includeExcluded: false });
    internalTeam = (users || [])
      .filter(u => IT_ROLES_INTERNOS.includes(u.access && u.access.role))
      .sort((a, b) => ((a.identity && a.identity.name) || '').localeCompare((b.identity && b.identity.name) || '', 'es'));
    internalTeamLoaded = true;
    // Refrescar devices si no están en cache (para linkear en el grid)
    if (typeof allDevices !== 'undefined' && (!allDevices || !allDevices.length)) {
      try {
        const resp = await authFetch(WORKER_URL + '/device?withZoho=1');
        const data = await resp.json();
        if (resp.ok) allDevices = data.devices || [];
      } catch (_) { /* silencioso: el grid muestra 0 disp por persona */ }
    }
    filterInternalTeam();
    if (typeof setLastUpdated === 'function') setLastUpdated('itm-last-updated');
  } catch (err) {
    if (grid) _renderGridPlaceholder(grid, 'tabler:alert-triangle', 'Error cargando equipo: ' + (err.message || String(err)), true);
  }
}
window.loadInternalTeam = loadInternalTeam;

// ── Filtro por búsqueda + rol ─────────────────────────────────
function filterInternalTeam() {
  const searchEl = document.getElementById('itm-search');
  const rolEl = document.getElementById('itm-filter-rol');
  const q = ((searchEl && searchEl.value) || '').toLowerCase().trim();
  const rol = (rolEl && rolEl.value) || '';
  let filtered = internalTeam;
  if (rol) filtered = filtered.filter(u => u.access && u.access.role === rol);
  if (q) filtered = filtered.filter(u => {
    const name = ((u.identity && u.identity.name) || '').toLowerCase();
    const email = (u._email || '').toLowerCase();
    const cargo = ((u.display && u.display.jobTitle) || '').toLowerCase();
    return name.includes(q) || email.includes(q) || cargo.includes(q);
  });
  filteredInternal = filtered;
  renderInternalTeamGrid();
}
window.filterInternalTeam = filterInternalTeam;

// ── Render del grid de personas ───────────────────────────────
function renderInternalTeamGrid() {
  const grid = document.getElementById('itm-grid');
  const countEl = document.getElementById('itm-count');
  if (countEl) countEl.textContent = filteredInternal.length + ' persona' + (filteredInternal.length !== 1 ? 's' : '');
  if (!grid) return;
  grid.replaceChildren();
  if (!filteredInternal.length) {
    _renderGridPlaceholder(grid, 'tabler:users-group', 'Sin resultados con estos filtros');
    return;
  }
  filteredInternal.forEach(u => grid.appendChild(_buildPersonCard(u)));
}

function _buildPersonCard(u) {
  const name = (u.identity && u.identity.name) || u._email;
  const cargo = (u.display && u.display.jobTitle) || '—';
  const email = u._email;
  const photo = (u.identity && u.identity.photo) || '';
  const role = (u.access && u.access.role) || '—';
  const devices = findDevicesForMember(u);
  const devCount = devices.length;

  const card = document.createElement('div');
  card.className = 'action-card';
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => openInternalMember(email));

  // Header con foto o iniciales + nombre + cargo
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:12px;';
  head.appendChild(_buildAvatar(name, photo, 48));
  const nameBlock = document.createElement('div');
  nameBlock.style.cssText = 'min-width:0;flex:1;';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:14px;font-weight:600;color:var(--hero-text-primary);line-height:1.2;';
  nameEl.textContent = name;
  const cargoEl = document.createElement('div');
  cargoEl.style.cssText = 'font-size:12px;color:var(--hero-text-muted);margin-top:2px;';
  cargoEl.textContent = cargo;
  nameBlock.append(nameEl, cargoEl);
  head.appendChild(nameBlock);
  card.appendChild(head);

  // Email
  const emailEl = document.createElement('div');
  emailEl.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--hero-text-muted);margin-bottom:10px;word-break:break-all;';
  emailEl.textContent = email;
  card.appendChild(emailEl);

  // Chips: rol + N dispositivos
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  chips.appendChild(_buildChip(role, 'rgba(0,0,0,0.05)', 'var(--hero-text-muted)'));
  const devChip = _buildChip(
    devCount + ' disp.',
    devCount ? 'var(--hero-primary-light)' : 'rgba(0,0,0,0.05)',
    devCount ? 'var(--hero-primary-text)' : 'var(--hero-text-muted)'
  );
  const devIcon = document.createElement('iconify-icon');
  devIcon.setAttribute('icon', 'tabler:device-desktop');
  devIcon.style.marginRight = '4px';
  devChip.prepend(devIcon);
  chips.appendChild(devChip);
  card.appendChild(chips);

  return card;
}

function _buildAvatar(name, photo, size) {
  const el = document.createElement('div');
  el.style.cssText =
    'width:' + size + 'px;height:' + size + 'px;border-radius:50%;flex-shrink:0;' +
    'border:2px solid var(--hero-border-card);' +
    'background-size:cover;background-position:center;' +
    'display:flex;align-items:center;justify-content:center;' +
    'font-weight:700;font-size:' + Math.round(size / 3) + 'px;';
  if (photo) {
    el.style.backgroundImage = "url('" + photo.replace(/'/g, "\\'") + "')";
  } else {
    el.style.background = 'var(--hero-primary-light)';
    el.style.color = 'var(--hero-primary-text)';
    const initials = String(name || '?').split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
    el.textContent = initials || '?';
  }
  return el;
}

function _buildChip(text, bg, color) {
  const chip = document.createElement('span');
  chip.style.cssText =
    'font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:20px;' +
    'display:inline-flex;align-items:center;background:' + bg + ';color:' + color + ';';
  chip.appendChild(document.createTextNode(text));
  return chip;
}

function _renderGridPlaceholder(grid, iconName, message, isError) {
  grid.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'info-box';
  wrap.style.cssText = 'text-align:center;padding:40px;grid-column:1/-1;';
  if (isError) wrap.style.color = 'var(--hero-danger)';
  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = 'font-size:32px;opacity:0.3;margin-bottom:12px;';
  const icon = document.createElement('iconify-icon');
  icon.setAttribute('icon', iconName);
  iconWrap.appendChild(icon);
  wrap.appendChild(iconWrap);
  const msg = document.createElement('div');
  msg.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--hero-text-muted);';
  msg.textContent = message;
  wrap.appendChild(msg);
  grid.appendChild(wrap);
}

// ── Match user → dispositivos por nombre ──────────────────────
// dev.usuario es texto libre. Match tolerante: exacto, o primer nombre +
// primer apellido (para "María López" ≈ "María de los Ángeles López").
function findDevicesForMember(user) {
  if (typeof allDevices === 'undefined' || !allDevices || !allDevices.length) return [];
  const name = _normalizeInternalName((user.identity && user.identity.name) || '');
  if (!name) return [];
  const parts = name.split(/\s+/).filter(Boolean);
  return allDevices.filter(d => {
    const owner = _normalizeInternalName(d.usuario || '');
    if (!owner) return false;
    if (owner === name) return true;
    if (parts.length < 2) return false;
    const oparts = owner.split(/\s+/).filter(Boolean);
    if (oparts.length < 2) return false;
    return oparts[0] === parts[0] && oparts[oparts.length - 1] === parts[parts.length - 1];
  });
}

function _normalizeInternalName(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
}

// Formato de fecha US para todo el módulo (MM/DD/YYYY hh:mm AM/PM ET).
// Timezone ET porque Hero Insurance opera en Florida.
function _fmtUS(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

// Resuelve dev.usuario (texto libre "María López") al email correspondiente
// del user store. Usado por la navegación cruzada desde la vista Dispositivos
// para abrir la ficha de la persona en un click. Devuelve null si no matchea.
async function resolveOwnerEmail(ownerName) {
  if (!ownerName) return null;
  // Asegurar que internalTeam esté poblado (puede que Fernando entre a
  // Dispositivos antes que a Usuarios en la sesión).
  if (!internalTeamLoaded) {
    try {
      const userStore = await import('/js/user-store.js');
      const users = await userStore.getAllUsers({ includeExcluded: false });
      internalTeam = (users || [])
        .filter(u => IT_ROLES_INTERNOS.includes(u.access && u.access.role))
        .sort((a, b) => ((a.identity && a.identity.name) || '').localeCompare((b.identity && b.identity.name) || '', 'es'));
      internalTeamLoaded = true;
    } catch (_) { return null; }
  }
  const target = _normalizeInternalName(ownerName);
  if (!target) return null;
  const tparts = target.split(/\s+/).filter(Boolean);
  const hit = internalTeam.find(u => {
    const uname = _normalizeInternalName((u.identity && u.identity.name) || '');
    if (uname === target) return true;
    if (tparts.length < 2) return false;
    const uparts = uname.split(/\s+/).filter(Boolean);
    if (uparts.length < 2) return false;
    return uparts[0] === tparts[0] && uparts[uparts.length - 1] === tparts[tparts.length - 1];
  });
  return hit ? hit._email : null;
}
window.resolveOwnerEmail = resolveOwnerEmail;

// Wrapper para navegación cruzada: recibe el nombre libre y abre la ficha si
// hay match. Si no hay match, muestra un aviso simple. Usado desde onclick
// inline en el grid y ficha de dispositivos.
async function openInternalMemberByOwnerName(ownerName) {
  const email = await resolveOwnerEmail(ownerName);
  if (!email) {
    if (typeof showToast === 'function') showToast('No encontré esta persona en el Equipo Interno · revisa el nombre del dispositivo');
    return;
  }
  if (typeof showPage === 'function') showPage('usuarios');
  await switchUsersView('internal');
  setTimeout(() => openInternalMember(email), 200);
}
window.openInternalMemberByOwnerName = openInternalMemberByOwnerName;

// ── Ficha del miembro (modal) ─────────────────────────────────
async function openInternalMember(email) {
  const user = internalTeam.find(u => u._email === email);
  if (!user) return;
  currentInternalMember = user;
  const modal = document.getElementById('internal-member-modal');
  if (!modal) return;
  modal.style.display = 'block';

  // Header
  const name = (user.identity && user.identity.name) || email;
  const photo = (user.identity && user.identity.photo) || '';
  const photoEl = document.getElementById('imm-photo');
  if (photoEl) {
    photoEl.textContent = '';
    if (photo) {
      photoEl.style.backgroundImage = "url('" + photo.replace(/'/g, "\\'") + "')";
      photoEl.style.background = '';
    } else {
      photoEl.style.backgroundImage = '';
      photoEl.style.background = 'var(--hero-primary-light)';
      photoEl.style.color = 'var(--hero-primary)';
      photoEl.style.display = 'flex';
      photoEl.style.alignItems = 'center';
      photoEl.style.justifyContent = 'center';
      photoEl.style.fontWeight = '700';
      photoEl.style.fontSize = '20px';
      photoEl.textContent = name.charAt(0).toUpperCase();
    }
  }
  document.getElementById('imm-title').textContent = name;
  document.getElementById('imm-subtitle').textContent =
    ((user.display && user.display.jobTitle) || '—') + ' · ' + ((user.access && user.access.role) || '—');
  document.getElementById('imm-email').textContent = email;

  // Dispositivos + intervenciones
  const devices = findDevicesForMember(user);
  renderMemberDevices(devices);
  renderMemberInterventions(devices);
  _populateQuickInterventionForm(devices);

  // Notas — cargar desde Firestore it-team/{email}
  const notesEl = document.getElementById('imm-notes');
  const notesStatusEl = document.getElementById('imm-notes-status');
  notesEl.value = 'Cargando…';
  notesEl.disabled = true;
  notesStatusEl.textContent = '—';
  try {
    await import('/js/firebase-config.js');
    const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const db = getFirestore();
    const snap = await getDoc(doc(db, 'it-team', email));
    const notes = snap.exists() ? (snap.data().notes || '') : '';
    notesEl.value = notes;
    notesEl.disabled = false;
    if (snap.exists() && snap.data().updatedAt) {
      const raw = snap.data().updatedAt;
      const d = raw.toDate ? raw.toDate() : new Date(raw);
      notesStatusEl.textContent = 'Última edición: ' + _fmtUS(d);
    } else {
      notesStatusEl.textContent = 'Sin notas guardadas todavía';
    }
  } catch (e) {
    notesEl.value = '';
    notesEl.disabled = false;
    notesStatusEl.textContent = 'No se pudieron cargar las notas: ' + (e.message || e);
  }
}
window.openInternalMember = openInternalMember;

// ── Render de dispositivos asignados ──────────────────────────
function renderMemberDevices(devices) {
  const wrap = document.getElementById('imm-devices');
  if (!wrap) return;
  wrap.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--hero-text-muted);font-style:italic;';
    empty.textContent = 'Sin dispositivos asignados. Para vincular uno, ve a Soporte → Dispositivos y asigna el nombre de esta persona en el campo Usuario.';
    wrap.appendChild(empty);
    return;
  }
  devices.forEach(d => wrap.appendChild(_buildDeviceRow(d)));
}

function _buildDeviceRow(d) {
  const isOnline = (d.zohoStatus || '').toLowerCase() === 'online';
  const dotColor = isOnline ? 'var(--hero-success)' : 'var(--hero-text-muted)';
  const eColor = (typeof DEV_ESTADO_COLOR !== 'undefined' && DEV_ESTADO_COLOR[d.estado]) || 'var(--hero-text-body)';
  const so = d.so || d.zohoLiveOs || 'SO ?';

  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;padding:10px 12px;' +
    'background:var(--hero-bg-page);border:1px solid var(--hero-border-card);' +
    'border-radius:8px;margin-bottom:6px;gap:12px;cursor:pointer;';
  row.title = 'Abrir ficha del equipo';
  row.addEventListener('click', () => {
    // Guardar el contexto de retorno para que openDeviceDetail muestre
    // el botón "Volver a {persona}" y el user pueda regresar de un click.
    if (currentInternalMember) {
      window._returnToInternalMember = {
        email: currentInternalMember._email,
        name: (currentInternalMember.identity && currentInternalMember.identity.name) || currentInternalMember._email
      };
    }
    closeInternalMemberModal();
    if (typeof showPage === 'function') showPage('dispositivos');
    setTimeout(() => { if (typeof openDeviceDetail === 'function') openDeviceDetail(d.id); }, 250);
  });

  const left = document.createElement('div');
  left.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0;flex:1;';
  const dot = document.createElement('div');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + dotColor + ';';
  dot.title = isOnline ? 'Online' : 'Offline';
  left.appendChild(dot);
  const info = document.createElement('div');
  info.style.cssText = 'min-width:0;';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--hero-text-primary);';
  nameEl.textContent = d.nombre || '—';
  const metaEl = document.createElement('div');
  metaEl.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);';
  metaEl.textContent = (d.tipo || '—') + ' · ' + so;
  info.append(nameEl, metaEl);
  left.appendChild(info);
  row.appendChild(left);

  const estado = document.createElement('span');
  estado.style.cssText =
    'font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:20px;' +
    'background:rgba(0,0,0,0.05);flex-shrink:0;color:' + eColor + ';';
  estado.textContent = d.estado || '—';
  row.appendChild(estado);

  return row;
}

// ── Historial de intervenciones (agregado) ────────────────────
function renderMemberInterventions(devices) {
  const wrap = document.getElementById('imm-interventions');
  if (!wrap) return;
  wrap.replaceChildren();
  const all = [];
  devices.forEach(d => {
    (d.intervenciones || []).forEach(i => all.push({
      tipo: i.tipo, descripcion: i.descripcion, notas: i.notas, fecha: i.fecha,
      deviceName: d.nombre
    }));
  });
  all.sort((a, b) => (new Date(b.fecha || 0).getTime()) - (new Date(a.fecha || 0).getTime()));
  if (!all.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--hero-text-muted);font-style:italic;';
    empty.textContent = 'Sin intervenciones registradas en sus dispositivos.';
    wrap.appendChild(empty);
    return;
  }
  const cap = 20;
  all.slice(0, cap).forEach(i => wrap.appendChild(_buildInterventionRow(i)));
  if (all.length > cap) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:var(--hero-text-muted);text-align:center;margin-top:6px;';
    more.textContent = 'Mostrando las últimas ' + cap + ' de ' + all.length;
    wrap.appendChild(more);
  }
}

function _buildInterventionRow(i) {
  const color = (typeof INT_TIPO_COLOR !== 'undefined' && INT_TIPO_COLOR[i.tipo]) || 'var(--hero-text-body)';
  const dt = i.fecha ? _fmtUS(new Date(i.fecha)) : '—';

  const row = document.createElement('div');
  row.style.cssText =
    'padding:10px 12px;background:var(--hero-bg-page);' +
    'border:1px solid var(--hero-border-card);border-left:3px solid ' + color + ';' +
    'border-radius:8px;margin-bottom:6px;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:4px;flex-wrap:wrap;';
  const tipo = document.createElement('span');
  tipo.style.cssText = 'font-family:var(--mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:' + color + ';';
  tipo.textContent = i.tipo || '—';
  const fecha = document.createElement('span');
  fecha.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);';
  fecha.textContent = dt;
  head.append(tipo, fecha);
  row.appendChild(head);

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:13px;color:var(--hero-text-primary);';
  desc.textContent = i.descripcion || '—';
  row.appendChild(desc);

  if (i.notas) {
    const notas = document.createElement('div');
    notas.style.cssText = 'font-size:11px;color:var(--hero-text-muted);margin-top:4px;';
    notas.textContent = i.notas;
    row.appendChild(notas);
  }

  const equipoLine = document.createElement('div');
  equipoLine.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--hero-text-muted);margin-top:6px;';
  equipoLine.textContent = 'Equipo: ' + (i.deviceName || '—');
  row.appendChild(equipoLine);

  return row;
}

// ── Guardar notas + cerrar modal ──────────────────────────────
async function saveInternalMemberNotes() {
  if (!currentInternalMember) return;
  const email = currentInternalMember._email;
  const notes = document.getElementById('imm-notes').value;
  const btn = document.getElementById('imm-notes-save');
  const statusEl = document.getElementById('imm-notes-status');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await import('/js/firebase-config.js');
    const { getFirestore, doc, setDoc, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const db = getFirestore();
    const actor = (JSON.parse(sessionStorage.getItem('hero_auth') || '{}').email) || 'system';
    await setDoc(doc(db, 'it-team', email), {
      notes,
      updatedAt: Timestamp.now(),
      updatedBy: actor
    }, { merge: true });
    statusEl.textContent = 'Guardado hace un momento por ' + actor;
    btn.textContent = 'Guardado ✓';
    setTimeout(() => {
      btn.textContent = 'Guardar notas';
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    statusEl.textContent = 'Error al guardar: ' + (e.message || e);
    btn.textContent = 'Guardar notas';
    btn.disabled = false;
  }
}
window.saveInternalMemberNotes = saveInternalMemberNotes;

function closeInternalMemberModal() {
  const modal = document.getElementById('internal-member-modal');
  if (modal) modal.style.display = 'none';
  currentInternalMember = null;
}
window.closeInternalMemberModal = closeInternalMemberModal;

// ── Registrar intervención rápida desde la ficha de persona ───
// Popula el <select> con los dispositivos del user y guarda un nuevo
// evento vía el mismo endpoint que usa la ficha del dispositivo. Al guardar,
// actualiza allDevices en cache + re-renderiza el historial del modal.
function _populateQuickInterventionForm(devices) {
  const wrap = document.getElementById('imm-quick-int-wrap');
  const sel = document.getElementById('imm-int-device');
  const desc = document.getElementById('imm-int-descripcion');
  const notas = document.getElementById('imm-int-notas');
  if (!wrap || !sel) return;
  if (!devices.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  sel.replaceChildren();
  devices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = (d.nombre || '?') + (d.tipo ? ' (' + d.tipo + ')' : '');
    sel.appendChild(opt);
  });
  if (desc) desc.value = '';
  if (notas) notas.value = '';
}

async function registrarIntervencionDesdePersona() {
  if (!currentInternalMember) return;
  const devId = document.getElementById('imm-int-device').value;
  const tipo = document.getElementById('imm-int-tipo').value;
  const descripcion = document.getElementById('imm-int-descripcion').value.trim();
  const notas = document.getElementById('imm-int-notas').value.trim();
  if (!devId) { if (typeof showToast === 'function') showToast('Elige un dispositivo'); return; }
  if (!descripcion) { if (typeof showToast === 'function') showToast('Escribe una descripción de la intervención'); return; }

  const btn = document.getElementById('imm-int-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const resp = await authFetch(WORKER_URL + '/device/intervencion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: devId, tipo, descripcion, notas })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    // Actualizar cache local de devices
    const dev = allDevices.find(d => d.id === devId);
    if (dev) {
      dev.intervenciones = dev.intervenciones || [];
      dev.intervenciones.unshift(data.intervencion);
    }

    // Re-render de la ficha
    const devices = findDevicesForMember(currentInternalMember);
    renderMemberInterventions(devices);
    document.getElementById('imm-int-descripcion').value = '';
    document.getElementById('imm-int-notas').value = '';
    if (typeof showToast === 'function') showToast('Intervención registrada');
    if (typeof auditLog === 'function') auditLog('dispositivo', tipo + ' en ' + (dev && dev.nombre || 'equipo'), descripcion);

    btn.textContent = 'Registrado ✓';
    setTimeout(() => { btn.textContent = 'Registrar'; btn.disabled = false; }, 1500);
  } catch (e) {
    btn.textContent = 'Registrar';
    btn.disabled = false;
    if (typeof showToast === 'function') showToast('Error: ' + (e.message || e));
  }
}
window.registrarIntervencionDesdePersona = registrarIntervencionDesdePersona;

// ── Retorno desde la ficha de dispositivo hacia la persona ────
// Llamado por el botón que openDeviceDetail inyecta cuando el user llegó
// a la ficha del equipo desde la ficha de persona.
async function returnToInternalMemberFromDevice() {
  const ctx = window._returnToInternalMember;
  if (!ctx || !ctx.email) return;
  window._returnToInternalMember = null;
  if (typeof closeDeviceDetail === 'function') closeDeviceDetail();
  if (typeof showPage === 'function') showPage('usuarios');
  await switchUsersView('internal');
  setTimeout(() => openInternalMember(ctx.email), 150);
}
window.returnToInternalMemberFromDevice = returnToInternalMemberFromDevice;
