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

  // Accesos denegados (se loguean desde page-guard.js)
  AUTH_DENIED_NO_ROLE: "auth.denied.no_role",
  AUTH_DENIED_PAGE: "auth.denied.page",

  // Portales (solo los del equipo, los personales son privados).
  // Las constantes mantienen el nombre "carrier" como vocabulario técnico interno
  // para no romper los miles de eventos históricos ya guardados en Firestore.
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
  SPOTLIGHT_UPDATE: "spotlight.update",

  // Agencias (Fase 2a)
  AGENCY_ADD: "agency.add",
  AGENCY_EDIT: "agency.edit",
  AGENCY_DELETE: "agency.delete",

  // Finanzas — Tabla de Comisiones
  FINANZAS_COMISION_ADD: "finanzas.comision.add",
  FINANZAS_COMISION_EDIT: "finanzas.comision.edit",
  FINANZAS_COMISION_DELETE: "finanzas.comision.delete",

  // Finanzas — Brokers
  FINANZAS_BROKER_ADD: "finanzas.broker.add",
  FINANZAS_BROKER_EDIT: "finanzas.broker.edit",
  FINANZAS_BROKER_DELETE: "finanzas.broker.delete",

  // Finanzas — Ingresos
  FINANZAS_INGRESO_ADD: "finanzas.ingreso.add",
  FINANZAS_INGRESO_EDIT: "finanzas.ingreso.edit",
  FINANZAS_INGRESO_DELETE: "finanzas.ingreso.delete",

  // Finanzas — Egresos
  FINANZAS_EGRESO_ADD: "finanzas.egreso.add",
  FINANZAS_EGRESO_EDIT: "finanzas.egreso.edit",
  FINANZAS_EGRESO_DELETE: "finanzas.egreso.delete",

  // Finanzas — Envío de reportes por email a brokers
  FINANZAS_EMAIL_SEND: "finanzas.email.send",

  // Finanzas — Reportes de Pago consolidados
  FINANZAS_REPORTE_ADD: "finanzas.reporte.add",
  FINANZAS_REPORTE_EDIT: "finanzas.reporte.edit",
  FINANZAS_REPORTE_DELETE: "finanzas.reporte.delete",
  FINANZAS_REPORTE_SEND: "finanzas.reporte.send",
  FINANZAS_REPORTE_PAY: "finanzas.reporte.pay"
};

// Etiquetas amigables para mostrar en la UI
export const ACTION_LABELS = {
  "role.create": { label: "Usuario agregado", icon: "user-plus", color: "#22a06b" },
  "role.update": { label: "Rol cambiado", icon: "shuffle", color: "#06a3b6" },
  "role.delete": { label: "Usuario eliminado", icon: "user-x", color: "#c0392b" },
  "auth.denied.no_role": { label: "Acceso denegado (sin rol)", icon: "shield-off", color: "#e8a317" },
  "auth.denied.page": { label: "Acceso denegado (página)", icon: "shield-off", color: "#e8a317" },
  "carrier.team.add": { label: "Portal del equipo agregado", icon: "shield-plus", color: "#22a06b" },
  "carrier.team.edit": { label: "Portal del equipo editado", icon: "edit-3", color: "#06a3b6" },
  "carrier.team.delete": { label: "Portal del equipo eliminado", icon: "shield-off", color: "#c0392b" },
  "contact.add": { label: "Contacto agregado", icon: "user-plus", color: "#22a06b" },
  "contact.edit": { label: "Contacto editado", icon: "edit-3", color: "#06a3b6" },
  "contact.delete": { label: "Contacto eliminado", icon: "user-x", color: "#c0392b" },
  "message.delete": { label: "Mensaje eliminado", icon: "trash-2", color: "#c0392b" },
  "spotlight.update": { label: "Spotlight actualizado", icon: "star", color: "#e8a317" },
  "agency.add": { label: "Agencia agregada", icon: "plus-circle", color: "#22a06b" },
  "agency.edit": { label: "Agencia editada", icon: "edit-3", color: "#06a3b6" },
  "agency.delete": { label: "Agencia eliminada", icon: "trash-2", color: "#c0392b" },
  "finanzas.comision.add": { label: "Comisión agregada", icon: "percent", color: "#22a06b" },
  "finanzas.comision.edit": { label: "Comisión editada", icon: "edit-3", color: "#06a3b6" },
  "finanzas.comision.delete": { label: "Comisión eliminada", icon: "trash-2", color: "#c0392b" },
  "finanzas.broker.add": { label: "Broker agregado", icon: "user-plus", color: "#22a06b" },
  "finanzas.broker.edit": { label: "Broker editado", icon: "edit-3", color: "#06a3b6" },
  "finanzas.broker.delete": { label: "Broker eliminado", icon: "user-x", color: "#c0392b" },
  "finanzas.ingreso.add": { label: "Ingreso registrado", icon: "arrow-down-circle", color: "#22a06b" },
  "finanzas.ingreso.edit": { label: "Ingreso editado", icon: "edit-3", color: "#06a3b6" },
  "finanzas.ingreso.delete": { label: "Ingreso eliminado", icon: "trash-2", color: "#c0392b" },
  "finanzas.egreso.add": { label: "Egreso registrado", icon: "arrow-up-circle", color: "#c0392b" },
  "finanzas.egreso.edit": { label: "Egreso editado", icon: "edit-3", color: "#06a3b6" },
  "finanzas.egreso.delete": { label: "Egreso eliminado", icon: "trash-2", color: "#c0392b" },
  "finanzas.email.send": { label: "Reporte enviado al broker", icon: "send", color: "#06a3b6" },
  "finanzas.reporte.add": { label: "Reporte de pago generado", icon: "receipt", color: "#22a06b" },
  "finanzas.reporte.edit": { label: "Reporte de pago editado", icon: "edit-3", color: "#06a3b6" },
  "finanzas.reporte.delete": { label: "Reporte de pago eliminado", icon: "trash-2", color: "#c0392b" },
  "finanzas.reporte.send": { label: "Reporte de pago enviado", icon: "send", color: "#06a3b6" },
  "finanzas.reporte.pay": { label: "Reporte de pago marcado pagado", icon: "check-circle", color: "#22a06b" }
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
