// ═══════════════════════════════════════════
// Hero Hub · Sistema de Auditoría
// ═══════════════════════════════════════════
// Registra eventos importantes en la colección `audit-log` de Firestore.
// Este módulo expone funciones para:
//   - logEvent(): registrar un evento desde cualquier página
//   - fetchRecentEvents(): consultar eventos recientes (usado por el panel de admin)
//
// Cada evento tiene este formato:
//   {
//     timestamp: Timestamp de Firestore,
//     actor: "email@heroinsuranceusa.com",
//     actorName: "Nombre del usuario",
//     action: "role.update" | "carrier.edit" | etc.,
//     target: "email o nombre del afectado",
//     details: { ...info extra }
//   }

import { auth, db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, where, orderBy, limit, Timestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const COLLECTION = "audit-log";

// ═══════════════════════════════════════════
// CATÁLOGO DE ACCIONES
// ═══════════════════════════════════════════
// Usar estos strings garantiza consistencia al momento de filtrar/buscar.

export const ACTIONS = {
  // Gestión de roles
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_DELETE: "role.delete",

  // Autenticación
  AUTH_LOGIN: "auth.login",
  AUTH_DENIED_NO_ROLE: "auth.denied.no_role",
  AUTH_DENIED_PAGE: "auth.denied.page",

  // Carriers (solo los del equipo, las personales son privadas)
  CARRIER_TEAM_ADD: "carrier.team.add",
  CARRIER_TEAM_EDIT: "carrier.team.edit",
  CARRIER_TEAM_DELETE: "carrier.team.delete",

  // Directorio
  CONTACT_ADD: "contact.add",
  CONTACT_EDIT: "contact.edit",
  CONTACT_DELETE: "contact.delete",

  // Mensajes (admin)
  MESSAGE_DELETE: "message.delete",

  // Spotlight
  SPOTLIGHT_UPDATE: "spotlight.update"
};

// Etiquetas amigables para mostrar en la UI
export const ACTION_LABELS = {
  "role.create": { label: "Usuario agregado", icon: "user-plus", color: "#22a06b" },
  "role.update": { label: "Rol cambiado", icon: "shuffle", color: "#06a3b6" },
  "role.delete": { label: "Usuario eliminado", icon: "user-x", color: "#c0392b" },
  "auth.login": { label: "Inicio de sesión", icon: "log-in", color: "#5a6b7a" },
  "auth.denied.no_role": { label: "Acceso denegado (sin rol)", icon: "shield-off", color: "#e8a317" },
  "auth.denied.page": { label: "Acceso denegado (página)", icon: "shield-off", color: "#e8a317" },
  "carrier.team.add": { label: "Carrier del equipo agregado", icon: "shield-plus", color: "#22a06b" },
  "carrier.team.edit": { label: "Carrier del equipo editado", icon: "edit-3", color: "#06a3b6" },
  "carrier.team.delete": { label: "Carrier del equipo eliminado", icon: "shield-off", color: "#c0392b" },
  "contact.add": { label: "Contacto agregado", icon: "user-plus", color: "#22a06b" },
  "contact.edit": { label: "Contacto editado", icon: "edit-3", color: "#06a3b6" },
  "contact.delete": { label: "Contacto eliminado", icon: "user-x", color: "#c0392b" },
  "message.delete": { label: "Mensaje eliminado", icon: "trash-2", color: "#c0392b" },
  "spotlight.update": { label: "Spotlight actualizado", icon: "star", color: "#e8a317" }
};


// ═══════════════════════════════════════════
// REGISTRO DE EVENTOS
// ═══════════════════════════════════════════

/**
 * Registra un evento en el log de auditoría.
 * Es "fire and forget": si falla, no rompe la acción original, solo lo avisa en consola.
 *
 * @param {string} action - Una de las constantes de ACTIONS
 * @param {string} target - Email o nombre del afectado (puede ser vacío)
 * @param {object} details - Datos adicionales relevantes al evento
 */
export async function logEvent(action, target = "", details = {}) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.warn("logEvent: no hay usuario autenticado");
      return;
    }

    const event = {
      timestamp: Timestamp.now(),
      actor: user.email,
      actorName: user.displayName || user.email.split("@")[0],
      action: action,
      target: target,
      details: details || {}
    };

    await addDoc(collection(db, COLLECTION), event);
  } catch (e) {
    // Silencioso: no queremos que un fallo de auditoría bloquee la acción del usuario.
    console.warn("logEvent failed:", e.message);
  }
}


// ═══════════════════════════════════════════
// CONSULTA DE EVENTOS
// ═══════════════════════════════════════════

/**
 * Obtiene los eventos más recientes del log (ordenados por fecha descendente).
 * @param {number} maxResults - Cuántos eventos traer (default: 200)
 * @returns {Array} Lista de eventos con formato { id, timestamp (Date), ...resto }
 */
export async function fetchRecentEvents(maxResults = 200) {
  try {
    const q = query(
      collection(db, COLLECTION),
      orderBy("timestamp", "desc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        // Convertir Timestamp de Firestore a Date para facilitar el uso
        timestamp: data.timestamp?.toDate() || new Date()
      };
    });
  } catch (e) {
    console.error("fetchRecentEvents failed:", e);
    return [];
  }
}


// ═══════════════════════════════════════════
// LIMPIEZA DE EVENTOS ANTIGUOS
// ═══════════════════════════════════════════

/**
 * Elimina eventos con más de `days` días de antigüedad.
 * @returns {number} Cantidad de eventos eliminados
 */
export async function cleanupOldEvents(days = 365) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const q = query(
      collection(db, COLLECTION),
      where("timestamp", "<", Timestamp.fromDate(cutoff))
    );
    const snap = await getDocs(q);

    let deleted = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      deleted++;
    }
    return deleted;
  } catch (e) {
    console.error("cleanupOldEvents failed:", e);
    throw e;
  }
}
