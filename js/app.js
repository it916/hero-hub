// app.js — orquestador del dashboard
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets } from "./widgets.js";

export async function loadDashboard(user) {
  const userRef = doc(db, "users", user.email);
  const snap = await getDoc(userRef);
  const userData = snap.exists() ? snap.data() : {};
  // Saludo personalizado
  document.getElementById("user-greeting").textContent =
    userData.greeting || `¡Hola, ${user.displayName.split(" ")[0]}!`;
  renderWidgets(userData);
}
