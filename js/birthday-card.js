// ═══════════════════════════════════════════
// Hero Hub · Tarjeta de Cumpleaños Colectiva
// Funciona como módulo autónomo
// ═══════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Generar slug del nombre para usar como ID
function slugify(name) {
  return (name || '')
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCardId(person, year) {
  return `${year}_${slugify(person.name)}`;
}

function currentYear() {
  return new Date().getFullYear();
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}

// Determinar si HOY es el cumpleaños de la persona
function isBirthdayToday(person) {
  if (!person.birthdate || !/^\d{2}-\d{2}$/.test(person.birthdate)) return false;
  const [m, d] = person.birthdate.split('-').map(x => parseInt(x));
  const today = new Date();
  return today.getMonth() + 1 === m && today.getDate() === d;
}

// Cargar la tarjeta del cumpleañero
export async function loadBirthdayCard(person) {
  const cardId = getCardId(person, currentYear());
  try {
    const snap = await getDoc(doc(db, "birthdays", cardId));
    if (snap.exists()) return { ...snap.data(), id: cardId };
  } catch (e) { console.warn("Error cargando tarjeta:", e.message); }
  return {
    id: cardId,
    honoreeName: person.name,
    honoreeEmail: (person.email || [])[0] || '',
    birthdate: person.birthdate,
    messages: [],
    viewed: false
  };
}

// Abrir el modal de "Preparar felicitación"
export function openBirthdayCardModal(person, currentUser) {
  const modal = document.createElement('div');
  modal.className = 'bday-card-overlay';
  modal.innerHTML = `<div class="bday-card-modal">
    <div class="bc-rays"></div>
    <button class="bc-close" id="bc-close"><i data-lucide="x"></i></button>

    <div class="bc-header">
      <div class="bc-avatar-wrap">
        <div class="bc-avatar-ring"></div>
        <img class="bc-avatar" src="${person.photo}" alt="${person.name}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=06a3b6&color=fff&size=200'">
      </div>
      <div class="bc-title-block">
        <div class="bc-kicker">🎂 TARJETA COLECTIVA DE CUMPLEAÑOS</div>
        <div class="bc-title" id="bc-title">Para ${person.name}</div>
        <div class="bc-subtitle" id="bc-subtitle">Cargando...</div>
      </div>
    </div>

    <div class="bc-divider"></div>

    <div class="bc-form" id="bc-form">
      <div class="bc-form-title" id="bc-form-title">✍️ Deja tu mensaje</div>
      <textarea id="bc-message" placeholder="Escribe tu mensaje de cumpleaños para ${person.name.split(' ')[0]}..." maxlength="400" rows="3"></textarea>
      <div class="bc-form-row">
        <span class="bc-char" id="bc-char">0/400</span>
        <div class="bc-form-btns">
          <button class="btn-ghost-dark" id="bc-delete" style="display:none;">🗑 Borrar mío</button>
          <button class="btn-primary" id="bc-save">Publicar felicitación ✨</button>
        </div>
      </div>
    </div>

    <div class="bc-divider"></div>

    <div class="bc-messages-section">
      <div class="bc-messages-title">
        <span>💌 Felicitaciones del equipo</span>
        <span class="bc-messages-count" id="bc-messages-count">0</span>
      </div>
      <div class="bc-messages-list" id="bc-messages-list">
        <p class="loading">Cargando mensajes...</p>
      </div>
    </div>

  </div>`;
  document.body.appendChild(modal);
  if (window.refreshIcons) window.refreshIcons();

  // Cerrar
  modal.querySelector("#bc-close").onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Cargar tarjeta
  loadAndRenderCard(person, currentUser, modal);

  // Contador de caracteres
  const textarea = modal.querySelector("#bc-message");
  const charEl = modal.querySelector("#bc-char");
  textarea.addEventListener('input', () => {
    charEl.textContent = `${textarea.value.length}/400`;
    charEl.classList.toggle('warn', textarea.value.length > 370);
  });

  // Guardar
  modal.querySelector("#bc-save").addEventListener('click', async () => {
    const msg = textarea.value.trim();
    if (msg.length < 5) {
      textarea.focus();
      heroToast.error("El mensaje debe tener al menos 5 caracteres");
      return;
    }
    await saveMessage(person, currentUser, msg);
    await loadAndRenderCard(person, currentUser, modal);
    heroToast.success("Felicitación guardada");
  });

  // Borrar mi mensaje
  modal.querySelector("#bc-delete").addEventListener('click', async () => {
    const ok = await heroConfirm({
      title: "Borrar felicitación",
      message: "¿Borrar tu mensaje de esta tarjeta?",
      confirmLabel: "Borrar",
      variant: "danger"
    });
    if (!ok) return;
    await deleteMessage(person, currentUser);
    await loadAndRenderCard(person, currentUser, modal);
    heroToast.success("Mensaje borrado");
  });
}

async function loadAndRenderCard(person, currentUser, modal) {
  const card = await loadBirthdayCard(person);
  const messages = card.messages || [];

  // Título y subtítulo
  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if (person.birthdate && /^\d{2}-\d{2}$/.test(person.birthdate)) {
    const [m, d] = person.birthdate.split('-').map(x => parseInt(x));
    modal.querySelector("#bc-subtitle").textContent = `🗓️ ${d} de ${MONTHS[m-1]} · ${messages.length} felicitación${messages.length !== 1 ? 'es' : ''}`;
  }

  // Si el usuario actual YA escribió un mensaje, mostrarlo en el textarea
  const myMessage = messages.find(m => m.fromEmail === currentUser.email);
  const textarea = modal.querySelector("#bc-message");
  const deleteBtn = modal.querySelector("#bc-delete");
  const saveBtn = modal.querySelector("#bc-save");
  const formTitle = modal.querySelector("#bc-form-title");

  if (myMessage) {
    textarea.value = myMessage.message;
    deleteBtn.style.display = 'inline-flex';
    saveBtn.textContent = '💾 Actualizar mi mensaje';
    formTitle.textContent = '✍️ Tu mensaje (puedes editarlo)';
    modal.querySelector("#bc-char").textContent = `${myMessage.message.length}/400`;
  } else {
    textarea.value = '';
    deleteBtn.style.display = 'none';
    saveBtn.textContent = 'Publicar felicitación ✨';
    formTitle.textContent = '✍️ Deja tu mensaje';
    modal.querySelector("#bc-char").textContent = '0/400';
  }

  // Renderizar lista de mensajes
  modal.querySelector("#bc-messages-count").textContent = messages.length;
  const list = modal.querySelector("#bc-messages-list");

  if (!messages.length) {
    list.innerHTML = `<p class="bc-empty">Aún no hay felicitaciones. ¡Sé el primero! 💝</p>`;
    return;
  }

  // Ordenar por fecha (más recientes arriba)
  const sorted = [...messages].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  list.innerHTML = sorted.map(m => {
    const isMine = m.fromEmail === currentUser.email;
    const initials = (m.fromName || '?').split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase();
    const date = new Date(m.createdAt).toLocaleDateString('es-ES', { day:'2-digit', month:'short' });
    const photoEl = m.fromPhoto
      ? `<img src="${m.fromPhoto}" alt="" class="bc-msg-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="bc-msg-initials" style="display:none;">${initials}</div>`
      : `<div class="bc-msg-initials">${initials}</div>`;

    return `<div class="bc-msg ${isMine ? 'mine' : ''}">
      ${photoEl}
      <div class="bc-msg-body">
        <div class="bc-msg-header">
          <span class="bc-msg-author">${m.fromName}</span>
          ${isMine ? '<span class="bc-msg-mine-tag">tú</span>' : ''}
          <span class="bc-msg-date">${date}</span>
        </div>
        <div class="bc-msg-text">${escapeHtml(m.message)}</div>
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function saveMessage(person, currentUser, messageText) {
  const cardId = getCardId(person, currentYear());
  const ref = doc(db, "birthdays", cardId);

  try {
    const snap = await getDoc(ref);
    let data = snap.exists() ? snap.data() : {
      honoreeName: person.name,
      honoreeEmail: (person.email || [])[0] || '',
      birthdate: person.birthdate,
      messages: [],
      viewed: false
    };
    if (!Array.isArray(data.messages)) data.messages = [];

    // Ver si ya tiene mensaje del mismo usuario
    const idx = data.messages.findIndex(m => m.fromEmail === currentUser.email);
    const newMsg = {
      fromEmail: currentUser.email,
      fromName: currentUser.displayName || currentUser.email.split('@')[0],
      fromPhoto: currentUser.photoURL || '',
      message: messageText,
      createdAt: new Date().toISOString()
    };
    if (idx >= 0) data.messages[idx] = newMsg;
    else data.messages.push(newMsg);

    await setDoc(ref, data);
  } catch (e) {
    heroToast.error("No se pudo guardar: " + e.message);
  }
}

async function deleteMessage(person, currentUser) {
  const cardId = getCardId(person, currentYear());
  const ref = doc(db, "birthdays", cardId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    data.messages = (data.messages || []).filter(m => m.fromEmail !== currentUser.email);
    await setDoc(ref, data);
  } catch (e) {
    heroToast.error("No se pudo borrar: " + e.message);
  }
}

// ═══ POP-UP ESPECIAL DEL DÍA DEL CUMPLE ═══
// Si el usuario es el cumpleañero y NO ha visto su tarjeta hoy, mostrar pop-up especial
export async function checkBirthdayPopup(currentUser, teamMembers) {
  try {
    // Buscar a este usuario en el equipo
    const me = teamMembers.find(m =>
      (m.email || []).some(e => e.toLowerCase() === currentUser.email.toLowerCase())
    );
    if (!me) return;

    // ¿Es mi cumple hoy?
    if (!isBirthdayToday(me)) return;

    // ¿Ya lo vi hoy?
    const userSnap = await getDoc(doc(db, "users", currentUser.email));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const todayKey = getTodayKey();
    if (userData.birthdayCardSeenDate === todayKey) return;

    // Cargar la tarjeta
    const card = await loadBirthdayCard(me);
    if (!card.messages || card.messages.length === 0) return;

    // Mostrar pop-up especial
    showBirthdayCelebrationPopup(me, card, currentUser);

  } catch (e) {
    console.warn("Error en birthday popup:", e.message);
  }
}

function showBirthdayCelebrationPopup(person, card, currentUser) {
  const messages = card.messages || [];
  const sorted = [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const modal = document.createElement('div');
  modal.className = 'bday-celebration-overlay';
  modal.innerHTML = `<div class="bday-celebration-modal">
    <div class="bcel-confetti">
      ${Array.from({length: 25}).map((_, i) => `<span class="cf cf${i}">${['🎈','🎉','🎂','✨','🎊','⭐'][i%6]}</span>`).join('')}
    </div>

    <button class="bcel-close" id="bcel-close"><i data-lucide="x"></i></button>

    <div class="bcel-header">
      <div class="bcel-cake">🎂</div>
      <div class="bcel-title">¡Feliz Cumpleaños, ${person.name.split(' ')[0]}!</div>
      <div class="bcel-subtitle">Tu equipo preparó esta tarjeta con cariño 💝</div>
    </div>

    <div class="bcel-messages-count">${messages.length} ${messages.length === 1 ? 'felicitación' : 'felicitaciones'} de tu equipo</div>

    <div class="bcel-messages">
      ${sorted.map(m => {
        const initials = (m.fromName || '?').split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase();
        const photoEl = m.fromPhoto
          ? `<img src="${m.fromPhoto}" alt="" class="bcel-msg-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
             <div class="bcel-msg-initials" style="display:none;">${initials}</div>`
          : `<div class="bcel-msg-initials">${initials}</div>`;
        return `<div class="bcel-msg">
          ${photoEl}
          <div class="bcel-msg-body">
            <div class="bcel-msg-author">${m.fromName}</div>
            <div class="bcel-msg-text">${escapeHtml(m.message)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="bcel-footer">
      <button class="btn-primary bcel-big-btn" id="bcel-ok">Gracias a todos 🙏</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  if (window.refreshIcons) window.refreshIcons();

  const closeAndMark = async () => {
    try {
      await setDoc(doc(db, "users", currentUser.email), {
        birthdayCardSeenDate: getTodayKey()
      }, { merge: true });
    } catch (e) { console.warn(e); }
    modal.remove();
  };

  modal.querySelector("#bcel-close").onclick = closeAndMark;
  modal.querySelector("#bcel-ok").onclick = closeAndMark;
}
