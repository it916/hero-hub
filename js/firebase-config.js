import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔧 REEMPLAZA estos valores con los de TU proyecto Firebase
// (Console → Project settings → Your apps → Web app → firebaseConfig)
const firebaseConfig = {
apiKey: "AIzaSyAtlIACoJkSg77xjw0N3ODFoaH0Sf2pVtc",
  authDomain: "hero-hub-de520.firebaseapp.com",
  projectId: "hero-hub-de520",
  storageBucket: "hero-hub-de520.firebasestorage.app",
  messagingSenderId: "1062942956307",
  appId: "1:1062942956307:web:eba9e9bfb0c649fefc58e6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ═══════════════════════════════════════════════════════════════
// Feature flags — refactor/users-unificado (Fase 0)
// ═══════════════════════════════════════════════════════════════
// Cuando true → equipo.js, mi-perfil.js y roles-admin.js leen de la
// colección users/{email} en vez de shared/team.members[] +
// shared/roles. Se activa DESPUÉS de correr el migrador (Fase 0.4)
// y validar campo por campo.
export const USE_USERS_COLLECTION = false;
