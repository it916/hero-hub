import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
