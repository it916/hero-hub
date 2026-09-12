// ═══════════════════════════════════════════
// Hero Hub · Recursos Humanos — vista por persona
// ═══════════════════════════════════════════
// Ficha completa de cada integrante del equipo. Junta DOS fuentes:
//
//   users/{email}    — lo público del Hub: nombre, foto, cargo, país,
//                      cumpleaños, teléfonos. Lo lee cualquiera del dominio,
//                      porque de ahí salen el directorio y el módulo Equipo.
//   hr-data/{email}  — lo de RRHH: ciudad, dirección, fecha de ingreso,
//                      horario y la carpeta de documentos. Solo admin, por
//                      regla de Firestore (ver js/hr-store.js).
//
// La separación no es estética: mientras estos campos vivieron en users/,
// cualquiera del dominio podía leerlos consultando la colección, aunque
// ninguna pantalla los mostrara.
//
// Se editan desde acá, no desde admin → Usuarios: ese modal gestiona la
// cuenta (rol, accesos, foto) y este formulario, la relación laboral.
//
// Los reportes de la persona salen del rango elegido en la toolbar, que
// administra js/rrhh-dashboard.js — este módulo se suscribe a sus cambios.

import {
  getAllUsers, countryLabel, countryFlagUrl, countryOptions, updateUserFields,
} from "./user-store.js";
import { getAllHrData, saveHrData } from "./hr-store.js";
import { abrirCalendario, initCalendario } from "./rrhh-calendario.js";
import {
  getItemsEnRango, getEtiquetaRango, onDatosActualizados, aplicarVistaGeneral,
  setDirectorio,
} from "./rrhh-dashboard.js";

// Iconos de Phosphor, no emojis ([[feedback_iconos_phosphor]]). Mismos que
// usa la vista general, para que un tipo se reconozca igual en las dos.
const TIPO_ICONO = {
  "ausencia": "ph-calendar-x",
  "retraso": "ph-clock-user",
  "corte-electrico": "ph-lightning-slash",
  "falla-internet": "ph-wifi-slash",
};

const DIAS = [
  { n: 1, corto: "L",  largo: "lunes" },
  { n: 2, corto: "M",  largo: "martes" },
  { n: 3, corto: "X",  largo: "miércoles" },
  { n: 4, corto: "J",  largo: "jueves" },
  { n: 5, corto: "V",  largo: "viernes" },
  { n: 6, corto: "S",  largo: "sábado" },
  { n: 0, corto: "D",  largo: "domingo" },
];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const HERO_DOMAIN = "@heroinsuranceusa.com";

// Huso por país, para autocompletar al elegir la ubicación. Es una sugerencia:
// el select queda editable porque hay países con varios husos (US, BR, MX) y
// acá solo se ofrece el más probable.
const TZ_POR_PAIS = {
  VE: "America/Caracas",   CU: "America/Havana",    CO: "America/Bogota",
  CL: "America/Santiago",  HN: "America/Tegucigalpa", US: "America/New_York",
  AR: "America/Argentina/Buenos_Aires", MX: "America/Mexico_City",
  ES: "Europe/Madrid",     PE: "America/Lima",      EC: "America/Guayaquil",
  UY: "America/Montevideo", CR: "America/Costa_Rica", PA: "America/Panama",
  DO: "America/Santo_Domingo", GT: "America/Guatemala", NI: "America/Managua",
  SV: "America/El_Salvador", BO: "America/La_Paz",  PY: "America/Asuncion",
  PR: "America/Puerto_Rico", BR: "America/Sao_Paulo",
};

// Etiqueta legible para el select de husos: "Caracas (GMT-4)".
function tzEtiqueta(tz) {
  const ciudad = tz.split("/").pop().replace(/_/g, " ");
  const off = tzOffset(tz);
  return off ? `${ciudad} (${off})` : ciudad;
}

// Offset actual del huso, calculado con Intl para no hardcodear horarios de
// verano — Chile y Paraguay lo cambian, Venezuela no.
function tzOffset(tz) {
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return partes.find(p => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
}

// Hora local de la persona, para leer sus reportes sin hacer la cuenta mental.
function horaEn(tz) {
  if (!tz) return "";
  try {
    // en-US y no es-ES: este da "06:17 p. m." y el resto de la ficha usa el
    // "6:17 PM" que produce hm12().
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date());
  } catch { return ""; }
}

// Febrero con 29 a propósito: el cumpleaños se guarda sin año, así que el 29
// es una fecha legítima aunque no exista todos los años.
const DIAS_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const diasDelMes = m => DIAS_MES[m - 1] || 31;

const $ = id => document.getElementById(id);

let personas = [];
let hrData = new Map();    // email -> { city, address, startDate, schedule, docsUrl }
let seleccionada = null;   // email
let editando = false;

// Flatpickr cuelga su calendario de <body>, no del input. Como la ficha se
// repinta entera (replaceChildren), sin destruir las instancias los calendarios
// del formulario anterior quedan huérfanos en el DOM y se van acumulando.
let pickers = [];

function destruirPickers() {
  for (const fp of pickers) {
    try { fp.destroy(); } catch (_) {}
  }
  pickers = [];
}

// Devuelve siempre un objeto, aunque la persona no tenga ficha todavia.
function hrDe(email) {
  return hrData.get(email)
    || { city: null, address: null, startDate: null, schedule: null, docsUrl: null, birthDate: null };
}

// ── Formato ────────────────────────────────────────────────────────
function hm12(hm) {
  if (!hm) return "";
  const [h, m] = String(hm).split(":").map(Number);
  if (isNaN(h)) return String(hm);
  const suf = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${suf}`;
}

function parseUS(str) {
  if (!str) return null;
  const [m, d, y] = String(str).split("/").map(Number);
  if (!m || !d || !y) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}

// "1 año, 6 meses" a partir de la fecha de ingreso.
function antiguedad(desde) {
  const d = parseUS(desde);
  if (!d) return "";
  const hoy = new Date();
  let meses = (hoy.getFullYear() - d.getFullYear()) * 12 + (hoy.getMonth() - d.getMonth());
  if (hoy.getDate() < d.getDate()) meses--;
  if (meses < 0) return "aún no empieza";
  const a = Math.floor(meses / 12);
  const m = meses % 12;
  const partes = [];
  if (a) partes.push(a === 1 ? "1 año" : `${a} años`);
  if (m) partes.push(m === 1 ? "1 mes" : `${m} meses`);
  return partes.length ? partes.join(", ") : "menos de un mes";
}

// Edad a partir de la fecha completa (MM/DD/YYYY) que guarda RRHH.
function edadDe(fecha) {
  const d = parseUS(fecha);
  if (!d) return null;
  const hoy = new Date();
  let anos = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) anos--;
  return anos >= 0 && anos < 120 ? anos : null;
}

// Convierte MM/DD/YYYY al MM-DD que consume el widget de cumpleaños.
function aMMDD(fecha) {
  const d = parseUS(fecha);
  if (!d) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// identity.birthdate se guarda como MM/DD (sin año) o MM/DD/YYYY.
function cumpleTexto(birthdate) {
  if (!birthdate) return "";
  const [m, d] = String(birthdate).split("/").map(Number);
  if (!m || !d) return String(birthdate);
  return `${d} de ${MESES[m - 1] || "?"}`;
}

function horarioTexto(schedule) {
  if (!schedule) return "";
  const dias = Array.isArray(schedule.days) ? schedule.days : [];
  let cuando = "";
  if (dias.length) {
    const ord = DIAS.filter(d => dias.includes(d.n));
    // Lunes a viernes es el caso normal: se dice así en vez de listar cinco.
    const esLaV = dias.length === 5 && [1, 2, 3, 4, 5].every(n => dias.includes(n));
    cuando = esLaV ? "lunes a viernes" : ord.map(d => d.largo).join(", ");
  }
  // Los días de trabajo se guardan aunque no haya hora de entrada y salida:
  // son un dato por derecho propio, no un adorno del horario. Sin ellos la
  // ficha se quedaba sin decir qué días trabaja la persona.
  if (!schedule.from || !schedule.to) return cuando ? `${cuando} · sin horario fijo` : "";

  return `${hm12(schedule.from)} – ${hm12(schedule.to)}${cuando ? " · " + cuando : ""}`;
}

// ── Helpers de DOM ─────────────────────────────────────────────────
function el(tag, className, texto) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (texto != null) n.textContent = texto;
  return n;
}

// Separador dentro del formulario. El formulario escribe en dos colecciones
// distintas y conviene que se vea: arriba hr-data, abajo users/.
function subtitulo(texto) {
  const t = el("div", "section-label rh-form-sep");
  t.appendChild(el("span", "kicker-dot"));
  t.appendChild(el("span", null, texto));
  return t;
}

// Una línea de teléfono con su botón de quitar. La lista nunca queda sin
// ninguna fila: la última se vacía en vez de borrarse, para que siempre haya
// dónde escribir.
function filaTelefono(valor) {
  const fila = el("div", "rh-phone-row");

  const input = document.createElement("input");
  input.type = "tel";
  input.className = "rh-input";
  input.placeholder = "+58 412 000 0000";
  input.value = valor || "";

  const quitar = el("button", "rh-phone-del");
  quitar.type = "button";
  quitar.title = "Quitar este teléfono";
  quitar.setAttribute("aria-label", "Quitar este teléfono");
  const icono = document.createElement("i");
  icono.setAttribute("data-lucide", "x");
  quitar.appendChild(icono);
  quitar.addEventListener("click", () => {
    const lista = fila.parentElement;
    if (lista && lista.children.length > 1) fila.remove();
    else input.value = "";
  });

  fila.append(input, quitar);
  return fila;
}

function dato(etiqueta, valor, placeholder) {
  const fila = el("div", "rh-dato");
  fila.appendChild(el("div", "rh-dato-label", etiqueta));
  const v = el("div", "rh-dato-value", valor || placeholder || "— sin registrar —");
  if (!valor) v.classList.add("vacio");
  fila.appendChild(v);
  return fila;
}

// ── Lista de personas ──────────────────────────────────────────────
async function cargarPersonas() {
  const lista = $("rh-people-list");
  if (!lista) return;

  try {
    // Las dos colecciones van en paralelo: ninguna depende de la otra y se
    // cruzan por email.
    const [users, hr] = await Promise.all([getAllUsers(), getAllHrData()]);
    personas = users;
    hrData = hr;
    personas.sort((a, b) => (a.identity?.name || "").localeCompare(b.identity?.name || ""));
    pintarLista();
    // La vista general agrupa las barras por persona y necesita el mismo
    // directorio para resolver los alias. Se lo pasamos en vez de que relea
    // la colección por su cuenta.
    setDirectorio(users);
  } catch (e) {
    console.error("rrhh-personas:", e);
    lista.replaceChildren(el("div", "ad-empty", "No se pudo cargar el equipo."));
  }
}

function pintarLista() {
  const lista = $("rh-people-list");
  const filtro = ($("rh-people-filter")?.value || "").trim().toLowerCase();

  const visibles = personas.filter(p => {
    if (!filtro) return true;
    const nombre = (p.identity?.name || "").toLowerCase();
    const cargo = (p.display?.jobTitle || "").toLowerCase();
    return nombre.includes(filtro) || cargo.includes(filtro);
  });

  lista.replaceChildren();

  if (!visibles.length) {
    lista.appendChild(el("div", "ad-empty", "Nadie coincide con esa búsqueda."));
    return;
  }

  visibles.forEach(p => {
    const email = p._email || p.identity?.emails?.[0] || "";
    const fila = el("button", "rh-person-row");
    fila.type = "button";
    fila.dataset.email = email;
    if (email === seleccionada) fila.classList.add("active");

    const foto = document.createElement("img");
    foto.className = "rh-person-photo";
    foto.alt = "";
    foto.src = p.identity?.photo || "images/heroe.png";
    foto.loading = "lazy";

    const cuerpo = el("div", "rh-person-info");
    cuerpo.appendChild(el("div", "rh-person-name", p.identity?.name || email));
    cuerpo.appendChild(el("div", "rh-person-job", p.display?.jobTitle || "—"));

    fila.append(foto, cuerpo);
    fila.addEventListener("click", () => seleccionar(email));
    lista.appendChild(fila);
  });
}

async function seleccionar(email) {
  if (email === seleccionada) return;
  // Cambiar de persona reconstruye la ficha entera: si hay una edición
  // abierta, lo tecleado se perdería sin aviso.
  if (editando && !(await confirmarDescarte())) return;
  seleccionada = email;
  editando = false;
  pintarLista();
  pintarFicha();
}

// Un solo punto para preguntar antes de tirar una edición a medias. Devuelve
// true si se puede continuar.
function confirmarDescarte() {
  if (typeof window.heroConfirm !== "function") return Promise.resolve(true);
  return window.heroConfirm({
    title: "Descartar cambios",
    message: "Estás editando los datos laborales y no los guardaste. Si continúas se pierden.",
    confirmLabel: "Descartar",
    cancelLabel: "Seguir editando",
    variant: "warning",
  });
}

// ── Ficha ──────────────────────────────────────────────────────────
function pintarFicha() {
  const vacio = $("rh-card-empty");
  const cuerpo = $("rh-card-body");
  if (!cuerpo) return;

  destruirPickers();

  const p = personas.find(x => (x._email || "") === seleccionada);
  if (!p) {
    vacio.hidden = false;
    cuerpo.hidden = true;
    return;
  }
  vacio.hidden = true;
  cuerpo.hidden = false;
  cuerpo.replaceChildren();

  cuerpo.appendChild(cabecera(p));
  cuerpo.appendChild(editando ? formulario(p) : datosLaborales(p));
  cuerpo.appendChild(reportesDe(p));

  if (window.refreshIcons) window.refreshIcons();
}

function cabecera(p) {
  const head = el("div", "rh-card-head");

  const foto = document.createElement("img");
  foto.className = "rh-card-photo";
  foto.alt = "";
  foto.src = p.identity?.photo || "images/heroe.png";

  const info = el("div", "rh-card-id");
  info.appendChild(el("h2", "rh-card-name", p.identity?.name || p._email));
  info.appendChild(el("div", "rh-card-job", p.display?.jobTitle || "Sin cargo asignado"));

  // La cabecera muestra DÓNDE ESTÁ la persona, que es lo que RRHH necesita de
  // un vistazo. La bandera acompaña a ese país, no al de origen: juntar la
  // ciudad de residencia con la bandera de la nacionalidad daba un lugar que
  // no existe (Madrid + bandera de Cuba). El origen se lee más abajo.
  const hrCab = hrDe(p._email);
  const ciudad = hrCab.city || "";
  const iso = (hrCab.country || p.identity?.country || "").toUpperCase();
  const lugar = el("div", "rh-card-place");
  if (iso) {
    const bandera = document.createElement("img");
    bandera.className = "rh-card-flag";
    bandera.src = countryFlagUrl(iso);
    bandera.alt = countryLabel(iso) || iso;
    lugar.appendChild(bandera);
  }
  const textoLugar = [ciudad, countryLabel(iso)].filter(Boolean).join(", ");
  lugar.appendChild(el("span", null, textoLugar || "Ubicación sin registrar"));

  const hora = horaEn(hrCab.timezone);
  if (hora) lugar.appendChild(el("span", "rh-card-hora", `· ${hora} allá`));

  info.appendChild(lugar);

  const acciones = el("div", "rh-card-actions");
  const btn = el("button", "rh-btn", editando ? "Cancelar" : "Editar datos laborales");
  btn.type = "button";
  btn.addEventListener("click", () => { editando = !editando; pintarFicha(); });
  acciones.appendChild(btn);

  head.append(foto, info, acciones);
  return head;
}

function datosLaborales(p) {
  const caja = el("div", "rh-datos");

  const hr = hrDe(p._email);

  // Origen explícito: la cabecera ya no lo dice, ahora muestra dónde vive.
  const origen = p.identity?.country || "";
  const vive = hr.country || "";
  caja.appendChild(dato("País de origen", countryLabel(origen)
    + (origen && vive && origen.toUpperCase() !== vive.toUpperCase() ? " · vive fuera" : "")));

  const tzTexto = hr.timezone
    ? `${tzEtiqueta(hr.timezone)}${horaEn(hr.timezone) ? " · ahora " + horaEn(hr.timezone) : ""}`
    : "";
  caja.appendChild(dato("Zona horaria", tzTexto));

  caja.appendChild(dato("Horario asignado", horarioTexto(hr.schedule)));

  const inicio = hr.startDate;
  const anos = antiguedad(inicio);
  caja.appendChild(dato("En Hero desde", inicio ? `${inicio}${anos ? " · " + anos : ""}` : ""));

  // Con año registrado se muestra la fecha completa y la edad — es ficha de
  // RRHH, no el directorio. Sin año, solo el día y el mes que ya publica el Hub.
  const edad = edadDe(hr.birthDate);
  caja.appendChild(dato("Nacimiento", hr.birthDate
    ? `${hr.birthDate}${edad != null ? ` · ${edad} años` : ""}`
    : cumpleTexto(p.identity?.birthdate)));

  const tels = Array.isArray(p.identity?.phones) ? p.identity.phones.filter(Boolean) : [];
  caja.appendChild(dato("Teléfono", tels.join(" · ")));

  caja.appendChild(dato("Correo corporativo", p._email));
  caja.appendChild(dato("Correo personal", p.identity?.personalEmail));

  // La direccion ocupa la fila completa: no entra en una columna.
  const dir = dato("Dirección", hr.address);
  dir.classList.add("rh-dato-ancho");
  caja.appendChild(dir);

  caja.appendChild(documentos(p));

  return caja;
}

// Carpeta de Drive con los documentos de la persona. Se guarda el enlace y
// no los archivos: así los permisos, el versionado y la papelera los maneja
// Google Workspace, que ya se paga, en vez de un bucket sin política de
// retención para contratos e identificaciones.
function documentos(p) {
  const fila = el("div", "rh-dato rh-dato-ancho");
  fila.appendChild(el("div", "rh-dato-label", "Documentos"));

  const url = hrDe(p._email).docsUrl || "";
  if (!url) {
    const v = el("div", "rh-dato-value vacio", "— sin carpeta enlazada —");
    fila.appendChild(v);
    return fila;
  }

  const link = document.createElement("a");
  link.className = "rh-docs-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  const ico = document.createElement("i");
  ico.setAttribute("data-lucide", "folder-open");
  link.append(ico, el("span", null, "Abrir carpeta de documentos"));
  fila.appendChild(link);
  return fila;
}

// ── Formulario de edición ──────────────────────────────────────────
function formulario(p) {
  const form = el("div", "rh-form");
  const hr = hrDe(p._email);
  const sch = hr.schedule || {};

  const campo = (etiqueta, input) => {
    const wrap = el("div", "rh-field");
    wrap.appendChild(el("label", "rh-label", etiqueta));
    wrap.appendChild(input);
    return wrap;
  };

  const ciudad = document.createElement("input");
  ciudad.type = "text";
  ciudad.className = "rh-input";
  ciudad.id = "rhf-city";
  ciudad.placeholder = "Ej: Caracas";
  ciudad.value = hr.city || "";

  const inicio = document.createElement("input");
  inicio.type = "text";
  inicio.className = "rh-input";
  inicio.id = "rhf-start";
  inicio.placeholder = "MM/DD/YYYY";
  inicio.autocomplete = "off";
  inicio.value = hr.startDate || "";

  const desde = document.createElement("input");
  desde.type = "time";
  desde.className = "rh-input";
  desde.id = "rhf-from";
  desde.value = sch.from || "";

  const hasta = document.createElement("input");
  hasta.type = "time";
  hasta.className = "rh-input";
  hasta.id = "rhf-to";
  hasta.value = sch.to || "";

  // Dónde vive hoy. Va en hr-data, no en users/: identity.country es de dónde
  // ES la persona (bandera pública) y para quien vive fuera de su país no es
  // lo mismo. El que manda para huso y ley laboral es este.
  const paisVive = document.createElement("select");
  paisVive.className = "rh-input";
  paisVive.id = "rhf-lives";
  paisVive.appendChild(new Option("— Sin registrar —", ""));
  const catalogoPaises = countryOptions();
  catalogoPaises.forEach(c => paisVive.appendChild(new Option(c.label, c.iso)));
  const viveActual = (hr.country || "").toUpperCase();
  if (viveActual && !catalogoPaises.some(c => c.iso === viveActual)) {
    paisVive.appendChild(new Option(countryLabel(viveActual), viveActual));
  }
  paisVive.value = viveActual;

  const husos = document.createElement("select");
  husos.className = "rh-input";
  husos.id = "rhf-tz";
  husos.appendChild(new Option("— Sin registrar —", ""));
  const listaTz = [...new Set(Object.values(TZ_POR_PAIS))]
    .map(tz => ({ tz, label: tzEtiqueta(tz) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  listaTz.forEach(t => husos.appendChild(new Option(t.label, t.tz)));
  if (hr.timezone && !listaTz.some(t => t.tz === hr.timezone)) {
    husos.appendChild(new Option(tzEtiqueta(hr.timezone), hr.timezone));
  }
  husos.value = hr.timezone || "";

  // Elegir país rellena el huso solo si está vacío: si RRHH ya puso uno a
  // mano (un país con varios husos), no se le pisa.
  paisVive.addEventListener("change", () => {
    const sugerido = TZ_POR_PAIS[paisVive.value];
    if (sugerido && !husos.value) husos.value = sugerido;
  });

  const fila1 = el("div", "rh-form-row");
  fila1.append(campo("Ciudad", ciudad), campo("País donde vive", paisVive));

  const filaTz = el("div", "rh-form-row");
  const campoTz = campo("Zona horaria", husos);
  campoTz.appendChild(el("div", "rh-hint",
    "Para leer la hora de sus reportes de retraso y ausencia."));
  filaTz.append(campoTz, campo("En Hero desde", inicio));

  const fila2 = el("div", "rh-form-row");
  fila2.append(campo("Entrada", desde), campo("Salida", hasta));

  const direccion = document.createElement("textarea");
  direccion.className = "rh-input rh-textarea";
  direccion.id = "rhf-address";
  direccion.rows = 2;
  direccion.maxLength = 240;
  direccion.placeholder = "Calle, edificio, apartamento, sector, código postal…";
  direccion.value = hr.address || "";

  const docs = document.createElement("input");
  docs.type = "url";
  docs.className = "rh-input";
  docs.id = "rhf-docs";
  docs.placeholder = "https://drive.google.com/drive/folders/…";
  docs.value = hr.docsUrl || "";

  // Días: chips que se marcan. Por defecto, lunes a viernes.
  const diasActuales = Array.isArray(sch.days) ? sch.days : [1, 2, 3, 4, 5];
  const chips = el("div", "rh-days");
  DIAS.forEach(d => {
    const chip = el("button", "rh-day", d.corto);
    chip.type = "button";
    chip.dataset.day = String(d.n);
    chip.title = d.largo;
    if (diasActuales.includes(d.n)) chip.classList.add("on");
    chip.addEventListener("click", () => chip.classList.toggle("on"));
    chips.appendChild(chip);
  });

  // ── Datos personales (users/, no hr-data) ────────────────────────
  // Van en su propio bloque a propósito: se guardan en otra colección y con
  // otra regla. El correo corporativo y los aliases de login NO están acá —
  // eso es la cuenta, y se gestiona en admin → Usuarios.
  // Fecha completa: RRHH necesita el año para control de expediente, el Hub
  // solo mes y día para el widget. Se captura una vez y se reparte —
  // hr-data.birthDate guarda MM/DD/YYYY, identity.birthdate el MM-DD derivado.
  const nacimiento = document.createElement("input");
  nacimiento.type = "text";
  nacimiento.className = "rh-input";
  nacimiento.id = "rhf-birth";
  nacimiento.placeholder = "MM/DD/YYYY";
  nacimiento.autocomplete = "off";
  nacimiento.value = hr.birthDate || "";

  const campoCumple = campo("Fecha de nacimiento", nacimiento);
  const edadActual = edadDe(hr.birthDate);
  campoCumple.appendChild(el("div", "rh-hint", edadActual
    ? `${edadActual} años. El Hub solo publica el día y el mes; el año queda en la ficha de RRHH.`
    : "El Hub solo publica el día y el mes; el año queda en la ficha de RRHH."));

  // Caso de las fichas viejas: el cumpleaños existe en users/ como MM-DD pero
  // nadie registró el año. Se avisa para que no parezca que el dato se perdió,
  // y al guardar en blanco no se pisa (ver guardarFicha).
  const soloMMDD = !hr.birthDate && p.identity?.birthdate;
  if (soloMMDD) {
    campoCumple.appendChild(el("div", "rh-hint",
      `Registrado sin año: ${cumpleTexto(p.identity.birthdate)}. Al guardar una fecha completa se reemplaza; si lo dejas vacío se conserva como está.`));
  }

  // País: <select> del catálogo, no el input libre del modal de admin. Ahí,
  // escribir "Vzla" hace que nameToIso devuelva null y el país se pierda sin
  // aviso; acá no hay forma de teclear algo que no exista.
  const isoActual = (p.identity?.country || "").toUpperCase();
  const pais = document.createElement("select");
  pais.className = "rh-input";
  pais.id = "rhf-country";
  pais.appendChild(new Option("— Sin registrar —", ""));
  const catalogo = countryOptions();
  catalogo.forEach(c => pais.appendChild(new Option(c.label, c.iso)));
  // Un ISO viejo fuera del catálogo se conserva como opción propia en vez de
  // perderse al guardar.
  if (isoActual && !catalogo.some(c => c.iso === isoActual)) {
    pais.appendChild(new Option(countryLabel(isoActual), isoActual));
  }
  pais.value = isoActual;

  const campoPais = campo("País de origen", pais);
  campoPais.appendChild(el("div", "rh-hint",
    "Es público: sale como bandera en Equipo y en el directorio. La ciudad, no."));

  const filaOrigen = el("div", "rh-form-row");
  filaOrigen.append(campoCumple, campoPais);

  const personal = document.createElement("input");
  personal.type = "email";
  personal.className = "rh-input";
  personal.id = "rhf-personal";
  personal.placeholder = "nombre@gmail.com";
  personal.value = p.identity?.personalEmail || "";
  const campoPersonal = campo("Correo personal", personal);
  campoPersonal.appendChild(el("div", "rh-hint",
    "Se usa para avisarle si pierde el acceso a la cuenta corporativa."));

  const telsWrap = el("div", "rh-phones");
  telsWrap.id = "rhf-phones";
  const telsActuales = Array.isArray(p.identity?.phones)
    ? p.identity.phones.filter(Boolean) : [];
  (telsActuales.length ? telsActuales : [""]).forEach(t => telsWrap.appendChild(filaTelefono(t)));

  const addTel = el("button", "rh-btn rh-btn-sm", "+ Añadir teléfono");
  addTel.type = "button";
  addTel.addEventListener("click", () => {
    telsWrap.appendChild(filaTelefono(""));
    if (window.refreshIcons) window.refreshIcons();
  });

  const campoTels = campo("Teléfonos", telsWrap);
  campoTels.appendChild(addTel);

  const cuenta = el("div", "rh-hint",
    "El correo corporativo y las direcciones con las que inicia sesión se gestionan en admin → Usuarios: cambiarlas afecta el acceso al Hub.");

  const guardar = el("button", "rh-btn rh-btn-primary", "Guardar");
  guardar.type = "button";
  guardar.addEventListener("click", () => guardarFicha(p, guardar));

  const cancelar = el("button", "rh-btn", "Cancelar");
  cancelar.type = "button";
  cancelar.addEventListener("click", () => { editando = false; pintarFicha(); });

  const acciones = el("div", "rh-form-actions");
  acciones.append(cancelar, guardar);

  const ayudaDocs = el("div", "rh-hint",
    "Enlace a la carpeta de Drive con sus contratos y documentos. Los archivos no se suben al Hub: los permisos los controla Workspace.");
  const campoDocs = campo("Carpeta de documentos", docs);
  campoDocs.appendChild(ayudaDocs);

  form.append(
    subtitulo("Relación laboral"),
    fila1,
    filaTz,
    fila2,
    campo("Días de trabajo", chips),
    campo("Dirección completa", direccion),
    campoDocs,
    subtitulo("Datos personales"),
    filaOrigen,
    campoPersonal,
    campoTels,
    cuenta,
    acciones
  );

  // Flatpickr sobre las dos fechas, con el mismo formato US del Hub.
  if (typeof flatpickr === "function") {
    pickers.push(flatpickr(inicio, { locale: "es", dateFormat: "m/d/Y", allowInput: true }));
    // maxDate corta el futuro. El año de Flatpickr es un input editable: se
    // teclea 1985 en vez de recorrer meses con la flecha.
    pickers.push(flatpickr(nacimiento, {
      locale: "es", dateFormat: "m/d/Y", allowInput: true,
      maxDate: "today", defaultDate: hr.birthDate || null,
    }));
  }

  return form;
}

async function guardarFicha(p, btn) {
  const ciudad = ($("rhf-city").value || "").trim();
  const inicio = ($("rhf-start").value || "").trim();
  const from = $("rhf-from").value || "";
  const to = $("rhf-to").value || "";
  const days = Array.from(document.querySelectorAll(".rh-day.on")).map(c => Number(c.dataset.day));
  const direccion = ($("rhf-address").value || "").trim();
  const docsUrl = ($("rhf-docs").value || "").trim();
  const paisVive = $("rhf-lives").value || "";
  const timezone = $("rhf-tz").value || "";

  // Datos personales. La fecha de nacimiento se parte: completa a hr-data,
  // MM-DD a users/ para el widget.
  const nacimiento = ($("rhf-birth").value || "").trim();
  const country = $("rhf-country").value || "";
  const personalEmail = ($("rhf-personal").value || "").trim().toLowerCase();
  const phones = Array.from($("rhf-phones").querySelectorAll("input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  if (docsUrl && !/^https:\/\//i.test(docsUrl)) {
    heroToast.error("El enlace de la carpeta tiene que empezar por https://");
    return;
  }
  if (inicio && !parseUS(inicio)) {
    heroToast.error("La fecha de ingreso va en formato MM/DD/YYYY.");
    return;
  }
  if ((from && !to) || (!from && to)) {
    heroToast.error("El horario necesita hora de entrada y de salida.");
    return;
  }
  if (nacimiento && !parseUS(nacimiento)) {
    heroToast.error("La fecha de nacimiento va en formato MM/DD/YYYY.");
    return;
  }
  // parseUS acepta 02/31: el Date rueda a marzo y quedaría un cumpleaños en
  // un día que la persona no cumple. Se compara contra lo tecleado.
  if (nacimiento) {
    const [mm, dd] = nacimiento.split("/").map(Number);
    if (dd > diasDelMes(mm) || mm < 1 || mm > 12) {
      heroToast.error("Esa fecha de nacimiento no existe.");
      return;
    }
    const edad = edadDe(nacimiento);
    if (edad === null || edad < 14) {
      heroToast.error("Revisa el año de nacimiento: la edad no es plausible.");
      return;
    }
  }
  if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
    heroToast.error("El correo personal no tiene un formato válido.");
    return;
  }
  if (personalEmail.endsWith(HERO_DOMAIN)) {
    heroToast.error("El correo personal no puede ser del dominio corporativo.");
    return;
  }

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    const ficha = {
      city: ciudad || null,
      address: direccion || null,
      startDate: inicio || null,
      // Sin horas pero con días marcados se guardan los días igual: antes el
      // ternario los tiraba enteros y desmarcar el sábado no servía de nada
      // mientras no hubiera horario.
      schedule: (from && to)
        ? { from, to, days }
        : (days.length ? { from: null, to: null, days } : null),
      docsUrl: docsUrl || null,
      birthDate: nacimiento || null,
      country: paisVive || null,
      timezone: timezone || null,
    };
    await saveHrData(p._email, ficha);

    // Se actualiza la copia en memoria para no releer toda la colección.
    hrData.set(p._email, ficha);

    // Segunda escritura, a users/. Va después y por separado porque es otra
    // colección con otra regla: si esta falla, la ficha laboral ya quedó
    // guardada y el mensaje tiene que decir exactamente qué se perdió.
    // Dejar la fecha en blanco NO borra el cumpleaños: las fichas viejas
    // tienen MM-DD en users/ sin año en hr-data, y guardar cualquier otro
    // campo se llevaría por delante el widget de cumpleaños de esa persona.
    const patchUser = {
      "identity.personalEmail": personalEmail || null,
      "identity.phones": phones,
      "identity.country": country || null,
    };
    if (nacimiento) patchUser["identity.birthdate"] = aMMDD(nacimiento);

    try {
      await updateUserFields(p._email, patchUser);
      // Copia en memoria, igual que con hrData.
      p.identity = p.identity || {};
      if (nacimiento) p.identity.birthdate = aMMDD(nacimiento);
      p.identity.personalEmail = personalEmail || null;
      p.identity.phones = phones;
      p.identity.country = country || null;
    } catch (e) {
      console.error("rrhh-personas (users):", e);
      editando = false;
      pintarFicha();
      heroToast.error("Se guardaron los datos laborales, pero no los personales.");
      return;
    }

    editando = false;
    pintarFicha();
    heroToast.success("Datos actualizados");
  } catch (e) {
    console.error("rrhh-personas:", e);
    heroToast.error("No se pudieron guardar los datos.");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ── Reportes de la persona ─────────────────────────────────────────
function reportesDe(p) {
  const caja = el("div", "rh-card-reports");

  const titulo = el("div", "section-label");
  titulo.appendChild(el("span", "kicker-dot"));
  titulo.appendChild(el("span", null, `Sus reportes · ${getEtiquetaRango()}`));
  caja.appendChild(titulo);

  // Un reporte se guarda con el correo con el que se envió, que puede ser un
  // alias de identity.emails[] y no el docId. Comparar solo contra p._email
  // dejaba esos reportes fuera de la ficha. Se normaliza de paso: reports
  // guarda el email tal cual llegó, sin pasarlo a minúsculas.
  const alias = new Set(
    [p._email, ...(Array.isArray(p.identity?.emails) ? p.identity.emails : [])]
      .filter(Boolean)
      .map(e => String(e).toLowerCase().trim())
  );
  const suyos = getItemsEnRango().filter(it => alias.has(String(it.email || "").toLowerCase().trim()));

  const resumen = el("div", "rh-mini-kpis");
  Object.entries(TIPO_ICONO).forEach(([tipo, icono]) => {
    const n = suyos.filter(it => it.tipo === tipo).length;
    const kpi = el("div", "rh-mini-kpi");
    if (!n) kpi.classList.add("cero");
    kpi.appendChild(el("i", `ph-fill ${icono} rh-mini-emoji`));
    kpi.appendChild(el("span", "rh-mini-n", String(n)));
    resumen.appendChild(kpi);
  });
  caja.appendChild(resumen);

  if (!suyos.length) {
    caja.appendChild(el("div", "ad-empty", "— Sin reportes en este periodo —"));
    return caja;
  }

  const lista = el("div", "rh-mini-list");
  suyos.slice(0, 20).forEach(it => {
    const fila = el("div", "rh-mini-row");
    fila.appendChild(el("i", `ph-fill ${TIPO_ICONO[it.tipo] || "ph-clipboard-text"} rh-mini-row-emoji`));
    fila.appendChild(el("span", "rh-mini-row-label", it.label));
    fila.appendChild(el("span", "rh-mini-row-detail", it.detalle || "—"));
    const cuando = it.cuando
      ? `${String(it.cuando.getMonth() + 1).padStart(2, "0")}/${String(it.cuando.getDate()).padStart(2, "0")}`
      : "—";
    fila.appendChild(el("span", "rh-mini-row-date", cuando));
    lista.appendChild(fila);
  });
  caja.appendChild(lista);

  return caja;
}

// ── Switch de vistas ───────────────────────────────────────────────
/**
 * Cada filtro de la toolbar declara en data-vista dónde sirve, y se esconde
 * donde no. El de periodo vale en general y en personas — la ficha lee ese
 * mismo rango para "Sus reportes" —; el de tipo solo en la general, porque la
 * ficha recorre los cuatro tipos siempre. En el calendario no sirve ninguno:
 * el mes manda.
 *
 * El rango personalizado, además, solo aparece si el periodo lo pide.
 */
function aplicarFiltrosDeVista(vista) {
  document.querySelectorAll("[data-vista]").forEach(nodo => {
    const sirve = nodo.dataset.vista.split(" ").includes(vista);
    if (nodo.id === "rh-range") {
      const custom = $("rh-period")?.value === "custom";
      nodo.hidden = !sirve || !custom;
      return;
    }
    nodo.hidden = !sirve;
  });
}

function bindVistas() {
  const botones = document.querySelectorAll(".rh-view-btn");
  if (!botones.length) return;

  botones.forEach(btn => {
    btn.addEventListener("click", () => {
      const vista = btn.dataset.view;
      botones.forEach(b => {
        const activo = b === btn;
        b.classList.toggle("active", activo);
        b.setAttribute("aria-selected", String(activo));
      });
      // La vista general la maneja el dashboard: tiene tres bloques
      // (cargando / error / contenido) y solo él sabe cuál toca. Tocar
      // #rh-content a mano desde aquí mostraba el contenedor vacío cuando la
      // carga había fallado.
      aplicarVistaGeneral(vista === "general");
      const personas_ = $("rh-personas");
      if (personas_) personas_.hidden = vista !== "personas";
      // El historial de asistencia pertenece a la vista general.
      const hist = $("rh-history");
      if (hist) hist.hidden = vista !== "general";
      const cal = $("rh-calendario");
      if (cal) cal.hidden = vista !== "calendario";
      aplicarFiltrosDeVista(vista);

      if (vista === "personas" && !personas.length) cargarPersonas();
      if (vista === "calendario") abrirCalendario();
      if (window.refreshIcons) window.refreshIcons();
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────
function init() {
  if (!$("rh-people-list")) return;

  bindVistas();
  initCalendario();

  const filtro = $("rh-people-filter");
  if (filtro) filtro.addEventListener("input", pintarLista);

  // "Por persona" es la vista de entrada del módulo: RRHH abre para mirar a
  // alguien, no para mirar el agregado. El HTML ya la marca activa, así que
  // aquí solo hay que traer el equipo — bindVistas() solo lo hace al pulsar
  // la pestaña, y nadie la va a pulsar si ya está puesta.
  const activo = document.querySelector(".rh-view-btn.active");
  aplicarFiltrosDeVista(activo?.dataset.view || "personas");
  if (!activo || activo.dataset.view === "personas") cargarPersonas();

  // Cuando cambia el rango de fechas arriba, la ficha abierta se repinta.
  // Mientras se edita NO: pintarFicha() reconstruye el formulario desde
  // Firestore y los selects de periodo viven en la toolbar siempre visible,
  // así que tocarlos borraba lo que se estuviera escribiendo. Al guardar o
  // cancelar se repinta igual y los reportes quedan al día.
  onDatosActualizados(() => { if (seleccionada && !editando) pintarFicha(); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
