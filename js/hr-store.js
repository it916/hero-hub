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
//   country   → país donde VIVE hoy (ISO). No confundir con identity.country,
//               que es de dónde ES y sí es público (la bandera de Equipo).
//               Para quien vive fuera de su país los dos difieren, y el que
//               manda para huso, ley laboral y forma de pago es este.
//   timezone  → zona horaria IANA (ej. "America/Caracas"). El equipo es
//               remoto y los reportes llevan hora: sin esto, un "llegué 9:15"
//               no se puede leer bien desde otro huso.
//   address   → dirección completa
//   startDate → cuándo entró a Hero (MM/DD/YYYY). meta.createdAt de users/ NO
//               sirve: es cuándo se creó el documento.
//   schedule  → horario asignado. Dos formas conviven a propósito:
//                 { byDay: { "1": {from,to}, "3": {from,to} } }   ← actual
//                 { from, to, days:[1,3,5] }                      ← anterior
//               La vieja es el caso particular de la nueva: un mismo rango
//               repetido en varios días. Se lee con leerHorario(), que
//               devuelve siempre la forma nueva, así que no hizo falta migrar
//               ni un documento. Se dejó de escribir en v2.56.0, cuando
//               aparecieron los horarios que cambian según el día.
//   birthDate → fecha de nacimiento COMPLETA (MM/DD/YYYY). El año vive acá y
//               no en users/: revela la edad, y ese documento lo lee
//               cualquiera del dominio. El widget de cumpleaños del Hub sigue
//               leyendo identity.birthdate (MM-DD), que se deriva de este.
//   docsUrl   → carpeta de Drive con contratos y documentos. Se guarda el
//               enlace, no los archivos: los permisos los gestiona Workspace.
//
// La regla es `allow read, write: if esAdmin()`. Si algún día RRHH se abre a
// un rol que no sea admin, hay que ampliar TAMBIÉN esa regla — el guard de la
// página por sí solo no protege los datos.

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "hr-data";

const VACIO = {
  city: null, address: null, startDate: null, schedule: null, docsUrl: null,
  birthDate: null, country: null, timezone: null,
};

/**
 * Lee un schedule en cualquiera de sus dos formas y devuelve siempre la misma:
 *
 *   { porDia: { 1:{from,to}, 3:{from,to} }, dias:[1,3], uniforme:true|false }
 *
 * `dias` va ordenado de lunes a domingo, no por el número del día: getDay()
 * pone el domingo en 0 y un `[0,1,2]` crudo empezaría la semana en domingo.
 * `uniforme` dice si todos los días trabajados comparten el mismo rango — es
 * lo que permite escribir "lunes a viernes, 9 a 5" en vez de cinco líneas.
 *
 * Devuelve null si no hay nada que enseñar.
 */
export function leerHorario(schedule) {
  if (!schedule || typeof schedule !== "object") return null;

  const porDia = {};

  if (schedule.byDay && typeof schedule.byDay === "object") {
    for (const [clave, horas] of Object.entries(schedule.byDay)) {
      const n = Number(clave);
      if (!Number.isInteger(n) || n < 0 || n > 6) continue;
      porDia[n] = { from: horas?.from || null, to: horas?.to || null };
    }
  } else if (Array.isArray(schedule.days)) {
    // Forma anterior: un solo rango para todos los días marcados.
    for (const n of schedule.days) {
      if (!Number.isInteger(n) || n < 0 || n > 6) continue;
      porDia[n] = { from: schedule.from || null, to: schedule.to || null };
    }
  }

  const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
  const dias = ORDEN_SEMANA.filter(n => porDia[n]);
  if (!dias.length) return null;

  const conHoras = dias.filter(n => porDia[n].from && porDia[n].to);
  const uniforme = conHoras.length === dias.length && conHoras.every(n =>
    porDia[n].from === porDia[dias[0]].from && porDia[n].to === porDia[dias[0]].to);

  return { porDia, dias, uniforme };
}

function normalizar(data) {
  return {
    city: data?.city || null,
    address: data?.address || null,
    startDate: data?.startDate || null,
    schedule: data?.schedule || null,
    docsUrl: data?.docsUrl || null,
    birthDate: data?.birthDate || null,
    country: data?.country || null,
    timezone: data?.timezone || null,
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
  await setDoc(ref, limpiarHorarioViejo(patch), { merge: true });
}

// El merge de Firestore es recursivo DENTRO de los mapas: escribir
// schedule:{byDay} no reemplaza el mapa, lo fusiona, y el from/to/days de la
// forma anterior sobrevive. El documento acaba diciendo dos cosas distintas
// —un byDay con siete días junto a un days:[1,2,3,4,5]— y aunque
// leerHorario() mira byDay primero y enseña lo correcto, lo guardado miente.
// Se borran los tres campos viejos en el mismo guardado.
//
// Ese mismo merge recursivo muerde un nivel más adentro: el día que el
// formulario desmarca no viaja en el patch, así que el de antes sobrevive
// dentro de byDay. Quien dejaba de trabajar el sábado seguía apareciendo
// «trabajando» el sábado, y el formulario mostraba el día desmarcado, así que
// nadie lo notaba. Los días son un dominio cerrado (0-6): lo que no venga en
// el patch se borra explícitamente, sin necesidad de leer el estado anterior.
//
// No hace falta migrar nada: los documentos que nadie vuelva a guardar
// conservan solo la forma vieja, que leerHorario() entiende igual.
function limpiarHorarioViejo(patch) {
  if (!patch?.schedule?.byDay) return patch;
  const byDay = { ...patch.schedule.byDay };
  for (let n = 0; n < 7; n++) {
    if (!(n in byDay)) byDay[n] = deleteField();
  }
  return {
    ...patch,
    schedule: {
      byDay,
      from: deleteField(),
      to: deleteField(),
      days: deleteField(),
    },
  };
}
