import { auth } from "./firebase-config.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const ALLOWED_DOMAIN = "heroinsuranceusa.com";
const ADMIN_EMAILS = ["it@heroinsuranceusa.com"];

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
  if (window.refreshIcons) window.refreshIcons();
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth).then(() => location.href = "index.html"));
