import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin as isAdminRole } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
// ADMIN_EMAILS eliminado: usamos el sistema de roles

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

  // Esperar a que page-guard cargue el rol
  await window.getPageContext();
  // btn-admin ya fue manejado por page-guard.js (filterTopbarByRole)

  document.getElementById("user-avatar").src = await getFreshGooglePhotoURL(user);
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
        const ok = await heroConfirm({
          title: "Eliminar guía",
          message: `¿Eliminar guía "${g.title}"?`,
          confirmLabel: "Eliminar",
          variant: "danger"
        });
        if (!ok) return;
        guias.splice(idx, 1);
        try {
          await setDoc(doc(db, "shared", "guias"), { items: guias });
          renderGuias();
          heroToast.success(`Guía "${g.title}" eliminada`);
        } catch (err) { heroToast.error("No se pudo eliminar: " + err.message); }
      }
    });
  });

  if (window.refreshIcons) window.refreshIcons();
}

function openGuiaModal(idx) {
  const editing = idx !== null && idx >= 0;
  const g = editing ? guias[idx] : { emoji:'📘', tag:'', title:'', url:'' };
  const esc = (s) => (s == null ? "" : String(s)).replace(/"/g, "&quot;").replace(/&/g, "&amp;");

  const dialog = document.createElement("sl-dialog");
  dialog.label = editing ? `✎ Editar guía · ${g.title || ''}` : "✦ Nueva guía";
  dialog.className = "hh-dialog guia-edit-dialog";
  dialog.innerHTML = `
    <div class="hh-form">
      <div class="modal-grid-2">
        <sl-input id="g-emoji" label="Emoji"
          value="${esc(g.emoji)}" maxlength="4" placeholder="📘"></sl-input>
        <sl-input id="g-tag" label="Categoría / Tag"
          value="${esc(g.tag)}" maxlength="30" placeholder="Ej. Aetna, Oscar, Contratos…" clearable></sl-input>
      </div>
      <sl-input id="g-title" label="Título *"
        value="${esc(g.title)}" maxlength="120" placeholder="Ej. Crear cuenta en…" required clearable></sl-input>
      <sl-input id="g-url" label="URL de la guía (Scribe, Loom, Drive…) *" type="url"
        value="${esc(g.url)}" placeholder="https://scribehow.com/viewer/…" required clearable></sl-input>
    </div>

    <sl-button slot="footer" id="g-cancel" variant="default">Cancelar</sl-button>
    <sl-button slot="footer" id="g-save" variant="primary">
      <i data-lucide="${editing ? 'check' : 'plus'}" slot="prefix" style="width:14px;height:14px;"></i>
      ${editing ? 'Guardar' : 'Agregar'}
    </sl-button>
  `;
  document.body.appendChild(dialog);
  if (window.refreshIcons) window.refreshIcons();

  dialog.addEventListener("sl-after-hide", () => dialog.remove());
  dialog.querySelector("#g-cancel").addEventListener("click", () => dialog.hide());

  dialog.querySelector("#g-save").addEventListener("click", async () => {
    const title = (dialog.querySelector("#g-title").value || "").trim();
    const url = (dialog.querySelector("#g-url").value || "").trim();
    if (!title) {
      dialog.querySelector("#g-title").focus();
      heroToast.error("El título es obligatorio");
      return;
    }
    if (!url) {
      dialog.querySelector("#g-url").focus();
      heroToast.error("La URL es obligatoria");
      return;
    }

    const nueva = {
      emoji: (dialog.querySelector("#g-emoji").value || "").trim() || '📘',
      tag: (dialog.querySelector("#g-tag").value || "").trim(),
      title,
      url,
      updatedBy: auth.currentUser.email,
      updatedAt: new Date().toISOString()
    };

    if (editing) guias[idx] = nueva;
    else guias.push(nueva);

    try {
      await setDoc(doc(db, "shared", "guias"), { items: guias });
      dialog.hide();
      renderGuias();
      heroToast.success(editing ? `Guía "${title}" actualizada` : `Guía "${title}" agregada`);
    } catch (e) { heroToast.error("No se pudo guardar: " + e.message); }
  });

  // Shoelace lazy-registra el custom element en el primer uso; sin esto
  // el primer click no abre el modal (hay que clickear dos veces).
  customElements.whenDefined("sl-dialog").then(() => dialog.show());
}
