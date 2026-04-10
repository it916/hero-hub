import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔧 REEMPLAZA estos valores con los de TU proyecto Firebase
// (Console → Project settings → Your apps → Web app → firebaseConfig)
const firebaseConfig = {
  apiKey: "PEGA_AQUI",
  authDomain: "hero-hub.firebaseapp.com",
  projectId: "hero-hub",
  storageBucket: "hero-hub.appspot.com",
  messagingSenderId: "PEGA_AQUI",
  appId: "PEGA_AQUI"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
