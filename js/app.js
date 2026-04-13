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
  const clockEl = document.getElementById("hero-clock");
  const meridiemEl = document.getElementById("hero-clock-meridiem");
  const dateEl = document.getElementById("hero-date");
  if (!clockEl) return;

  const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  function tick() {
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, "0");
    const meridiem = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    clockEl.textContent = `${h}:${m}`;
    if (meridiemEl) meridiemEl.textContent = meridiem;
    if (dateEl) dateEl.textContent = `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
  }
  tick();
  setInterval(tick, 1000 * 30);
}
