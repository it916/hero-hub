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
import { getAllHrData, saveHrData, leerHorario } from "./hr-store.js";
import { abrirCalendario, initCalendario } from "./rrhh-calendario.js";
import {
  CRITERIOS, ESCALA, getEvaluacionesPorPersona, saveEvaluacion,
  estadoDe, periodoDe, periodoTexto, promedioDe, MESES_ENTRE_EVALUACIONES,
} from "./hr-evaluaciones.js";
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

// ── ¿Está trabajando ahora? ────────────────────────────────────────
// El día y la hora se calculan EN LA ZONA DE LA PERSONA, no con el reloj del
// navegador: a las 11 PM de un martes en Miami, en Madrid ya es miércoles y
// la ficha enseñaría el horario del día equivocado.

const NOMBRE_DIA_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function diaEnZona(tz) {
  if (tz) {
    try {
      const corto = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
        .format(new Date());
      const n = NOMBRE_DIA_EN.indexOf(corto);
      if (n >= 0) return n;
    } catch { /* huso inválido: cae al reloj de quien mira */ }
  }
  return new Date().getDay();
}

// Minutos desde medianoche allá. hourCycle:"h23" y no hour12:false — con este
// último algunos entornos devuelven "24" a medianoche en vez de "00".
function minutosEnZona(tz) {
  if (tz) {
    try {
      const partes = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const h = Number(partes.find(x => x.type === "hour")?.value);
      const m = Number(partes.find(x => x.type === "minute")?.value);
      if (Number.isInteger(h) && Number.isInteger(m)) return (h % 24) * 60 + m;
    } catch { /* idem */ }
  }
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Devuelve null para todo lo que no sea una hora de verdad. Antes partía la
// cadena y confiaba en Number(), pero Number("") es 0: un día marcado sin
// horas —que se guarda como {from:null,to:null} a propósito— pasaba por las
// 00:00 y la ficha lo daba por "En horario · hasta las " (sin hora).
const aMinutos = hm => {
  const t = String(hm ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t) return null;
  const h = Number(t[1]), min = Number(t[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
};

// Primer día con jornada a partir de mañana, para poder decir cuándo vuelve.
function proximoDia(porDia, desde) {
  for (let i = 1; i <= 7; i++) {
    const n = (desde + i) % 7;
    if (porDia[n]) return { n, ...porDia[n] };
  }
  return null;
}

/**
 * Dónde está la persona en este momento:
 *
 *   { clase:"dentro"|"fuera"|"suelto", titulo, detalle }
 *
 * Devuelve null si falta el horario o el huso. Con uno de los dos sin
 * registrar la pregunta no se puede responder, y resolverla con el reloj de
 * quien mira la ficha sería mentir sin avisar.
 */
function estadoAhora(hr) {
  const h = leerHorario(hr.schedule);
  if (!h || !hr.timezone) return null;

  const hoy = diaEnZona(hr.timezone);
  const ahora = minutosEnZona(hr.timezone);
  const turno = h.porDia[hoy];

  // Un turno que cruzó la medianoche sigue corriendo en la madrugada del día
  // siguiente: a las 2 AM del miércoles, quien entró el martes a las 21:00
  // para salir a las 05:00 está trabajando, y porDia[miércoles] no sabe nada
  // de eso. Se mira el día anterior antes que el de hoy.
  const anoche = h.porDia[(hoy + 6) % 7];
  const entroAnoche = aMinutos(anoche?.from);
  const saleHoy = aMinutos(anoche?.to);
  if (entroAnoche != null && saleHoy != null && saleHoy <= entroAnoche && ahora < saleHoy) {
    return { clase: "dentro", titulo: "En horario", detalle: `hasta las ${hm12(anoche.to)}` };
  }

  const sig = proximoDia(h.porDia, hoy);
  const vuelve = sig
    ? `vuelve el ${DIAS.find(d => d.n === sig.n)?.largo || "?"}`
      + (sig.from ? ` a las ${hm12(sig.from)}` : "")
    : "sin más días asignados";

  if (!turno) return { clase: "fuera", titulo: "Hoy no trabaja", detalle: vuelve };

  const entra = aMinutos(turno.from);
  const sale = aMinutos(turno.to);
  // Día marcado sin horas: se sabe que trabaja, no desde cuándo.
  if (entra == null || sale == null) {
    return { clase: "suelto", titulo: "Trabaja hoy", detalle: "sin horario fijo" };
  }

  // Si el turno de hoy cruza la medianoche (entra 21:00, sale 05:00), estar
  // dentro es solo haber entrado ya: el tramo de madrugada pertenece al
  // turno de ayer y lo resuelve la comprobación de arriba.
  const dentro = sale > entra
    ? ahora >= entra && ahora < sale
    : ahora >= entra;

  if (dentro) return { clase: "dentro", titulo: "En horario", detalle: `hasta las ${hm12(turno.to)}` };
  if (ahora < entra) return { clase: "fuera", titulo: "Aún no entra", detalle: `entra a las ${hm12(turno.from)}` };
  return { clase: "fuera", titulo: "Jornada terminada", detalle: vuelve };
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
let evaluaciones = new Map();   // email -> [evaluacion, ...] de la mas nueva a la mas vieja
let evaluando = null;           // { email, id } mientras el formulario esta abierto

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
  const h = leerHorario(schedule);
  if (!h) return "";

  const { porDia, dias, uniforme } = h;
  const nombreDe = n => DIAS.find(d => d.n === n)?.largo || "?";
  const cortoDe = n => (DIAS.find(d => d.n === n)?.largo || "?").slice(0, 3);

  // Lunes a viernes es el caso normal: se dice así en vez de listar cinco.
  const esLaV = dias.length === 5 && [1, 2, 3, 4, 5].every(n => dias.includes(n));
  const cuando = esLaV ? "lunes a viernes" : dias.map(nombreDe).join(", ");

  // Los días de trabajo se guardan aunque no haya hora de entrada y salida:
  // son un dato por derecho propio, no un adorno del horario. Sin ellos la
  // ficha se quedaba sin decir qué días trabaja la persona.
  const conHoras = dias.filter(n => porDia[n].from && porDia[n].to);
  if (!conHoras.length) return `${cuando} · sin horario fijo`;

  // Mismo rango todos los días: una frase. Distinto según el día: una entrada
  // por día, que es justamente el caso que el formato viejo no sabía guardar.
  if (uniforme) {
    const { from, to } = porDia[dias[0]];
    return `${hm12(from)} – ${hm12(to)} · ${cuando}`;
  }

  return dias.map(n => {
    const { from, to } = porDia[n];
    return from && to
      ? `${cortoDe(n)} ${hm12(from)}–${hm12(to)}`
      : `${cortoDe(n)} sin horario`;
  }).join(" · ");
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
    const [users, hr, evs] = await Promise.all([
      getAllUsers(), getAllHrData(), getEvaluacionesPorPersona().catch(e => {
        // Si la regla de hr-evaluations aun no esta desplegada, el resto de la
        // ficha tiene que seguir funcionando.
        console.warn("rrhh: no se pudieron leer las evaluaciones:", e.message);
        return new Map();
      }),
    ]);
    evaluaciones = evs;
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

    // Punto ámbar a quien le toca evaluación. Va en la lista y no solo en la
    // ficha para que se vea a quién hay que llamar sin abrir uno por uno.
    fila.append(foto, cuerpo);

    const { estado } = estadoDe(evaluaciones.get(email));
    if (estado !== "al-dia") {
      const marca = el("span", "rh-person-due");
      marca.title = estado === "nunca"
        ? "Sin evaluaciones registradas"
        : "Le toca evaluación trimestral";
      fila.appendChild(marca);
    }

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
  // Los destacados solo en lectura: mientras se edita, el horario que se está
  // tecleando todavía no es el guardado y los tiles dirían otra cosa.
  if (!editando) {
    cuerpo.appendChild(destacados(p));
    const semana = resumenSemana(hrDe(p._email));
    if (semana) cuerpo.appendChild(semana);
  }
  cuerpo.appendChild(editando ? formulario(p) : datosLaborales(p));
  cuerpo.appendChild(evaluacionesDe(p));
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

// ── Destacados ─────────────────────────────────────────────────────
// Tres cosas y no diez. El criterio no es "qué parece importante" sino qué
// cambia solo y qué se consulta seguido: el horario se mira cada vez que
// alguien quiere saber si puede escribirle a esa persona; la dirección, una
// vez en la vida. El resto sigue abajo, en la grilla de etiqueta y valor.
//
// Sin cuenta regresiva a propósito. Un "sale en 4h 18m" obliga a un
// setInterval que hay que limpiar al cambiar de persona —la misma fuga que
// dejaron los Flatpickr— y sin refrescarlo la ficha miente a los diez
// minutos. Lo que hace falta saber es binario: si se le puede escribir ahora.
// Eso lo dice el estado más la hora de corte, que no envejece en una sesión.
function destacados(p) {
  const hr = hrDe(p._email);
  const caja = el("div", "rh-destacados");
  caja.append(tileAhora(hr), tileHoy(hr), tileHero(hr));
  return caja;
}

function tile(etiqueta, clase) {
  const t = el("div", "rh-tile" + (clase ? " " + clase : ""));
  t.appendChild(el("div", "rh-tile-label", etiqueta));
  return t;
}

// El hueco se arregla desde donde se ve: el aviso ES el botón que abre el
// formulario, en vez de mandar a buscar "Editar datos laborales" arriba.
// Hoy dieciséis de las diecisiete fichas están vacías, así que este es el
// estado que más se va a ver.
function tileVacio(etiqueta, texto) {
  const t = tile(etiqueta, "vacio");
  const btn = el("button", "rh-tile-fix", texto);
  btn.type = "button";
  btn.addEventListener("click", () => { editando = true; pintarFicha(); });
  t.appendChild(btn);
  return t;
}

function tileAhora(hr) {
  const est = estadoAhora(hr);
  if (!est) {
    return leerHorario(hr.schedule)
      ? tileVacio("Ahora", "Registrar zona horaria")
      : tileVacio("Ahora", "Registrar horario");
  }

  const t = tile("Ahora", est.clase);
  const valor = el("div", "rh-tile-value");
  valor.appendChild(el("span", "rh-tile-dot"));
  // El texto va envuelto en su span y no suelto: dentro de un flex con gap el
  // texto pelado se separa por palabras ([[feedback_flex_gap_texto_suelto]]).
  valor.appendChild(el("span", null, est.titulo));
  t.append(valor, el("div", "rh-tile-sub", est.detalle));
  return t;
}

function tileHoy(hr) {
  const h = leerHorario(hr.schedule);
  if (!h) return tileVacio("Hoy", "Registrar horario");

  const n = diaEnZona(hr.timezone);
  const nombre = DIAS.find(d => d.n === n)?.largo || "";
  const turno = h.porDia[n];

  const t = tile("Hoy");
  if (!turno) {
    t.append(el("div", "rh-tile-value rh-tile-libre", "Libre"),
             el("div", "rh-tile-sub", nombre));
    return t;
  }
  t.append(
    el("div", "rh-tile-value", turno.from && turno.to
      ? `${hm12(turno.from)} – ${hm12(turno.to)}`
      : "Sin horario fijo"),
    el("div", "rh-tile-sub", nombre));
  return t;
}

function tileHero(hr) {
  if (!hr.startDate) return tileVacio("En Hero", "Registrar fecha de ingreso");
  const t = tile("En Hero");
  t.append(el("div", "rh-tile-value", antiguedad(hr.startDate) || "—"),
           el("div", "rh-tile-sub", `desde ${hr.startDate}`));
  return t;
}

// Debajo de los tiles, la semana entera. Una frase cuando todos los días son
// iguales y la rejilla de siete solo cuando hay algo que comparar: siete
// celdas repitiendo el mismo rango cinco veces no informan de nada, y la
// frase "10:00 AM – 6:00 PM · lunes a viernes" se lee mejor.
function resumenSemana(hr) {
  const h = leerHorario(hr.schedule);
  if (!h) return null;

  const sinHoras = !h.dias.some(n => h.porDia[n].from);
  if (h.uniforme || sinHoras) {
    return el("div", "rh-semana-frase", horarioTexto(hr.schedule));
  }

  const hoy = diaEnZona(hr.timezone);
  const fila = el("div", "rh-semana");
  for (const d of DIAS) {
    const turno = h.porDia[d.n];
    const celda = el("div", "rh-semana-dia"
      + (turno ? "" : " off") + (d.n === hoy ? " hoy" : ""));
    celda.appendChild(el("span", "rh-semana-n", d.corto));
    if (turno?.from && turno?.to) {
      celda.append(el("span", "rh-semana-h", hm12(turno.from)),
                   el("span", "rh-semana-h", hm12(turno.to)));
      celda.title = `${d.largo}: ${hm12(turno.from)} – ${hm12(turno.to)}`;
    } else {
      celda.appendChild(el("span", "rh-semana-h", turno ? "s/h" : "—"));
      celda.title = turno ? `${d.largo}: sin horario fijo` : `${d.largo}: no trabaja`;
    }
    fila.appendChild(celda);
  }
  return fila;
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

  // El horario y la antigüedad ya no se repiten acá: subieron a los
  // destacados, arriba. Repetirlos treinta centímetros más abajo no destaca
  // nada, compite.

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

// ── Días y horario ─────────────────────────────────────────────────
// Antes había un solo par entrada/salida para toda la semana. No servía para
// quien trabaja de mañana unos días y de tarde otros: había que elegir cuál
// de los dos horarios era "el" horario y el otro no se registraba.
//
// No se hicieron dos modos ("fijo" y "por día"). Un horario igual todos los
// días es el caso particular del otro, y dos modos serían dos formas del dato,
// dos rutas de pintado y la pregunta de qué se tira al cambiar de uno a otro.
// Un botón que copia el primer horario al resto cubre lo mismo.

const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

function bloqueHorario(horario) {
  const bloque = el("div", "rh-field");
  bloque.appendChild(el("label", "rh-label", "Días y horario"));

  const chips = el("div", "rh-days");
  const filas = el("div", "rh-sched-rows");
  filas.id = "rhf-sched";

  const porDia = horario?.porDia || {};
  // Sin nada registrado, lunes a viernes: es lo que tiene casi todo el mundo.
  const activos = horario?.dias || [1, 2, 3, 4, 5];

  const pie = el("div", "rh-sched-foot");
  const copiar = el("button", "rh-sched-copy", "Mismo horario todos los días");
  copiar.type = "button";
  copiar.addEventListener("click", () => {
    const primera = filas.querySelector(".rh-sched-row");
    if (!primera) return;
    const from = primera.querySelector(".rh-sched-from").value;
    const to = primera.querySelector(".rh-sched-to").value;
    filas.querySelectorAll(".rh-sched-row").forEach(f => {
      f.querySelector(".rh-sched-from").value = from;
      f.querySelector(".rh-sched-to").value = to;
    });
  });
  pie.appendChild(copiar);

  function construirFila(n, from, to) {
    const fila = el("div", "rh-sched-row");
    fila.dataset.day = String(n);
    fila.appendChild(el("span", "rh-sched-day", DIAS.find(d => d.n === n)?.largo || "?"));

    const entrada = document.createElement("input");
    entrada.type = "time";
    entrada.className = "rh-input rh-sched-from";
    entrada.value = from || "";
    entrada.setAttribute("aria-label", `Entrada ${DIAS.find(d => d.n === n)?.largo || ""}`);

    const salida = document.createElement("input");
    salida.type = "time";
    salida.className = "rh-input rh-sched-to";
    salida.value = to || "";
    salida.setAttribute("aria-label", `Salida ${DIAS.find(d => d.n === n)?.largo || ""}`);

    fila.append(entrada, el("span", "rh-sched-sep", "–"), salida);
    return fila;
  }

  // Las filas se reordenan de lunes a domingo tras cada alta: si no, marcar el
  // sábado y luego el martes los dejaría en ese orden.
  function reordenar() {
    const nodos = [...filas.children].sort((a, b) =>
      ORDEN_SEMANA.indexOf(Number(a.dataset.day)) - ORDEN_SEMANA.indexOf(Number(b.dataset.day)));
    filas.replaceChildren(...nodos);
    pie.hidden = filas.childElementCount < 2;
  }

  DIAS.forEach(d => {
    const chip = el("button", "rh-day", d.corto);
    chip.type = "button";
    chip.dataset.day = String(d.n);
    chip.title = d.largo;
    chip.setAttribute("aria-pressed", String(activos.includes(d.n)));
    if (activos.includes(d.n)) chip.classList.add("on");

    chip.addEventListener("click", () => {
      const encendido = chip.classList.toggle("on");
      chip.setAttribute("aria-pressed", String(encendido));
      if (encendido) {
        // Se estrena con el horario del primer día ya puesto: quien trabaja
        // cinco días iguales no teclea la misma hora cinco veces.
        const modelo = filas.querySelector(".rh-sched-row");
        construirFilaEnLista(d.n,
          modelo?.querySelector(".rh-sched-from").value || "",
          modelo?.querySelector(".rh-sched-to").value || "");
      } else {
        filas.querySelector(`.rh-sched-row[data-day="${d.n}"]`)?.remove();
        pie.hidden = filas.childElementCount < 2;
      }
    });

    chips.appendChild(chip);
  });

  function construirFilaEnLista(n, from, to) {
    filas.appendChild(construirFila(n, from, to));
    reordenar();
  }

  for (const n of ORDEN_SEMANA) {
    if (!activos.includes(n)) continue;
    filas.appendChild(construirFila(n, porDia[n]?.from, porDia[n]?.to));
  }
  pie.hidden = filas.childElementCount < 2;

  bloque.append(chips, filas, pie);
  bloque.appendChild(el("div", "rh-hint",
    "Marca los días que trabaja y pon las horas de cada uno. Si son todos iguales, "
    + "llena el primero y usa el botón. Un día sin horas queda registrado como día trabajado."));
  return bloque;
}

// ── Formulario de edición ──────────────────────────────────────────
function formulario(p) {
  const form = el("div", "rh-form");
  const hr = hrDe(p._email);

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

  // El horario ya no es un solo rango para toda la semana: cada día lleva el
  // suyo. Lo pinta bloqueHorario(), más abajo.
  const horario = leerHorario(hr.schedule);

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

  const fila2 = bloqueHorario(horario);

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
  // Una entrada por día marcado. El día sin horas se guarda igual: saber que
  // alguien trabaja el sábado es un dato aunque no se sepa desde qué hora.
  const byDay = {};
  let horasIncompletas = null;
  for (const fila of document.querySelectorAll("#rhf-sched .rh-sched-row")) {
    const n = Number(fila.dataset.day);
    const f = fila.querySelector(".rh-sched-from").value || "";
    const t = fila.querySelector(".rh-sched-to").value || "";
    if ((f && !t) || (!f && t)) horasIncompletas = DIAS.find(d => d.n === n)?.largo || "ese día";
    byDay[n] = { from: f || null, to: t || null };
  }
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
  if (horasIncompletas) {
    heroToast.error(`El horario de ${horasIncompletas} necesita hora de entrada y de salida.`);
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
      //
      // Se escribe solo `byDay`, sin el from/to/days de antes. Mezclar las dos
      // formas en el mismo documento obligaría a decidir cuál manda el día que
      // no coincidan, y leerHorario() ya entiende la vieja sin ayuda.
      schedule: Object.keys(byDay).length ? { byDay } : null,
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

// <i> de Phosphor suelto, para meter dentro de un texto. Vive aqui y no se
// importa del dashboard: alli es privada, y tenerla duplicada en cuatro lineas
// cuesta menos que exportarla y acoplar los dos modulos por un helper.
function iconoInline(clases) {
  const i = document.createElement("i");
  i.className = clases;
  return i;
}


// ── Evaluaciones trimestrales ──────────────────────────────────────
// Historial + formulario, dentro de la ficha. Los datos viven en
// `hr-evaluations` y solo los ve admin, igual que el resto de RRHH.

function evaluacionesDe(p) {
  const caja = el("div", "rh-card-evals");

  const titulo = el("div", "section-label");
  titulo.appendChild(el("span", "kicker-dot"));
  titulo.appendChild(el("span", null, "Evaluaciones"));
  caja.appendChild(titulo);

  const lista = evaluaciones.get(p._email) || [];
  const { estado, meses } = estadoDe(lista);

  // Aviso de a quién le toca. Se dice en meses y no con un "vencida" a secas:
  // saber que hace cinco meses que no se evalúa a alguien informa más que un
  // rojo sin contexto.
  if (estado !== "al-dia") {
    const aviso = el("div", "rh-eval-due");
    aviso.appendChild(iconoInline("ph-fill ph-warning-circle"));
    aviso.appendChild(el("span", null, estado === "nunca"
      ? "Sin evaluaciones registradas todavía."
      : "Le toca evaluación: la última fue hace " + (meses === 1 ? "un mes" : meses + " meses") + "."));
    caja.appendChild(aviso);
  }

  if (evaluando && evaluando.email === p._email) {
    caja.appendChild(formularioEval(p, lista));
    return caja;
  }

  const nueva = el("button", "rh-btn rh-btn-primary rh-eval-new", "Nueva evaluación");
  nueva.type = "button";
  nueva.addEventListener("click", () => {
    evaluando = { email: p._email, id: null };
    pintarFicha();
  });
  caja.appendChild(nueva);

  if (!lista.length) {
    caja.appendChild(el("div", "ad-empty", "— Aún no se ha evaluado a esta persona —"));
    return caja;
  }

  for (const ev of lista) {
    const fila = el("div", "rh-eval");

    const cab = el("div", "rh-eval-head");
    cab.appendChild(el("span", "rh-eval-periodo", periodoTexto(ev.periodo)));
    if (ev.fecha) cab.appendChild(el("span", "rh-eval-fecha", ev.fecha));
    if (ev.evaluadoPor) {
      cab.appendChild(el("span", "rh-eval-quien", "evaluó " + ev.evaluadoPor.split("@")[0]));
    }
    const nota = el("span", "rh-eval-nota", ev.promedio != null ? ev.promedio.toFixed(1) : "—");
    nota.title = "Promedio de los cinco criterios";
    cab.appendChild(nota);
    fila.appendChild(cab);

    const chips = el("div", "rh-eval-criterios");
    for (const c of CRITERIOS) {
      const v = ev.criterios[c.id];
      const chip = el("span", "rh-eval-chip", c.label + " " + (v != null ? v : "—"));
      if (v != null) chip.dataset.nivel = String(v);
      chips.appendChild(chip);
    }
    fila.appendChild(chips);

    if (ev.comentario) fila.appendChild(el("blockquote", "rh-eval-coment", ev.comentario));

    const editar = el("button", "rh-eval-edit", "Corregir");
    editar.type = "button";
    editar.addEventListener("click", () => {
      evaluando = { email: p._email, id: ev.id };
      pintarFicha();
    });
    fila.appendChild(editar);

    caja.appendChild(fila);
  }

  return caja;
}

function formularioEval(p, lista) {
  const previa = evaluando.id ? lista.find(e => e.id === evaluando.id) : null;
  const form = el("div", "rh-eval-form");

  form.appendChild(el("div", "rh-eval-form-title",
    previa ? "Corrigiendo " + periodoTexto(previa.periodo) : "Nueva evaluación"));

  const filaMeta = el("div", "rh-form-row");

  const periodoWrap = el("label", "rh-field");
  periodoWrap.appendChild(el("span", "rh-field-label", "Trimestre"));
  const selPeriodo = document.createElement("select");
  selPeriodo.className = "ad-select";
  selPeriodo.id = "ev-periodo";
  // Solo los trimestres de este año, y hasta el que va en curso: no se ofrece
  // uno que todavía no ha empezado ni se rellena historial de años anteriores.
  // Decisión de Fernando, 2026-09-12.
  //
  // Los que esa persona ya tiene evaluados se marcan, y el formulario abre en
  // el más reciente que le falte: el selector abría siempre en el trimestre en
  // curso, así que volver a pulsar "Nueva evaluación" ofrecía por defecto el
  // periodo que acababas de registrar.
  const yaEvaluados = new Set(
    lista.filter(e => !previa || e.id !== previa.id).map(e => e.periodo)
  );
  const hoy = new Date();
  const trimestreActual = Math.floor(hoy.getMonth() / 3) + 1;
  let sugerido = null;
  for (let q = trimestreActual; q >= 1; q--) {
    const pid = hoy.getFullYear() + "-Q" + q;
    const opt = document.createElement("option");
    opt.value = pid;
    opt.textContent = periodoTexto(pid) + (yaEvaluados.has(pid) ? " · ya evaluado" : "");
    selPeriodo.appendChild(opt);
    if (!yaEvaluados.has(pid) && !sugerido) sugerido = pid;
  }
  if (sugerido) selPeriodo.value = sugerido;
  if (previa) {
    // Una evaluación vieja que se corrige puede tener un periodo fuera de esa
    // ventana; se añade para no cambiárselo sin querer al guardar.
    if (![...selPeriodo.options].some(o => o.value === previa.periodo)) {
      const opt = document.createElement("option");
      opt.value = previa.periodo;
      opt.textContent = periodoTexto(previa.periodo);
      selPeriodo.appendChild(opt);
    }
    selPeriodo.value = previa.periodo;
  }
  periodoWrap.appendChild(selPeriodo);
  filaMeta.appendChild(periodoWrap);

  const avisoDup = el("div", "rh-eval-dup");
  avisoDup.hidden = true;
  const revisarDuplicado = () => {
    const repetido = yaEvaluados.has(selPeriodo.value);
    avisoDup.hidden = !repetido;
    if (repetido) {
      avisoDup.replaceChildren(
        iconoInline("ph-fill ph-warning-circle"),
        document.createTextNode(
          ` Ya hay una evaluación de ${periodoTexto(selPeriodo.value)} para esta persona. ` +
          "Si quieres cambiarla, corrige la que existe en vez de registrar otra."),
      );
    }
  };
  selPeriodo.addEventListener("change", revisarDuplicado);

  const fechaWrap = el("label", "rh-field");
  fechaWrap.appendChild(el("span", "rh-field-label", "Fecha de la evaluación"));
  const inpFecha = document.createElement("input");
  inpFecha.type = "text";
  inpFecha.className = "ad-select rh-date";
  inpFecha.id = "ev-fecha";
  inpFecha.placeholder = "MM/DD/YYYY";
  inpFecha.autocomplete = "off";
  inpFecha.value = (previa && previa.fecha) || fechaHoyUS();
  fechaWrap.appendChild(inpFecha);
  filaMeta.appendChild(fechaWrap);

  form.appendChild(filaMeta);
  form.appendChild(avisoDup);
  revisarDuplicado();

  for (const c of CRITERIOS) {
    const fila = el("div", "rh-eval-crit-row");
    const etiqueta = el("div", "rh-eval-crit-label");
    etiqueta.appendChild(el("span", "rh-eval-crit-name", c.label));
    etiqueta.appendChild(el("span", "rh-eval-crit-help", c.ayuda));
    fila.appendChild(etiqueta);

    const opciones = el("div", "rh-eval-scale");
    for (const n of ESCALA) {
      const btn = el("button", "rh-eval-dot", String(n.v));
      btn.type = "button";
      btn.dataset.crit = c.id;
      btn.dataset.valor = String(n.v);
      btn.title = n.label;
      if (previa && previa.criterios && previa.criterios[c.id] === n.v) btn.classList.add("on");
      btn.addEventListener("click", () => {
        opciones.querySelectorAll(".rh-eval-dot").forEach(x => x.classList.remove("on"));
        btn.classList.add("on");
        refrescarPromedio(form);
      });
      opciones.appendChild(btn);
    }
    fila.appendChild(opciones);
    form.appendChild(fila);
  }

  const prom = el("div", "rh-eval-prom");
  prom.id = "ev-promedio";
  form.appendChild(prom);

  const comentWrap = el("label", "rh-field");
  comentWrap.appendChild(el("span", "rh-field-label", "Comentario"));
  const txt = document.createElement("textarea");
  txt.className = "ad-select rh-eval-text";
  txt.id = "ev-comentario";
  txt.rows = 3;
  txt.placeholder = "Qué hizo bien, qué debe mejorar y acuerdos para el próximo trimestre…";
  txt.value = (previa && previa.comentario) || "";
  comentWrap.appendChild(txt);
  form.appendChild(comentWrap);

  const acciones = el("div", "rh-form-actions");
  const cancelar = el("button", "rh-btn", "Cancelar");
  cancelar.type = "button";
  cancelar.addEventListener("click", () => { evaluando = null; pintarFicha(); });
  const guardar = el("button", "rh-btn rh-btn-primary", previa ? "Guardar corrección" : "Registrar evaluación");
  guardar.type = "button";
  guardar.addEventListener("click", () => guardarEval(p, guardar));
  acciones.append(cancelar, guardar);
  form.appendChild(acciones);

  if (typeof flatpickr === "function") {
    pickers.push(flatpickr(inpFecha, { locale: "es", dateFormat: "m/d/Y", allowInput: true }));
  }

  refrescarPromedio(form);
  return form;
}

function fechaHoyUS() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, "0") + "/" +
         String(d.getDate()).padStart(2, "0") + "/" + d.getFullYear();
}

function leerCriterios(form) {
  const datos = {};
  form.querySelectorAll(".rh-eval-dot.on").forEach(b => {
    datos[b.dataset.crit] = Number(b.dataset.valor);
  });
  return datos;
}

function refrescarPromedio(form) {
  const caja = form.querySelector("#ev-promedio");
  if (!caja) return;
  const criterios = leerCriterios(form);
  const puestos = Object.keys(criterios).length;
  const prom = promedioDe(criterios);
  caja.replaceChildren();
  if (prom == null) {
    caja.appendChild(el("span", "rh-eval-prom-hint", "Puntúa los cinco criterios para ver el promedio."));
    return;
  }
  caja.appendChild(el("span", "rh-eval-prom-n", prom.toFixed(1)));
  caja.appendChild(el("span", "rh-eval-prom-lbl",
    puestos < CRITERIOS.length ? "promedio de " + puestos + " de " + CRITERIOS.length : "promedio"));
}

async function guardarEval(p, btn) {
  const form = btn.closest(".rh-eval-form");
  const criterios = leerCriterios(form);

  if (Object.keys(criterios).length < CRITERIOS.length) {
    heroToast.error("Faltan criterios por puntuar.");
    return;
  }
  const fecha = (form.querySelector("#ev-fecha").value || "").trim();
  if (fecha && !parseUS(fecha)) {
    heroToast.error("La fecha va en formato MM/DD/YYYY.");
    return;
  }

  const texto = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    await saveEvaluacion({
      id: evaluando.id,
      email: p._email,
      name: p.identity?.name || p._email,
      periodo: form.querySelector("#ev-periodo").value,
      fecha,
      criterios,
      comentario: form.querySelector("#ev-comentario").value,
    });
    // Se relee todo para que el historial, el promedio y el aviso de "le toca"
    // queden al día sin recargar la página.
    evaluaciones = await getEvaluacionesPorPersona();
    evaluando = null;
    pintarFicha();
    pintarLista();
    heroToast.success("Evaluación registrada.");
  } catch (e) {
    console.error("rrhh evaluaciones:", e);
    heroToast.error("No se pudo guardar: " + e.message);
    btn.disabled = false;
    btn.textContent = texto;
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

/**
 * El calendario pide abrir la ficha de alguien al pulsar un cumpleaños o una
 * ausencia. Llega por evento del documento y no por import: rrhh-calendario.js
 * ya se importa desde aquí, y devolverle la llamada cerraría el círculo.
 *
 * Cambiar de vista se hace pulsando la pestaña, no tocando `hidden` a mano:
 * bindVistas() coordina cuatro contenedores y los filtros de la toolbar, y
 * media docena de estados se quedarían a medias.
 */
function bindSaltoDesdeCalendario() {
  document.addEventListener("rh:abrir-persona", async e => {
    const email = e.detail?.email;
    if (!email) return;

    document.querySelector('.rh-view-btn[data-view="personas"]')?.click();
    if (!personas.length) await cargarPersonas();

    // Quien reportó una ausencia puede no estar en el equipo (una cuenta ya
    // dada de baja, por ejemplo): sin esto la ficha quedaría en blanco.
    if (!personas.some(p => (p._email || "") === email)) {
      window.heroToast?.info("Esa persona no está en la lista del equipo.");
      return;
    }
    seleccionar(email);
  });
}

// ── Init ───────────────────────────────────────────────────────────
function init() {
  if (!$("rh-people-list")) return;

  bindVistas();
  initCalendario();
  bindSaltoDesdeCalendario();

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
