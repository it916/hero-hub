// ═══════════════════════════════════════════
// Hero Hub · Store de Reportes (Firestore)
// ═══════════════════════════════════════════
// Lectura de la colección `reports`, donde el tile "Reportar" del banner
// guarda los avisos de corte eléctrico, caída de internet y llegada tarde
// (js/reportes.js). Las ausencias NO viven aquí — siguen en `attendance`
// con type="Ausencia", que es lo que lee el panel de HR desde v2.18.0.
//
// Schema de cada documento:
//   {
//     timestamp: Timestamp,        // cuándo se envió el aviso
//     ocurrido: Timestamp | null,  // cuándo pasó (solo avisos "al momento")
//     email, name: string,
//     type: "corte-electrico" | "falla-internet" | "retraso",
//     label: string,               // "Corte eléctrico", para mostrar tal cual
//     fecha: "MM/DD/YYYY" | null,
//     hora: "HH:MM" | null,        // 24h, solo avisos "al momento"
//     alMomento: boolean | null,   // false = corrigió la hora a mano
//     llegadaEstimada: "HH:MM" | null,
//     detalle: string | null,
//     destinos: string[],          // a quién avisar (Fase B, correo)
//     notified: boolean
//   }
//
// Las reglas solo dejan leer los propios; admin e IT ven todo
// (firestore.rules → match /reports/{docId}).

import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "reports";

// Tope de seguridad: aunque HR pida "todo", no traemos más de esto de una
// sentada. Con el volumen actual (unos pocos avisos por semana) sobra.
const MAX_DOCS = 500;

// Lee los reportes en un rango de fechas.
//
// El filtro por tipo se hace en el cliente a propósito: combinar
// where("type") con orderBy("timestamp") exigiría un índice compuesto, y
// ya nos mordió una vez esa piedra (ver el bug de asistencia en v2.32.3).
export async function fetchReports({ from, to, email } = {}) {
  const clauses = [];
  if (email) clauses.push(where("email", "==", email));
  if (from)  clauses.push(where("timestamp", ">=", from instanceof Timestamp ? from : Timestamp.fromDate(from)));
  if (to)    clauses.push(where("timestamp", "<=", to instanceof Timestamp ? to : Timestamp.fromDate(to)));
  clauses.push(orderBy("timestamp", "desc"));
  clauses.push(limit(MAX_DOCS));

  const snap = await getDocs(query(collection(db, COLLECTION), ...clauses));
  return snap.docs.map(d => docToReport(d.id, d.data()));
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function docToReport(id, data) {
  return {
    id,
    email: data.email || "",
    name: data.name || data.email || "—",
    type: data.type || "",
    label: data.label || data.type || "Reporte",
    fecha: data.fecha || null,
    hora: data.hora || null,
    ocurrido: toDate(data.ocurrido),
    alMomento: typeof data.alMomento === "boolean" ? data.alMomento : null,
    llegadaEstimada: data.llegadaEstimada || null,
    detalle: data.detalle || "",
    reportadoAt: toDate(data.timestamp),
    destinos: Array.isArray(data.destinos) ? data.destinos : [],
    notified: data.notified === true,
  };
}
