import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];
let spotlight = { imageUrl: "", message: "", honorees: [] };
let messages = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { alert("Debes iniciar sesión"); location.href = "index.html"; }
    return;
  }
  if (!ADMIN_EMAILS.includes(user.email)) {
    alert("No tienes permisos de administrador.");
    location.href = "index.html";
    return;
  }
  document.getElementById("loading").style.display = "none";
  document.getElementById("admin-panel").style.display = "block";
  if (window.refreshIcons) window.refreshIcons();
  await loadAll();
  wireHandlers();
});

async function loadAll() {
  const [sp, ms] = await Promise.all([
    getDoc(doc(db, "shared", "spotlight")),
    getDoc(doc(db, "shared", "messages"))
  ]);

  // Migración: si tiene formato viejo (name, role), conviértelo a honorees[]
  if (sp.exists()) {
    const data = sp.data();
    if (data.honorees) {
      // Formato nuevo
      spotlight = {
        imageUrl: data.imageUrl || "",
        message: data.message || "",
        honorees: data.honorees || []
      };
    } else if (data.name) {
      // Formato viejo, convertir
      spotlight = {
        imageUrl: "",
        message: data.message || "",
        honorees: [{ name: data.name, role: data.role || "" }]
      };
    }
  }

  messages = ms.exists() ? (ms.data().items || []) : [];

  document.getElementById("sp-image").value = spotlight.imageUrl;
  document.getElementById("sp-message").value = spotlight.message;
  renderHonorees();
  renderImagePreview();
  renderMessages();
}

function wireHandlers() {
  // Imagen — preview en vivo
  document.getElementById("sp-image").addEventListener("input", (e) => {
    spotlight.imageUrl = e.target.value.trim();
    renderImagePreview();
  });

  // Agregar honorado
  document.getElementById("sp-add-honoree").onclick = () => {
    if (spotlight.honorees.length >= 3) {
      alert("Máximo 3 honorados");
      return;
    }
    spotlight.honorees.push({ name: "", role: "" });
    renderHonorees();
  };

  // Guardar spotlight
  document.getElementById("sp-save").onclick = async () => {
    spotlight.message = document.getElementById("sp-message").value.trim();
    // Filtrar honorees vacíos
    spotlight.honorees = spotlight.honorees.filter(h => h.name && h.name.trim());
    if (!spotlight.honorees.length) {
      alert("Agrega al menos un honorado");
      return;
    }
    await setDoc(doc(db, "shared", "spotlight"), spotlight);
    flash("sp-status", "✅ Guardado");
  };

  // Mensajes
  document.getElementById("ms-add").onclick = async () => {
    const text = document.getElementById("ms-text").value.trim();
    if (!text) return;
    messages.push(text);
    await setDoc(doc(db, "shared", "messages"), { items: messages });
    document.getElementById("ms-text").value = "";
    renderMessages();
  };
}

function renderHonorees() {
  const list = document.getElementById("sp-honorees-list");
  list.innerHTML = spotlight.honorees.map((h, i) => `
    <div class="honoree-row">
      <div class="honoree-num">${i + 1}</div>
      <input class="honoree-name" data-i="${i}" placeholder="Nombre" value="${(h.name || '').replace(/"/g, '&quot;')}">
      <input class="honoree-role" data-i="${i}" placeholder="Rol (ej: Manager)" value="${(h.role || '').replace(/"/g, '&quot;')}">
      <button class="btn-small-danger" data-i="${i}">Eliminar</button>
    </div>
  `).join("");

  list.querySelectorAll(".honoree-name").forEach(inp => {
    inp.addEventListener("input", e => {
      spotlight.honorees[parseInt(e.target.dataset.i)].name = e.target.value;
    });
  });
  list.querySelectorAll(".honoree-role").forEach(inp => {
    inp.addEventListener("input", e => {
      spotlight.honorees[parseInt(e.target.dataset.i)].role = e.target.value;
    });
  });
  list.querySelectorAll(".btn-small-danger").forEach(btn => {
    btn.onclick = () => {
      if (!confirm("¿Eliminar este honorado?")) return;
      spotlight.honorees.splice(parseInt(btn.dataset.i), 1);
      renderHonorees();
    };
  });
}

function renderImagePreview() {
  const wrap = document.getElementById("sp-preview-wrap");
  const prev = document.getElementById("sp-preview");
  if (spotlight.imageUrl) {
    wrap.style.display = "block";
    prev.style.backgroundImage = `url(${spotlight.imageUrl})`;
  } else {
    wrap.style.display = "none";
  }
}

function renderMessages() {
  const list = document.getElementById("ms-list");
  list.innerHTML = messages.map((m, i) =>
    `<div class="admin-item">
      <span>"${m}"</span>
      <button class="btn-small-danger" data-i="${i}">Eliminar</button>
    </div>`).join("");
  list.querySelectorAll("button").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Eliminar?")) return;
      messages.splice(parseInt(btn.dataset.i), 1);
      await setDoc(doc(db, "shared", "messages"), { items: messages });
      renderMessages();
    };
  });
}

function flash(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  setTimeout(() => el.textContent = "", 2500);
}
