// ═══════════════════════════════════════════
// Hero Hub · User Store
// ═══════════════════════════════════════════
// Wrapper para leer/escribir la colección users/{email}. Nueva fuente de
// verdad de personas del equipo desde v2.23.0 (fase 0). Los 3 consumers son:
//   - equipo.js       → getAllUsers({includeExcluded:false}) + CRUD
//   - mi-perfil.js    → getUserByEmail + updateUserFields (display.bio, prefs.*)
//   - roles-admin.js  → getAllUsers({includeExcluded:true}) + updateUserFields(access.role)
//
// El wrapper NO expone la shape "member" legacy — expone la shape natural del
// doc user/. Los consumers se refactorizaron para leer los campos nuevos.

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const USERS_COLL = "users";

// ═══════════════════════════════════════════
// LECTURA
// ═══════════════════════════════════════════

// Devuelve todos los users como array; cada item = { _email, ...doc }.
// Por defecto excluye docs con meta.excluded=true (ej. Luis Ernesto Gutiérrez,
// que existe en la colección pero no debe aparecer en Equipo).
export async function getAllUsers({ includeExcluded = false } = {}) {
  const snap = await getDocs(collection(db, USERS_COLL));
  const users = [];
  snap.forEach(d => {
    const data = d.data();
    if (!includeExcluded && data?.meta?.excluded === true) return;
    users.push({ _email: d.id, ...data });
  });
  return users;
}

// Busca un user por email. Matchea el docId (primary) o cualquier email
// alias en identity.emails[]. Devuelve null si no existe.
export async function getUserByEmail(email) {
  if (!email) return null;
  const key = email.toLowerCase();
  const ref = doc(db, USERS_COLL, key);
  const snap = await getDoc(ref);
  if (snap.exists()) return { _email: snap.id, ...snap.data() };
  // Fallback: escanear por identity.emails[] (aliases). Solo llega aquí si
  // el user hizo login con un email secundario que NO es el docId.
  const all = await getAllUsers({ includeExcluded: true });
  return all.find(u =>
    (u.identity?.emails || []).some(e => (e || "").toLowerCase() === key)
  ) || null;
}

// ═══════════════════════════════════════════
// ESCRITURA
// ═══════════════════════════════════════════

// Actualiza campos usando dot paths. Ejemplos:
//   updateUserFields("oscar@…", { "display.bio.superpoder": "nuevo" })
//   updateUserFields("oscar@…", { "access.role": "admin" })
// Si el patch toca algún campo access.*, actualiza access.updatedBy/updatedAt
// automáticamente.
export async function updateUserFields(email, patch) {
  if (!email) throw new Error("updateUserFields: email requerido");
  if (!patch || typeof patch !== "object") throw new Error("updateUserFields: patch requerido");
  const ref = doc(db, USERS_COLL, email.toLowerCase());
  const toWrite = { ...patch };
  const touchesAccess = Object.keys(patch).some(k => k.startsWith("access."));
  if (touchesAccess) {
    toWrite["access.updatedBy"] = auth.currentUser?.email || "system";
    toWrite["access.updatedAt"] = Timestamp.now();
  }
  await updateDoc(ref, toWrite);
}

// Crea un doc nuevo en users/. El caller debe tener permisos IT (regla de
// Firestore). Rellena defaults del shape estándar; los campos pasados en
// `initial` sobreescriben los defaults.
export async function createUser(email, initial = {}) {
  const key = (email || "").toLowerCase();
  if (!key) throw new Error("createUser: email requerido");
  const now = Timestamp.now();
  const actor = auth.currentUser?.email || "system";
  const payload = {
    identity: {
      name: initial.name || "",
      photo: initial.photo || "",
      country: initial.country || null,
      birthdate: initial.birthdate || "",
      phones: initial.phones || [],
      emails: initial.emails || [key],
      personalEmail: initial.personalEmail || null
    },
    display: {
      jobTitle: initial.jobTitle || "",
      bio: initial.bio || { identidad: "", superpoder: "", frase: "", union: "" }
    },
    access: {
      role: initial.role || null,
      active: initial.active !== false,
      updatedBy: actor,
      updatedAt: now
    },
    prefs: {
      theme: initial.theme || null
    },
    meta: {
      createdAt: now,
      slug: initial.slug || slugifyName(initial.name || ""),
      excluded: initial.excluded === true
    }
  };
  await setDoc(doc(db, USERS_COLL, key), payload);
  return { _email: key, ...payload };
}

// Elimina un doc de users/. Requiere permisos IT.
export async function deleteUser(email) {
  if (!email) throw new Error("deleteUser: email requerido");
  await deleteDoc(doc(db, USERS_COLL, email.toLowerCase()));
}

// ═══════════════════════════════════════════
// HELPERS DE DISPLAY
// ═══════════════════════════════════════════

// Mapping ISO alpha-2 → nombre en español. Se usa en Equipo y Mi Perfil para
// mostrar el país legible a partir del ISO guardado en identity.country.
const ISO_TO_NAME = {
  VE: "Venezuela", CU: "Cuba", CO: "Colombia", CL: "Chile", HN: "Honduras",
  US: "Estados Unidos", AR: "Argentina", MX: "México", ES: "España",
  PE: "Perú", EC: "Ecuador", UY: "Uruguay", CR: "Costa Rica", PA: "Panamá",
  DO: "República Dominicana", GT: "Guatemala", NI: "Nicaragua",
  SV: "El Salvador", BO: "Bolivia", PY: "Paraguay", PR: "Puerto Rico",
  BR: "Brasil"
};

export function countryLabel(iso) {
  if (!iso) return "";
  return ISO_TO_NAME[iso.toUpperCase()] || iso;
}

// URL de bandera SVG (flagicons.lipis.dev). Recordatorio: NO usar emoji de
// bandera en Windows (los renderiza como "VE", "CU", etc.).
export function countryFlagUrl(iso) {
  if (!iso) return "";
  return `https://flagicons.lipis.dev/flags/4x3/${iso.toLowerCase()}.svg`;
}

// ═══════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════

function slugifyName(name) {
  const clean = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "miembro-" + Date.now();
  if (parts.length === 1) return parts[0];
  return `${parts[0]}-${parts[1]}`;
}
