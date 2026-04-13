import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets } from "./widgets.js";

export async function loadDashboard(user) {
  const userRef = doc(db, "users", user.email);
  const snap = await getDoc(userRef);
  const userData = snap.exists() ? snap.data() : {};
  startClock();
  await renderWidgets(userData);
}

function startClock() {
  const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  function tick() {
    const now = new Date();
    const dateEl = document.getElementById("meta-date");
    const timeEl = document.getElementById("meta-time");
    if (dateEl) dateEl.textContent = `${dias[now.getDay()].slice(0,3)} ${now.getDate()} ${meses[now.getMonth()]}`;
    if (timeEl) {
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      timeEl.textContent = `${h}:${m}:${s}`;
    }
  }
  tick();
  setInterval(tick, 1000);
}
