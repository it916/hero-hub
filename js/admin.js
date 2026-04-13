import { auth, db } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];
let spotlight = {}, birthdays = [], messages = [];

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
  await loadAll();
  wireHandlers();
});

async function loadAll() {
  const [sp, bd, ms] = await Promise.all([
    getDoc(doc(db, "shared", "spotlight")),
    getDoc(doc(db, "shared", "birthdays")),
    getDoc(doc(db, "shared", "messages"))
  ]);
  spotlight = sp.exists() ? sp.data() : { name:"", role:"", message:"" };
  birthdays = bd.exists() ? (bd.data().items || []) : [];
  messages  = ms.exists() ? (ms.data().items || []) : [];
  document.getElementById("sp-name").value = spotlight.name || "";
  document.getElementById("sp-role").value = spotlight.role || "";
  document.getElementById("sp-message").value = spotlight.message || "";
  renderBirthdays();
  renderMessages();
}

function wireHandlers() {
  document.getElementById("sp-save").onclick = async () => {
    spotlight = {
      name: document.getElementById("sp-name").value.trim(),
      role: document.getElementById("sp-role").value.trim(),
      message: document.getElementById("sp-message").value.trim()
    };
    await setDoc(doc(db, "shared", "spotlight"), spotlight);
    flash("sp-status", "✅ Guardado");
  };
  document.getElementById("bd-add").onclick = async () => {
    const name = document.getElementById("bd-name").value.trim();
    const date = document.getElementById("bd-date").value.trim();
    if (!name || !date) return alert("Nombre y fecha requeridos");
    birthdays.push({ name, date });
    await setDoc(doc(db, "shared", "birthdays"), { items: birthdays });
    document.getElementById("bd-name").value = "";
    document.getElementById("bd-date").value = "";
    renderBirthdays();
  };
  document.getElementById("ms-add").onclick = async () => {
    const text = document.getElementById("ms-text").value.trim();
    if (!text) return;
    messages.push(text);
    await setDoc(doc(db, "shared", "messages"), { items: messages });
    document.getElementById("ms-text").value = "";
    renderMessages();
  };
}

function renderBirthdays() {
  const list = document.getElementById("bd-list");
  list.innerHTML = birthdays.map((b, i) =>
    `<div class="admin-item">
      <span><strong>${b.name}</strong> — ${b.date}</span>
      <button class="btn-small-danger" data-i="${i}">Eliminar</button>
    </div>`).join("");
  list.querySelectorAll("button").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Eliminar?")) return;
      birthdays.splice(parseInt(btn.dataset.i), 1);
      await setDoc(doc(db, "shared", "birthdays"), { items: birthdays });
      renderBirthdays();
    };
  });
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
  setTimeout(() => el.textContent = "", 2000);
}
