// ═══════════════════════════════════════════
// Hero Hub · Reportes del banner (HQ Command Center)
// ═══════════════════════════════════════════
// Tile "Reportar": cuatro avisos que el equipo puede mandar sin salir del
// dashboard. Ocupa el lugar del fichaje, retirado en v2.41.0 (Time Doctor).
//
// Tres flujos distintos a propósito:
//
//   • absence → Ausencia. Reusa el modal y la escritura que ya existían en
//               js/attendance.js. Sigue guardándose en la colección
//               `attendance` con type="Ausencia", que es de donde lee el
//               panel de HR (js/asistencia-dashboard.js). Moverla habría
//               dejado a HR sin su lista.
//
//   • instant → Corte eléctrico y Sin internet. Se avisa de un click: el
//               modal enseña la hora actual y basta confirmar. Si la
//               cambian, hay un segundo paso de confirmación, porque el
//               documento queda inmutable (allow update: if false).
//
//   • form    → Llegada tarde. Formulario normal: fecha, hora estimada de
//               llegada y motivo.
//
// FASE A (esto): el reporte se guarda en Firestore y se confirma con toast.
// FASE B (pendiente): aviso por correo vía el Worker `hero-email-worker`
// (repo hero-it-console). El documento ya deja escrito a quién habría que
// avisar en `destinos`, y `notified:false` para que el Worker lo marque.

import { auth, db } from "./firebase-config.js";
import { collection, addDoc, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { openAbsenceModal } from "./attendance.js";

const COLLECTION = "reports";

// El aviso por correo lo manda el Worker (repo hero-it-console). Verifica el
// Firebase ID token contra las JWKs de Google antes de enviar nada.
const WORKER_URL = "https://hero-email-worker.broad-fire-d2d6.workers.dev";

// ── Destinatarios por tipo ─────────────────────────────────────────
// Copia informativa de lo que hace el Worker: se guarda dentro del documento
// para dejar rastro de a quién se avisó. La lista que MANDA es la del Worker
// (DESTINOS_REPORTES en hero-email-worker.js) — si el cliente pudiera elegir
// destinatarios, el endpoint sería un relay de spam. Al cambiar allá, cambiar
// también acá para que el registro no mienta.
const HR = [
  "brokersupport@heroinsuranceusa.com",
  "hr@heroinsuranceusa.com",
  "contracting@heroinsuranceusa.com",
  "jgutierrez@heroinsuranceusa.com",
];
const DESTINOS = {
  "ausencia":         HR,
  "retraso":          HR,
  "corte-electrico":  ["it@heroinsuranceusa.com"].concat(HR),
  "falla-internet":   ["it@heroinsuranceusa.com"].concat(HR),
};

// ── Tipos de reporte ───────────────────────────────────────────────
// Para agregar, quitar o renombrar un tipo, edita solo este array.
//   flow:   'absence' | 'instant' | 'form'
//   fields: solo para flow 'form' — 'date' | 'eta' | 'detail'
//   tone:   color del hover del botón — 'rose' | 'gold' | 'cyan' | 'violet'
const TIPOS = [
  {
    id: "ausencia",
    label: "Ausencia",
    ph: "ph-calendar-x",
    tone: "rose",
    flow: "absence",
    sub: "No podrás trabajar ese día",
  },
  {
    id: "corte-electrico",
    label: "Corte eléctrico",
    ph: "ph-lightning-slash",
    tone: "gold",
    flow: "instant",
    sub: "Se fue la luz en tu zona",
    // El artículo va incluido: se usa en frases como "Vas a reportar el corte…"
    nombreEnFrase: "el corte eléctrico",
    note: "Avisa a tu supervisor y a IT de que estás sin energía. Confirma la hora en que se fue la luz.",
  },
  {
    id: "falla-internet",
    label: "Sin internet",
    ph: "ph-wifi-slash",
    tone: "cyan",
    flow: "instant",
    sub: "Caída de tu conexión",
    nombreEnFrase: "la caída de internet",
    note: "Confirma desde qué hora estás sin conexión. Si sigues trabajando con datos móviles, avísale igual a tu supervisor.",
  },
  {
    id: "retraso",
    label: "Llegada tarde",
    ph: "ph-clock-user",
    tone: "violet",
    flow: "form",
    sub: "Vas a entrar más tarde",
    note: "Para avisar con anticipación. No sustituye tu check in en Time Doctor.",
    fields: ["date", "eta", "detail"],
    detailLabel: "Motivo",
    detailRequired: true,
    detailPlaceholder: "Ej: tráfico, trámite, cita médica temprano…",
  },
];

// ── Helpers ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function toISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function toHM(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// El Hub muestra fechas en formato US.
function isoToUS(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// "2:47 PM" a partir de "14:47"
function hmATexto(hm) {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map(Number);
  const sufijo = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

// "Martes 09/09/2026"
function fechaATexto(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const dia = fecha.toLocaleDateString("es-ES", { weekday: "long" });
  return dia.charAt(0).toUpperCase() + dia.slice(1) + " " + isoToUS(iso);
}

function toast(kind, msg) {
  if (typeof heroToast === "undefined") return;
  if (kind === "error") heroToast.error(msg);
  else heroToast.success(msg);
}

// ── "Último" del tile ──────────────────────────────────────────────
// Se guarda en localStorage en vez de consultarlo a Firestore: la query
// sería where(email) + orderBy(timestamp), que exige un índice compuesto
// (el mismo que faltaba y rompió la asistencia en v2.32.3). Para una línea
// informativa no vale la pena.
const LAST_KEY = "hero-last-report";

function paintLast() {
  const el = $("rep-last-text");
  if (!el) return;
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return;
    const last = JSON.parse(raw);
    if (!last || !last.label) return;
    const fecha = last.fecha ? last.fecha.split("/").slice(0, 2).join("/") : "hoy";
    el.textContent = `${last.label} · ${fecha}`;
  } catch (_) { /* localStorage bloqueado o dato corrupto: se deja el guion */ }
}

function saveLast(label, fecha) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ label, fecha }));
  } catch (_) { /* sin persistencia: el tile solo no recordará el último */ }
  paintLast();
}

// ── Estado del modal ───────────────────────────────────────────────
const FIELD_IDS = { date: "f-date", eta: "f-eta", detail: "f-detail" };
let tipoActual = null;
let enviando = false;
// Instante en que se abrió el modal. Se congela para que el "ahora mismo"
// que el usuario confirmó sea el que se guarda, aunque tarde en decidirse.
let momentoBase = null;

function abrirOverlay(tipo) {
  tipoActual = tipo;
  // El emoji era un textContent; un icono de fuente es un nodo, asi que se
  // reemplaza el contenido en vez de asignar texto.
  const ico = document.createElement("i");
  ico.className = `ph-fill ${tipo.ph}`;
  $("rep-emoji").replaceChildren(ico);
  $("rep-title").textContent = tipo.label;
  $("rep-sub").textContent = tipo.sub;
  $("rep-overlay").classList.add("is-open");
}

function cerrarModal() {
  $("rep-overlay").classList.remove("is-open");
  tipoActual = null;
  momentoBase = null;
}

// ── Flujo 'form' (Llegada tarde) ───────────────────────────────────
function abrirForm(tipo) {
  $("rep-view-form").hidden = false;
  $("rep-view-instant").hidden = true;

  $("rep-note").textContent = tipo.note;

  Object.entries(FIELD_IDS).forEach(([key, elId]) => {
    $(elId).classList.toggle("is-hidden", !tipo.fields.includes(key));
  });

  $("rep-detail-label").textContent = tipo.detailLabel;
  const detalle = $("rep-detail");
  detalle.placeholder = tipo.detailPlaceholder;
  detalle.value = "";

  $("rep-date").value = toISO(new Date());
  $("rep-eta").value = "";

  abrirOverlay(tipo);
}

async function enviarForm() {
  if (!tipoActual || enviando) return;
  const tipo = tipoActual;

  const fechaISO = $("rep-date").value;
  if (tipo.fields.includes("date") && !fechaISO) {
    $("rep-date").focus();
    toast("error", "Selecciona la fecha.");
    return;
  }

  const detalle = ($("rep-detail").value || "").trim();
  if (tipo.detailRequired && !detalle) {
    $("rep-detail").focus();
    toast("error", `Escribe un ${tipo.detailLabel.toLowerCase()} breve.`);
    return;
  }

  await guardar(tipo, $("rep-send"), {
    fecha: isoToUS(fechaISO),
    llegadaEstimada: tipo.fields.includes("eta") ? ($("rep-eta").value || null) : null,
    detalle: detalle || null,
  });
}

// ── Flujo 'instant' (Corte eléctrico · Sin internet) ───────────────
// Paso 1 confirma la hora actual · paso 2 la corrige · paso 3 vuelve a
// confirmar, solo si de verdad cambió.
function mostrarPaso(id) {
  ["rep-step-now", "rep-step-edit", "rep-step-verify"].forEach(paso => {
    $(paso).hidden = paso !== id;
  });
}

function abrirInstant(tipo) {
  $("rep-view-form").hidden = true;
  $("rep-view-instant").hidden = false;

  momentoBase = new Date();
  $("rep-note-instant").textContent = tipo.note;
  $("rep-now-time").textContent = hmATexto(toHM(momentoBase));
  $("rep-now-date").textContent = fechaATexto(toISO(momentoBase));

  $("rep-when-date").value = toISO(momentoBase);
  $("rep-when-time").value = toHM(momentoBase);

  mostrarPaso("rep-step-now");
  abrirOverlay(tipo);
}

// ¿Lo que hay en el paso 2 sigue siendo el momento en que se abrió el modal?
function sinCambios() {
  return $("rep-when-date").value === toISO(momentoBase)
      && $("rep-when-time").value === toHM(momentoBase);
}

function revisarCambios() {
  const fechaISO = $("rep-when-date").value;
  const hora = $("rep-when-time").value;

  if (!fechaISO) { $("rep-when-date").focus(); toast("error", "Selecciona la fecha."); return; }
  if (!hora)     { $("rep-when-time").focus(); toast("error", "Indica la hora."); return; }

  // Si volvió a dejar la hora en la que abrió el modal, no hay nada que
  // reconfirmar: es el mismo caso que haber pulsado "Sí, reportar".
  if (sinCambios()) { enviarInstant(true); return; }

  $("rep-verify-what").textContent = tipoActual.nombreEnFrase;
  $("rep-verify-when").textContent = `${isoToUS(fechaISO)} a las ${hmATexto(hora)}`;
  $("rep-verify-clock").textContent = hmATexto(toHM(new Date()));
  mostrarPaso("rep-step-verify");
}

async function enviarInstant(alMomento) {
  if (!tipoActual || enviando) return;
  const tipo = tipoActual;

  const fechaISO = alMomento ? toISO(momentoBase) : $("rep-when-date").value;
  const hora     = alMomento ? toHM(momentoBase)  : $("rep-when-time").value;

  const [y, m, d] = fechaISO.split("-").map(Number);
  const [hh, mm]  = hora.split(":").map(Number);
  const ocurrido  = new Date(y, m - 1, d, hh, mm, 0, 0);

  const btn = alMomento ? $("rep-now-ok") : $("rep-verify-ok");
  await guardar(tipo, btn, {
    ocurrido: Timestamp.fromDate(ocurrido),
    fecha: isoToUS(fechaISO),
    hora,
    alMomento,
  });
}

// ── Aviso por correo ───────────────────────────────────────────────
// Se manda ANTES de guardar, a propósito: la regla de Firestore es
// `allow update: if false`, así que el documento no se puede editar después
// para marcarlo como avisado. Enviando primero, el registro nace con el
// estado real y nunca hay que tocarlo.
//
// Devuelve true si el correo salió. Nunca lanza: que falle el aviso no debe
// impedir que el reporte quede registrado, que es lo que no se puede perder.
async function notificar(tipo, datos) {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const idToken = await user.getIdToken();
    const resp = await fetch(WORKER_URL + "/reportes/notificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        reporte: {
          type: tipo.id,
          fecha: datos.fecha || null,
          hora: datos.hora || null,
          llegadaEstimada: datos.llegadaEstimada || null,
          detalle: datos.detalle || null,
          alMomento: typeof datos.alMomento === "boolean" ? datos.alMomento : null,
        },
      }),
    });
    if (!resp.ok) {
      let msg = "HTTP " + resp.status;
      try { const d = await resp.json(); msg = d.error || msg; } catch (_) {}
      console.warn("reportes: el aviso por correo falló —", msg);
      return false;
    }
    return true;
  } catch (e) {
    console.error("reportes: no se pudo contactar al Worker —", e);
    return false;
  }
}

// ── Escritura ──────────────────────────────────────────────────────
async function guardar(tipo, btn, extras) {
  const user = auth.currentUser;
  if (!user) {
    toast("error", "Tu sesión expiró. Recarga la página.");
    return;
  }

  const textoOriginal = btn.textContent;
  enviando = true;
  btn.disabled = true;
  btn.textContent = "Enviando…";

  try {
    const avisado = await notificar(tipo, extras);

    const registro = Object.assign({
      timestamp: Timestamp.fromDate(new Date()),
      email: user.email,
      name: user.displayName || user.email.split("@")[0],
      type: tipo.id,
      label: tipo.label,
      destinos: DESTINOS[tipo.id] || [],
      notified: avisado,
    }, extras);

    await addDoc(collection(db, COLLECTION), registro);
    saveLast(tipo.label, registro.fecha);
    cerrarModal();

    if (avisado) toast("ok", `${tipo.label} reportado · aviso enviado`);
    else toast("error", "Reporte guardado, pero no se pudo enviar el aviso por correo");
  } catch (e) {
    console.error("reportes:", e);
    toast("error", "No se pudo enviar el reporte. Reintenta.");
  } finally {
    enviando = false;
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ── Tile ───────────────────────────────────────────────────────────
function pintarTile() {
  const grid = $("rep-grid");
  if (!grid) return;

  // Nota: al exento de fichaje se le oculta el botón de Ausencia, pero por CSS
  // (body.no-attendance en css/styles.css) y no filtrando aquí — la clase la
  // aplica roles.js después de la auth, o sea después de esta función.
  TIPOS.forEach(tipo => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rep-btn";
    btn.dataset.tone = tipo.tone;
    btn.dataset.id = tipo.id;
    btn.title = tipo.sub;

    const emoji = document.createElement("i");
    emoji.className = `ph-fill ${tipo.ph} rep-btn-emoji`;

    const label = document.createElement("span");
    label.className = "rep-btn-label";
    label.textContent = tipo.label;

    btn.append(emoji, label);
    btn.addEventListener("click", () => {
      if (tipo.flow === "absence") {
        // Ausencia mantiene su propio modal (Flatpickr en español) y su
        // escritura a `attendance`, para no romper el panel de HR. El aviso
        // por correo sí pasa por acá: attendance.js guarda, y al volver
        // disparamos la notificación con los datos que acaba de registrar.
        btn.disabled = true;
        openAbsenceModal(btn, async ({ absenceDate, reason }) => {
          saveLast(tipo.label, absenceDate);
          const avisado = await notificar(tipo, { fecha: absenceDate, detalle: reason });
          if (!avisado) toast("error", "Ausencia registrada, pero no se pudo enviar el aviso por correo");
        });
      } else if (tipo.flow === "instant") {
        abrirInstant(tipo);
      } else {
        abrirForm(tipo);
      }
    });

    grid.appendChild(btn);
  });
}

// ── Init ───────────────────────────────────────────────────────────
function init() {
  if (!$("rep-grid")) return;   // página sin el tile

  pintarTile();
  paintLast();

  // Vista formulario
  $("rep-cancel").addEventListener("click", cerrarModal);
  $("rep-send").addEventListener("click", enviarForm);

  // Vista al momento
  $("rep-now-ok").addEventListener("click", () => enviarInstant(true));
  $("rep-now-edit").addEventListener("click", () => mostrarPaso("rep-step-edit"));
  $("rep-edit-back").addEventListener("click", () => mostrarPaso("rep-step-now"));
  $("rep-edit-ok").addEventListener("click", revisarCambios);
  $("rep-verify-back").addEventListener("click", () => mostrarPaso("rep-step-edit"));
  $("rep-verify-ok").addEventListener("click", () => enviarInstant(false));

  const overlay = $("rep-overlay");
  overlay.addEventListener("click", e => { if (e.target === overlay) cerrarModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) cerrarModal();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
