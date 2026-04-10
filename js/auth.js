import { auth, db } from "./firebase-config.js";
import { loadDashboard } from "./app.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const provider = new GoogleAuthProvider();

document.getElementById("btn-login").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    document.getElementById("login-error").textContent = "Error al iniciar sesión.";
    console.error(e);
  }
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    document.getElementById("login-error").textContent =
      "Acceso restringido a cuentas @heroinsuranceusa.com";
    showLogin();
    return;
  }
  const userRef = doc(db, "users", user.email);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      displayName: user.displayName,
      photoURL: user.photoURL,
      greeting: `¡Hola, ${user.displayName.split(" ")[0]}!`,
      theme: "light",
      widgetOrder: ["spotlight", "birthdays", "messages", "tools"],
      hiddenWidgets: [],
      shortcuts: []
    });
  }
  showDashboard(user);
});

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("dashboard").style.display = "none";
}
function showDashboard(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("user-avatar").src = user.photoURL;
  document.getElementById("user-greeting").textContent = user.displayName;
}
