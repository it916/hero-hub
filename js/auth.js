import { auth, db } from "./firebase-config.js";
import { loadDashboard } from "./app.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];
const provider = new GoogleAuthProvider();

document.getElementById("btn-login").addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (e) { document.getElementById("login-error").textContent = "Error al iniciar sesión."; console.error(e); }
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) return showLogin();
  if (!user.email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    document.getElementById("login-error").textContent = "Acceso restringido a cuentas @heroinsuranceusa.com";
    return showLogin();
  }
  // Crear doc de usuario si no existe (mínimo)
  try {
    const userRef = doc(db, "users", user.email);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        displayName: user.displayName,
        photoURL: user.photoURL,
        greeting: "",
        theme: "light"
      });
    }
  } catch (e) { console.error("Error creando user doc:", e); }
  showDashboard(user);
});

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("dashboard").style.display = "none";
}
function showDashboard(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  const av = document.getElementById("user-avatar");
  if (av) av.src = user.photoURL;
  if (ADMIN_EMAILS.includes(user.email)) {
    const a = document.getElementById("btn-admin");
    if (a) a.style.display = "inline-flex";
  }
  loadDashboard(user);
}
