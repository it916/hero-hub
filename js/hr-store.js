// ═══════════════════════════════════════════
// Hero Hub · Store de datos de RRHH (Firestore)
// ═══════════════════════════════════════════
// Colección `hr-data/{email}`, paralela a `users/{email}` y con la misma
// clave. Guarda lo que NO puede vivir en users/: ese documento lo puede leer
// cualquiera del dominio (firestore.rules → `allow read: if esDelDominio()`),
// porque de ahí salen el directorio, el módulo Equipo y los cumpleaños.
//
// Acá van los datos que solo debe ver quien maneja RRHH:
//
//   city      → ciudad. Fuera de users/ a propósito: el módulo Equipo lo ven
//               los agentes externos y no tienen por qué saber en qué ciudad
//               vive cada persona.
//   address   → dirección completa
//   startDate → cuándo entró a Hero (MM/DD/YYYY). meta.createdAt de users/ NO
//               sirve: es cuándo se creó el documento.
//   schedule  → { from, to, days } — horario asignado
//   docsUrl   → carpeta de Drive con contratos y documentos. Se guarda el
//               enlace, no los archivos: los permisos los gestiona Workspace.
//
// La regla es `allow read, write: if esAdmin()`. Si algún día RRHH se abre a
// un rol que no sea admin, hay que ampliar TAMBIÉN esa regla — el guard de la
// página por sí solo no protege los datos.

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "hr-data";

const VACIO = { city: null, address: null, startDate: null, schedule: null, docsUrl: null };

function normalizar(data) {
  return {
    city: data?.city || null,
    address: data?.address || null,
    startDate: data?.startDate || null,
    schedule: data?.schedule || null,
    docsUrl: data?.docsUrl || null,
  };
}

// Todos los registros de una vez, indexados por email. La colección tiene
// una entrada por persona del equipo — leerla entera cuesta lo mismo que
// pedirlas de a una y evita 17 round-trips.
export async function getAllHrData() {
  const snap = await getDocs(collection(db, COLLECTION));
  const mapa = new Map();
  snap.docs.forEach(d => mapa.set(d.id, normalizar(d.data())));
  return mapa;
}

export async function getHrData(email) {
  if (!email) return { ...VACIO };
  const ref = doc(db, COLLECTION, email.toLowerCase());
  const snap = await getDoc(ref);
  return snap.exists() ? normalizar(snap.data()) : { ...VACIO };
}

// setDoc con merge: la primera vez crea el documento y después actualiza solo
// lo que venga en el patch. Con updateDoc fallaría en quien todavía no tiene
// ficha, que al principio son todos.
export async function saveHrData(email, patch) {
  if (!email) throw new Error("saveHrData: email requerido");
  const ref = doc(db, COLLECTION, email.toLowerCase());
  await setDoc(ref, patch, { merge: true });
}
