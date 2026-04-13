import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets } from "./widgets.js";

export async function loadDashboard(user) {
  const userRef = doc(db, "users", user.email);
  const snap = await getDoc(userRef);
  const userData = snap.exists() ? snap.data() : {};
  setMastheadDate();
  await renderWidgets(userData);
}

function setMastheadDate() {
  const now = new Date();
  const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const mesesLargo = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const left = document.getElementById("masthead-date");
  if (left) left.textContent = `${dias[now.getDay()]} · ${now.getDate()} ${meses[now.getMonth()]} ${now.getFullYear()}`;

  const issue = document.getElementById("masthead-issue");
  if (issue) {
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    issue.textContent = `Nº ${dayOfYear}`;
  }

  const date = document.getElementById("hero-date");
  if (date) date.textContent = `${dias[now.getDay()]}, ${now.getDate()} de ${mesesLargo[now.getMonth()]} de ${now.getFullYear()}`;
}
