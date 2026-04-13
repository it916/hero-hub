import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

let guias = [];
let filter = '';

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

  document.getElementById("user-avatar").src = user.photoURL;
  if (ADMIN_EMAILS.includes(user.email)) {
    document.getElementById("btn-admin").style.display = "inline-flex";
  }
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  await loadGuias();
  wireHandlers();
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth).then(() => location.href = "index.html"));

async function loadGuias() {
  try {
    const snap = await getDoc(doc(db, "shared", "guias"));
    if (snap.exists() && Array.isArray(snap.data().items)) {
      guias = snap.data().items;
    } else {
      guias = [];
    }
    renderGuias();
  } catch (e) {
    console.error(e);
    document.getElementById("guias-grid").innerHTML = `<p class="empty">Error: ${e.message}</p>`;
  }
}

function wireHandlers() {
  document.getElementById("guias-search").addEventListener("input", (e) => {
    filter = e.target.value.toLowerCase().trim();
    renderGuias();
  });
  document.getElementById("btn-add-guia").addEventListener("click", () => openGuiaModal(null));
}

function renderGuias() {
  const grid = document.getElementById("guias-grid");
  const filtered = filter
    ? guias.filter(g => (g.title||'').toLowerCase().includes(filter) || (g.tag||'').toLowerCase().includes(filter))
    : guias;

  document.getElementById("stat-guias").textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = filter
      ? `<p class="empty">😕 Sin resultados para "${filter}"</p>`
      : `<p class="empty">Aún no hay guías. ¡Agrega la primera!</p>`;
    return;
  }

  grid.innerHTML = filtered.map((g, i) => {
    const idx = guias.indexOf(g);
    return `
      <div class="guia-card" data-idx="${idx}" style="animation-delay:${i*35}ms;">
        <div class="guia-actions">
          <button class="guia-act edit" data-idx="${idx}" title="Editar">✎</button>
          <button class="guia-act del" data-idx="${idx}" title="Eliminar">×</button>
        </div>
        <a href="${g.url}" target="_blank" rel="noopener" class="guia-link">
          <div class="guia-top">
            <div class="guia-emoji">${g.emoji || '📘'}</div>
            <span class="guia-arrow">↗</span>
          </div>
          <div>
            <div class="guia-tag">${g.tag || ''}</div>
            <div class="guia-title">${g.title || ''}</div>
          </div>
          <div class="guia-cta">Ver guía paso a paso →</div>
        </a>
      </div>`;
  }).join('');

  // Wire edit/del
  grid.querySelectorAll('.guia-act').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (btn.classList.contains('edit')) openGuiaModal(idx);
      else {
        const g = guias[idx];
        if (!confirm(`¿Eliminar guía "${g.title}"?`)) return;
        guias.splice(idx, 1);
        try {
          await setDoc(doc(db, "shared", "guias"), { items: guias });
          renderGuias();
        } catch (err) { alert("Error: " + err.message); }
      }
    });
  });

  if (window.refreshIcons) window.refreshIcons();
}

function openGuiaModal(idx) {
  const editing = idx !== null && idx >= 0;
  const g = editing ? guias[idx] : { emoji:'📘', tag:'', title:'', url:'' };

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal modal-wide">
    <h3>${editing ? 'Editar guía' : 'Nueva guía'}</h3>
    <div class="modal-grid-2">
      <label>Emoji <input id="g-emoji" value="${(g.emoji||'').replace(/"/g,'&quot;')}" maxlength="4" placeholder="📘"></label>
      <label>Categoría / Tag <input id="g-tag" value="${(g.tag||'').replace(/"/g,'&quot;')}" maxlength="30" placeholder="Ej. Aetna, Oscar, Contratos..."></label>
    </div>
    <label>Título * <input id="g-title" value="${(g.title||'').replace(/"/g,'&quot;')}" maxlength="120" placeholder="Ej. Crear cuenta en..."></label>
    <label>URL de la guía (Scribe, Loom, Drive...) * <input id="g-url" type="url" value="${(g.url||'').replace(/"/g,'&quot;')}" placeholder="https://scribehow.com/viewer/..."></label>
    <div class="modal-buttons">
      <button class="btn-ghost-dark" id="g-cancel">Cancelar</button>
      <button class="btn-primary" id="g-save">${editing ? 'Guardar' : 'Agregar'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  modal.querySelector("#g-cancel").onclick = () => modal.remove();
  modal.querySelector("#g-save").onclick = async () => {
    const title = modal.querySelector("#g-title").value.trim();
    const url = modal.querySelector("#g-url").value.trim();
    if (!title) { alert("El título es obligatorio"); return; }
    if (!url) { alert("La URL es obligatoria"); return; }

    const nueva = {
      emoji: modal.querySelector("#g-emoji").value.trim() || '📘',
      tag: modal.querySelector("#g-tag").value.trim(),
      title,
      url,
      updatedBy: auth.currentUser.email,
      updatedAt: new Date().toISOString()
    };

    if (editing) guias[idx] = nueva;
    else guias.push(nueva);

    try {
      await setDoc(doc(db, "shared", "guias"), { items: guias });
      modal.remove();
      renderGuias();
    } catch (e) { alert("Error: " + e.message); }
  };
}
