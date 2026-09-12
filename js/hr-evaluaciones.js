// ═══════════════════════════════════════════
// Hero Hub · Evaluaciones trimestrales (Firestore)
// ═══════════════════════════════════════════
// Colección `hr-evaluations`, plana y con un documento por evaluación. No es
// una subcolección de hr-data/{email} a propósito: la ficha de una persona
// necesita las suyas, pero el módulo también tiene que saber A QUIÉN LE TOCA,
// y eso es mirar la última de cada uno. Con una colección plana es una sola
// lectura; con subcolecciones serían diecisiete, o un collectionGroup con su
// propio índice.
//
// Son unos 70 documentos al año para el equipo actual, así que se lee entera.
//
// Misma regla que hr-data — `allow read, create, update: if esAdmin()`, delete
// cerrado para todos. Una evaluación se corrige, no se borra.

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, addDoc, getDocs, setDoc, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "hr-evaluations";

// Cada cuánto toca evaluar. Tres meses es lo que pidió Fernando (2026-09-12);
// el aviso de la ficha sale de aquí.
export const MESES_ENTRE_EVALUACIONES = 3;

// Los cinco criterios son fijos: si cada evaluación pudiera tener los suyos,
// no habría forma de comparar un trimestre con el siguiente ni de promediar.
export const CRITERIOS = [
  { id: "desempeno",    label: "Desempeño",         ayuda: "Calidad y volumen del trabajo" },
  { id: "puntualidad",  label: "Puntualidad",       ayuda: "Asistencia y cumplimiento de horario" },
  { id: "equipo",       label: "Trabajo en equipo", ayuda: "Colaboración y trato con los demás" },
  { id: "iniciativa",   label: "Iniciativa",        ayuda: "Autonomía y propuestas de mejora" },
  { id: "comunicacion", label: "Comunicación",      ayuda: "Claridad al informar y responder" },
];

export const ESCALA = [
  { v: 1, label: "Muy por debajo" },
  { v: 2, label: "Por debajo" },
  { v: 3, label: "Cumple" },
  { v: 4, label: "Por encima" },
  { v: 5, label: "Sobresaliente" },
];


// ── Periodos ───────────────────────────────────────────────────────

/** "2026-Q3" a partir de una fecha. */
export function periodoDe(fecha = new Date()) {
  const q = Math.floor(fecha.getMonth() / 3) + 1;
  return fecha.getFullYear() + "-Q" + q;
}

/** "2026-Q3" se lee mejor como "jul–sep 2026". */
export function periodoTexto(periodo) {
  const m = /^(\d{4})-Q([1-4])$/.exec(periodo || "");
  if (!m) return periodo || "—";
  const rangos = ["ene–mar", "abr–jun", "jul–sep", "oct–dic"];
  return rangos[Number(m[2]) - 1] + " " + m[1];
}


// ── Lectura ────────────────────────────────────────────────────────

export function promedioDe(criterios) {
  const valores = CRITERIOS.map(c => Number(criterios && criterios[c.id])).filter(Number.isFinite);
  if (!valores.length) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

function normalizar(id, d) {
  const criterios = {};
  for (const c of CRITERIOS) {
    const v = Number(d && d.criterios && d.criterios[c.id]);
    criterios[c.id] = Number.isFinite(v) ? v : null;
  }
  return {
    id,
    email: (d?.email || "").toLowerCase(),
    name: d?.name || d?.email || "—",
    periodo: d?.periodo || "",
    fecha: d?.fecha || null,             // MM/DD/YYYY, el formato del Hub
    evaluadoPor: d?.evaluadoPor || "",
    criterios,
    promedio: typeof d?.promedio === "number" ? d.promedio : promedioDe(criterios),
    comentario: d?.comentario || "",
    createdAt: d?.createdAt?.toDate?.() || null,
  };
}

/** Todas, agrupadas por email y de la más reciente a la más antigua. */
export async function getEvaluacionesPorPersona() {
  const snap = await getDocs(collection(db, COLLECTION));
  const mapa = new Map();
  snap.docs.forEach(d => {
    const ev = normalizar(d.id, d.data());
    if (!ev.email) return;
    if (!mapa.has(ev.email)) mapa.set(ev.email, []);
    mapa.get(ev.email).push(ev);
  });
  for (const lista of mapa.values()) {
    lista.sort((a, b) => (b.periodo || "").localeCompare(a.periodo || ""));
  }
  return mapa;
}


// ── Estado de cada persona ─────────────────────────────────────────

function fechaUS(str) {
  if (!str) return null;
  const partes = String(str).split("/").map(Number);
  const [m, d, y] = partes;
  if (!m || !d || !y) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}

/**
 * Qué toca con esta persona, según su evaluación más reciente:
 *   "nunca"   — no tiene ninguna
 *   "vencida" — han pasado tres meses o más
 *   "al-dia"  — evaluada dentro del plazo
 */
export function estadoDe(evaluaciones) {
  const ultima = Array.isArray(evaluaciones) && evaluaciones.length ? evaluaciones[0] : null;
  if (!ultima) return { estado: "nunca", meses: null, ultima: null };

  const ref = fechaUS(ultima.fecha) || ultima.createdAt;
  if (!ref) return { estado: "nunca", meses: null, ultima };

  const hoy = new Date();
  let meses = (hoy.getFullYear() - ref.getFullYear()) * 12 + (hoy.getMonth() - ref.getMonth());
  if (hoy.getDate() < ref.getDate()) meses--;

  return {
    estado: meses >= MESES_ENTRE_EVALUACIONES ? "vencida" : "al-dia",
    meses: Math.max(meses, 0),
    ultima,
  };
}


// ── Escritura ──────────────────────────────────────────────────────

/**
 * Sin `id` crea una evaluación nueva; con `id` corrige la que ya existía. Se
 * corrigen y no se borran, y por eso la regla deja update pero no delete.
 */
export async function saveEvaluacion({ id, email, name, periodo, fecha, criterios, comentario }) {
  if (!email) throw new Error("saveEvaluacion: email requerido");
  if (!periodo) throw new Error("saveEvaluacion: periodo requerido");

  const datos = {
    email: email.toLowerCase(),
    name: name || email,
    periodo,
    fecha: fecha || null,
    criterios: criterios || {},
    promedio: promedioDe(criterios),
    comentario: (comentario || "").trim(),
    evaluadoPor: auth.currentUser?.email || "—",
    createdAt: Timestamp.now(),
  };

  if (id) {
    await setDoc(doc(db, COLLECTION, id), datos, { merge: true });
    return id;
  }
  const ref = await addDoc(collection(db, COLLECTION), datos);
  return ref.id;
}
