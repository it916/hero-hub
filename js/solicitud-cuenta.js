// ═══════════════════════════════════════════════════════════════
// Hero Hub · Solicitud de cuenta (alta/baja de correo @heroinsuranceusa.com)
// ═══════════════════════════════════════════════════════════════
// Página interna del Hub. Toda solicitud queda ligada al usuario autenticado
// (currentUser) — el solicitante NO puede spoofear su email/nombre porque se
// autocompleta de la sesión de Firebase y los campos no son editables.
//
// El backend es el mismo Worker de Cloudflare que consumía la página vieja
// (`https://hero-email-worker.broad-fire-d2d6.workers.dev/solicitud-cuenta`).
// El endpoint es público, pero la data del solicitante viene del auth del Hub.
//
// Ver [[project-it-console-integration]] y el endpoint POST /solicitud-cuenta
// en `hero-it-console/hero-email-worker.js` (~línea 848).

import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { guardPage, filterTopbarByRole, applyRoleClasses } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const WORKER_URL = "https://hero-email-worker.broad-fire-d2d6.workers.dev";
const CORPORATE_DOMAIN = "@heroinsuranceusa.com";

// ── Estado del formulario ────────────────────────────────────────
let tipo = "alta";
const persona = { alta: "agente", baja: "agente" };
let currentUser = null;

// ── Helpers ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) && $(id).value.trim()) || "";
const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// ── Auth guard ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  const ctx = await guardPage(user);
  if (!ctx) return; // guardPage redirige por su cuenta si no hay permiso
  currentUser = user;
  showApp(ctx);
});

async function showApp({ user, userRole }) {
  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  applyRoleClasses(userRole);

  // Avatar (para el user-menu del topbar)
  try {
    const photoUrl = await getFreshGooglePhotoURL(user);
    const av = document.getElementById("user-avatar");
    if (av) av.src = photoUrl;
  } catch (_) {}

  // Solicitante auto-completado (no editable)
  const nombreShow = user.displayName || user.email.split("@")[0];
  $("sc-solicitante-nombre").textContent = nombreShow;
  $("sc-solicitante-email").textContent = user.email;

  filterTopbarByRole(userRole);

  // Botón logout del topbar (para user-menu.js)
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.addEventListener("click", () => signOut(auth));

  wireForm();
  if (window.refreshIcons) window.refreshIcons();
}

// ── Wire del formulario ──────────────────────────────────────────
function wireForm() {
  // Toggle Alta/Baja
  document.querySelectorAll(".sc-tipo-btn").forEach(btn => {
    btn.addEventListener("click", () => setTipo(btn.dataset.tipo));
  });

  // Sub-toggle Agente/Empleado (para cada grupo)
  document.querySelectorAll(".sc-persona button").forEach(btn => {
    btn.addEventListener("click", () => {
      const grupo = btn.parentElement.dataset.grupo;
      setPersona(grupo, btn.dataset.persona);
    });
  });

  // Formato del teléfono (10 dígitos → (XXX) XXX-XXXX)
  const telInput = $("sc-alta-telefono");
  if (telInput) {
    telInput.addEventListener("input", () => {
      const d = telInput.value.replace(/\D/g, "").slice(0, 10);
      if (d.length === 0) telInput.value = "";
      else if (d.length <= 3) telInput.value = "(" + d;
      else if (d.length <= 6) telInput.value = "(" + d.slice(0, 3) + ") " + d.slice(3);
      else telInput.value = "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    });
  }

  // Fecha mínima = hoy
  const fechaInput = $("sc-fecha-requerida");
  if (fechaInput) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    fechaInput.min = hoy.toISOString().slice(0, 10);
  }

  // Estado inicial coherente: agente por default en ambos grupos
  setPersona("alta", "agente");
  setPersona("baja", "agente");
  setTipo("alta");

  // Submit
  $("sc-form").addEventListener("submit", handleSubmit);
}

function setTipo(nuevo) {
  tipo = nuevo;
  document.querySelectorAll(".sc-tipo-btn").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.tipo === nuevo ? "true" : "false");
  });
  $("sc-group-alta").classList.toggle("sc-hidden", nuevo !== "alta");
  $("sc-group-baja").classList.toggle("sc-hidden", nuevo !== "baja");

  // Ajustes contextuales del botón submit + help de fecha
  const label = $("sc-submit-label");
  const fechaHelp = $("sc-fecha-help");
  if (nuevo === "alta") {
    label.textContent = "Enviar solicitud de alta";
    if (fechaHelp) fechaHelp.textContent = "Día en que la cuenta debe estar activa.";
  } else {
    label.textContent = "Enviar solicitud de baja";
    if (fechaHelp) fechaHelp.textContent = "Día en que la cuenta debe quedar desactivada.";
  }
  const submitBtn = $("sc-submit-btn");
  submitBtn.classList.toggle("sc-submit-baja", nuevo === "baja");
}

function setPersona(grupo, nueva) {
  persona[grupo] = nueva;
  const holder = document.querySelector(`.sc-persona[data-grupo="${grupo}"]`);
  if (!holder) return;
  holder.querySelectorAll("button").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.persona === nueva ? "true" : "false");
  });
  const soloEmp = $(`sc-${grupo}-solo-empleado`);
  if (soloEmp) soloEmp.classList.toggle("sc-hidden", nueva !== "empleado");
}

// ── Recolección + validación ─────────────────────────────────────
function recolectar() {
  const tipoPersona = persona[tipo];
  const common = {
    tipoSolicitud: tipo,
    tipoPersona,
    fechaRequerida: val("sc-fecha-requerida"),
    solicitanteNombre: currentUser.displayName || currentUser.email.split("@")[0],
    solicitanteEmail: currentUser.email,
  };

  if (tipo === "alta") {
    const alta = {
      nombre: val("sc-alta-nombre"),
      apellido: val("sc-alta-apellido"),
      correoPersonal: val("sc-alta-correo-personal"),
      telefono: val("sc-alta-telefono"),
    };
    if (tipoPersona === "empleado") {
      alta.cargo = val("sc-alta-cargo");
      alta.area = val("sc-alta-area");
    }
    return { ...common, ...alta };
  }

  const baja = {
    nombre: val("sc-baja-nombre"),
    correoEliminar: val("sc-baja-correo-eliminar"),
    motivo: val("sc-baja-motivo"),
    detalle: val("sc-baja-detalle"),
  };
  if (tipoPersona === "empleado") {
    baja.cargo = val("sc-baja-cargo");
    baja.area = val("sc-baja-area");
  }
  return { ...common, ...baja };
}

function validar(data) {
  if (!data.fechaRequerida) return "Selecciona la fecha requerida.";
  const esEmpleado = data.tipoPersona === "empleado";

  if (data.tipoSolicitud === "alta") {
    if (!data.nombre || !data.apellido || !data.correoPersonal || !data.telefono) {
      return "Completa todos los datos de la persona.";
    }
    if (esEmpleado && (!data.cargo || !data.area)) {
      return "Para empleados, cargo y área son obligatorios.";
    }
    if (!emailValido(data.correoPersonal)) {
      return "El correo personal no parece válido.";
    }
    if (data.telefono.replace(/\D/g, "").length !== 10) {
      return "El teléfono debe tener 10 dígitos.";
    }
    return null;
  }

  // baja
  if (!data.nombre || !data.correoEliminar || !data.motivo) {
    return "Completa todos los datos requeridos de la baja.";
  }
  if (esEmpleado && (!data.cargo || !data.area)) {
    return "Para empleados, cargo y área son obligatorios.";
  }
  if (!emailValido(data.correoEliminar)) {
    return "El correo a desactivar no parece válido.";
  }
  if (data.correoEliminar.toLowerCase().indexOf(CORPORATE_DOMAIN) === -1) {
    return `El correo a desactivar debe ser corporativo (${CORPORATE_DOMAIN}).`;
  }
  return null;
}

function limpiar() {
  const ids = [
    "sc-fecha-requerida",
    "sc-alta-nombre", "sc-alta-apellido", "sc-alta-cargo", "sc-alta-area",
    "sc-alta-correo-personal", "sc-alta-telefono",
    "sc-baja-nombre", "sc-baja-correo-eliminar", "sc-baja-motivo",
    "sc-baja-cargo", "sc-baja-area", "sc-baja-detalle",
  ];
  ids.forEach(id => { const el = $(id); if (el) el.value = ""; });
  setTipo("alta");
  setPersona("alta", "agente");
  setPersona("baja", "agente");
}

// ── Submit ───────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const data = recolectar();
  const err = validar(data);
  if (err) {
    if (window.heroToast) heroToast.error(err);
    else alert(err);
    return;
  }

  const btn = $("sc-submit-btn");
  const label = $("sc-submit-label");
  const prevLabel = label.textContent;
  btn.disabled = true;
  label.textContent = "Enviando…";

  try {
    const resp = await fetch(`${WORKER_URL}/solicitud-cuenta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || "Error del servidor");

    const tituloOk = data.tipoSolicitud === "alta"
      ? "Solicitud de alta enviada"
      : "Solicitud de baja enviada";
    if (window.heroToast) {
      heroToast.success(`${tituloOk} — los autorizadores recibirán el correo en un momento.`);
    } else {
      alert(`${tituloOk} — los autorizadores recibirán el correo en un momento.`);
    }
    limpiar();
  } catch (err) {
    if (window.heroToast) heroToast.error("No se pudo enviar: " + err.message);
    else alert("No se pudo enviar: " + err.message);
  } finally {
    btn.disabled = false;
    label.textContent = prevLabel;
  }
}
