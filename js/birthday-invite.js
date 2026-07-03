// ═══════════════════════════════════════════
// Hero Hub · Invitación a felicitar cumpleañero
// ═══════════════════════════════════════════
// Pop-up que aparece a TODOS los del equipo (excepto al cumpleañero)
// el día anterior y el mismo día del cumple, invitándolos a escribir
// una felicitación en la tarjeta colectiva.
//
// Persistencia: users/{email}.birthdayInvites = { "<cardId>": "YYYY-MM-DD" }
//   - Si el user ya vio este cumple hoy, no se vuelve a mostrar.
//   - Al día siguiente, si sigue vigente, aparece de nuevo.

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { loadBirthdayCard, saveMessage } from "./birthday-card.js";

// Emojis populares para el picker inline. Se evitan banderas (no renderizan
// bien en Windows). Todos están en Segoe UI Emoji / Apple Color Emoji.
const EMOJI_PICKER = ["🎂","🎉","🎈","🎊","✨","💝","🙌","🥳","❤️","🌟"];

const MESES_FULL = ['enero','febrero','marzo','abril','mayo','junio',
                    'julio','agosto','septiembre','octubre','noviembre','diciembre'];

function slugify(name) {
  return (name || '')
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseBirthdate(bd) {
  if (!bd || typeof bd !== 'string' || !/^\d{2}-\d{2}$/.test(bd)) return null;
  const [m, d] = bd.split('-').map(x => parseInt(x));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { m, d };
}

function daysUntil(bd) {
  const today = new Date(); today.setHours(0,0,0,0);
  const thisYear = new Date(today.getFullYear(), bd.m-1, bd.d);
  if (thisYear.getTime() === today.getTime()) return 0;
  const target = thisYear > today ? thisYear : new Date(today.getFullYear()+1, bd.m-1, bd.d);
  return Math.ceil((target - today) / (1000*60*60*24));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Devuelve el próximo cumpleañero si cae HOY o MAÑANA. Si no, null.
function findUpcomingBirthday(teamMembers, currentUserEmail) {
  const myEmail = (currentUserEmail || '').toLowerCase();
  const candidates = teamMembers
    .map(m => {
      const bd = parseBirthdate(m.birthdate);
      if (!bd) return null;
      const emails = Array.isArray(m.email) ? m.email : [m.email];
      const isMe = emails.some(e => (e || '').toLowerCase() === myEmail);
      return { person: m, bd, days: daysUntil(bd), isMe };
    })
    .filter(x => x && !x.isMe && (x.days === 0 || x.days === 1));

  if (!candidates.length) return null;
  // Si hay múltiples, priorizar hoy sobre mañana.
  candidates.sort((a, b) => a.days - b.days);
  return candidates[0];
}

// ═══════════════════════════════════════════
// CHECK PRINCIPAL — llamado desde auth.js
// ═══════════════════════════════════════════

export async function checkBirthdayInvitePopup(currentUser, teamMembers) {
  try {
    const match = findUpcomingBirthday(teamMembers, currentUser.email);
    if (!match) return;

    const { person, bd, days } = match;
    const cardId = `${new Date().getFullYear()}_${slugify(person.name)}`;

    // ¿Ya vi este cumple hoy?
    const userSnap = await getDoc(doc(db, "users", currentUser.email));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const invites = userData.birthdayInvites || {};
    if (invites[cardId] === todayKey()) return;

    // ¿Ya escribí mensaje?
    const card = await loadBirthdayCard(person);
    const messages = card.messages || [];
    const alreadyWrote = messages.some(m => m.fromEmail === currentUser.email);
    if (alreadyWrote) return;

    // Mostrar pop-up.
    showInviteModal(person, bd, days, currentUser, cardId);
  } catch (e) {
    console.warn("[birthday-invite] error:", e.message);
  }
}

// ═══════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════

function showInviteModal(person, bd, days, currentUser, cardId) {
  const kicker = days === 0 ? "HOY CUMPLE AÑOS" : "MAÑANA CUMPLE AÑOS";
  const fecha = `${bd.d} de ${MESES_FULL[bd.m - 1]}`;
  const firstName = (person.name || '').split(' ')[0] || person.name;

  const overlay = document.createElement("div");
  overlay.className = "binv-overlay";
  overlay.innerHTML = `
    <div class="binv-modal" role="dialog" aria-modal="true" aria-labelledby="binv-title">
      <button class="binv-close" id="binv-close" aria-label="Cerrar">
        <i data-lucide="x"></i>
      </button>

      <div class="binv-header">
        <img class="binv-photo" src="${escapeHtml(person.photo || '')}" alt=""
             onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(person.name)}&background=06a3b6&color=fff&size=240';">
        <div class="binv-header-info">
          <div class="binv-kicker ${days === 0 ? 'binv-kicker-today' : ''}">${kicker}</div>
          <div class="binv-name" id="binv-title">${escapeHtml(person.name)}</div>
          <div class="binv-cargo">${escapeHtml(person.role || '')}</div>
          <div class="binv-date"><i data-lucide="calendar"></i> ${escapeHtml(fecha)}</div>
        </div>
      </div>

      <div class="binv-body">
        <div class="binv-prompt">¿Le dedicas unas palabras al equipo?</div>
        <textarea id="binv-message" class="binv-textarea"
                  placeholder="Escribe algo bonito para ${escapeHtml(firstName)}…"
                  maxlength="400" rows="4"></textarea>
        <div class="binv-picker-row">
          <div class="binv-picker" id="binv-picker" role="toolbar" aria-label="Emojis populares">
            ${EMOJI_PICKER.map(e => `<button type="button" class="binv-emoji" data-emoji="${e}">${e}</button>`).join('')}
          </div>
          <span class="binv-counter" id="binv-counter">0/400</span>
        </div>
      </div>

      <div class="binv-footer">
        <button class="binv-btn binv-btn-ghost" id="binv-skip">Ahora no</button>
        <button class="binv-btn binv-btn-primary" id="binv-publish">Publicar felicitación</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (window.refreshIcons) window.refreshIcons();

  const textarea = overlay.querySelector("#binv-message");
  const counter  = overlay.querySelector("#binv-counter");
  const publish  = overlay.querySelector("#binv-publish");
  const skip     = overlay.querySelector("#binv-skip");
  const closeBtn = overlay.querySelector("#binv-close");
  const picker   = overlay.querySelector("#binv-picker");

  textarea.focus();

  const updateCounter = () => {
    counter.textContent = `${textarea.value.length}/400`;
    counter.classList.toggle("binv-counter-warn", textarea.value.length > 370);
  };
  textarea.addEventListener("input", updateCounter);

  // Inserción de emojis en la posición del cursor.
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest(".binv-emoji");
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after  = textarea.value.slice(end);
    const combined = before + emoji + after;
    if (combined.length > 400) return;
    textarea.value = combined;
    const pos = start + emoji.length;
    textarea.setSelectionRange(pos, pos);
    textarea.focus();
    updateCounter();
  });

  // Cerrar sin publicar → marca la fecha para no re-abrir hoy.
  const dismiss = async () => {
    try {
      await setDoc(doc(db, "users", currentUser.email), {
        birthdayInvites: { [cardId]: todayKey() }
      }, { merge: true });
    } catch (e) { console.warn(e); }
    overlay.remove();
  };

  closeBtn.addEventListener("click", dismiss);
  skip.addEventListener("click", dismiss);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { document.removeEventListener("keydown", esc); dismiss(); }
  });

  // Publicar → guardar mensaje + marcar como vista.
  publish.addEventListener("click", async () => {
    const msg = textarea.value.trim();
    if (msg.length < 5) {
      textarea.classList.add("binv-textarea-error");
      textarea.focus();
      return;
    }
    publish.disabled = true;
    publish.textContent = "Publicando…";
    try {
      await saveMessage(person, currentUser, msg);
      await setDoc(doc(db, "users", currentUser.email), {
        birthdayInvites: { [cardId]: todayKey() }
      }, { merge: true });
      overlay.remove();
    } catch (e) {
      publish.disabled = false;
      publish.textContent = "Publicar felicitación";
      alert("No se pudo guardar la felicitación: " + e.message);
    }
  });
}
