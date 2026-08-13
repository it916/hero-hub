// ═══════════════════════════════════════════
// Hero Hub · Store de Asistencia (Firestore)
// ═══════════════════════════════════════════
// API central para leer y escribir eventos de asistencia contra la
// colección `attendance` de Firestore. Reemplaza el Apps Script + Sheet
// que veníamos usando (ver commit v2.18.0).
//
// Schema de cada documento:
//   {
//     timestamp: Timestamp,        // instante exacto del evento
//     email: string,               // "juan@heroinsuranceusa.com"
//     name: string,                // "Juan Pérez"
//     type: string,                // "Entrada" | "Salida" | "Inicio Break" | …
//     absenceDate: string | null,  // "MM/DD/YYYY", solo si type=Ausencia
//     reason: string | null        // solo si type=Ausencia
//   }
//
// La lectura devuelve el mismo formato "planificado" que servía el Apps
// Script — { fecha, hora, email, nombre, tipo, fechaObjetivo, motivo } —
// para que el motor de stats (attendance-stats.js) no necesite cambios.

import { auth, db } from "./firebase-config.js";
import {
  collection, addDoc, setDoc, doc, getDocs, query, where, orderBy, limit, onSnapshot, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "attendance";

// ── Escritura ──────────────────────────────────────────────────────
// Registra un evento nuevo. Usa addDoc (auto-ID).
// Fire-and-throw: si falla, el caller decide qué hacer (mostrar toast).
export async function writeAttendance({ type, timestamp, absenceDate, reason }) {
  const user = auth.currentUser;
  if (!user) throw new Error("No hay usuario autenticado");
  if (!type) throw new Error("type es obligatorio");

  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  const doc = {
    timestamp: Timestamp.fromDate(ts),
    email: user.email,
    name: user.displayName || user.email.split("@")[0],
    type,
    absenceDate: absenceDate || null,
    reason: reason || null,
  };
  await addDoc(collection(db, COLLECTION), doc);
}

// Registra un evento con ID determinístico. Idempotente — reejecutar con
// el mismo id sobreescribe el mismo doc. Usado por la migración one-shot
// para no duplicar si se corre dos veces.
//
// Recibe email/name como parámetros porque durante la migración estamos
// escribiendo eventos históricos de OTROS usuarios (no del auth.currentUser).
export async function writeAttendanceWithId(id, { email, name, type, timestamp, absenceDate, reason }) {
  if (!id) throw new Error("id es obligatorio");
  if (!email || !type) throw new Error("email y type son obligatorios");

  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const payload = {
    timestamp: Timestamp.fromDate(ts),
    email,
    name: name || email.split("@")[0],
    type,
    absenceDate: absenceDate || null,
    reason: reason || null,
  };
  await setDoc(doc(db, COLLECTION, id), payload);
}

// Genera un docId determinístico a partir de los campos del evento.
// Formato: email_timestampMs_typeSlug. Sirve como clave natural para
// idempotencia de la migración.
export function buildDocId({ email, timestamp, type }) {
  const ts = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  const emailSlug = String(email).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const typeSlug = String(type).toLowerCase().replace(/\s+/g, "-");
  return `${emailSlug}__${ts}__${typeSlug}`;
}

// ── Lectura ────────────────────────────────────────────────────────
// Devuelve eventos en el formato "plano" que espera attendance-stats.js:
//   { fecha: "MM/DD/YYYY", hora: "HH:mm:ss", email, nombre, tipo,
//     fechaObjetivo, motivo }
//
// Filtros opcionales:
//   - from:  Date | Timestamp — solo eventos con timestamp >= from
//   - to:    Date | Timestamp — solo eventos con timestamp <= to
//   - email: string           — solo eventos de ese usuario
//
// Sin filtros = toda la colección (¡cuidado con free tier de 50k reads/día!).
export async function fetchAttendance({ from, to, email } = {}) {
  const clauses = [];
  if (email)          clauses.push(where("email", "==", email));
  if (from)           clauses.push(where("timestamp", ">=", from instanceof Timestamp ? from : Timestamp.fromDate(from)));
  if (to)             clauses.push(where("timestamp", "<=", to instanceof Timestamp ? to : Timestamp.fromDate(to)));
  clauses.push(orderBy("timestamp", "asc"));

  const q = query(collection(db, COLLECTION), ...clauses);
  const snap = await getDocs(q);
  return snap.docs.map(d => docToPlainEvent(d.data()));
}

// Convierte un doc de Firestore al formato { fecha, hora, email, ... }
// usando la zona horaria America/New_York (misma que usaba el Apps Script,
// para que las stats por día no cambien).
const TZ = "America/New_York";

function docToPlainEvent(data) {
  const ts = data.timestamp instanceof Timestamp ? data.timestamp.toDate() : new Date(data.timestamp);
  return {
    fecha: formatDateInTz(ts),
    hora: formatTimeInTz(ts),
    email: data.email,
    nombre: data.name,
    tipo: data.type,
    fechaObjetivo: data.absenceDate || null,
    motivo: data.reason || null,
  };
}

// Devuelve el evento más reciente del usuario (o null si nunca marcó).
// Formato crudo del doc — no aplica docToPlainEvent porque los callers
// (attendance.js) quieren el objeto original con Timestamp y tipos nativos.
//   { id, type, timestamp: Date, email, name, absenceDate, reason }
//
// Si `excludeTypes` es un array de tipos, esos eventos se ignoran (útil
// para obtener el "último evento del ciclo diario" descartando Ausencias,
// que son eventos independientes). En ese caso ampliamos el limit y
// filtramos en cliente — evita agregar índices compuestos.
export async function fetchLastEvent({ email, excludeTypes } = {}) {
  if (!email) throw new Error("email es obligatorio");
  const hasExclude = Array.isArray(excludeTypes) && excludeTypes.length > 0;
  const q = query(
    collection(db, COLLECTION),
    where("email", "==", email),
    orderBy("timestamp", "desc"),
    limit(hasExclude ? 20 : 1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  if (hasExclude) {
    const skip = new Set(excludeTypes);
    const first = snap.docs.find(d => !skip.has(d.data().type));
    return first ? _rawEventFromDoc(first) : null;
  }
  return _rawEventFromDoc(snap.docs[0]);
}

// Suscribe al último evento del usuario en tiempo real. Cada vez que
// cambia (marca nueva desde cualquier device), el callback recibe el
// evento actualizado (o null si aún no existe).
// Devuelve la función de unsubscribe.
//
// `excludeTypes` funciona igual que en fetchLastEvent.
export function subscribeLastEvent({ email, excludeTypes }, callback) {
  if (!email) throw new Error("email es obligatorio");
  const hasExclude = Array.isArray(excludeTypes) && excludeTypes.length > 0;
  const skip = hasExclude ? new Set(excludeTypes) : null;
  const q = query(
    collection(db, COLLECTION),
    where("email", "==", email),
    orderBy("timestamp", "desc"),
    limit(hasExclude ? 20 : 1)
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) { callback(null); return; }
      if (skip) {
        const first = snap.docs.find(d => !skip.has(d.data().type));
        callback(first ? _rawEventFromDoc(first) : null);
        return;
      }
      callback(_rawEventFromDoc(snap.docs[0]));
    },
    (err) => {
      console.error("subscribeLastEvent:", err);
      callback(null, err);
    }
  );
}

function _rawEventFromDoc(docSnap) {
  const data = docSnap.data();
  const ts = data.timestamp instanceof Timestamp ? data.timestamp.toDate() : new Date(data.timestamp);
  return {
    id: docSnap.id,
    type: data.type,
    timestamp: ts,
    email: data.email,
    name: data.name,
    absenceDate: data.absenceDate || null,
    reason: data.reason || null,
  };
}

// "MM/DD/YYYY" en America/New_York.
function formatDateInTz(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "2-digit", day: "2-digit", year: "numeric"
  }).formatToParts(d);
  const m = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;
  const y = parts.find(p => p.type === "year").value;
  return `${m}/${day}/${y}`;
}

// "HH:mm:ss" (24h) en America/New_York.
function formatTimeInTz(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(d);
  const hh = parts.find(p => p.type === "hour").value;
  const mm = parts.find(p => p.type === "minute").value;
  const ss = parts.find(p => p.type === "second").value;
  return `${hh === "24" ? "00" : hh}:${mm}:${ss}`;
}
