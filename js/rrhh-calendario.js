// ═══════════════════════════════════════════
// Hero Hub · Calendario de Recursos Humanos
// ═══════════════════════════════════════════
// Tercera vista de rrhh.html. Pone en un mes lo que RRHH necesita mirar junto:
//
//   Nomina      -> dias 15 y 30 de cada mes (calculados, no configurados)
//   Feriados    -> los 11 federales de EE. UU., por regla del calendario
//   Cumpleanos  -> identity.birthdate de users/, en MM-DD
//   Ausencias   -> lo ya reportado, que el dashboard tiene en memoria
//
// Nada de esto se guarda: el mes se arma en el navegador cada vez. No hay
// colección de eventos ni nada que mantener al día — si cambia un cumpleaños
// en la ficha, el calendario ya lo refleja la próxima vez que se pinta.

import { getAllUsers } from "./user-store.js";
import {
  getItems, getDirectorio, getCoberturaDesde, cargarHistorico, onDatosActualizados,
} from "./rrhh-dashboard.js";

const $ = id => document.getElementById(id);

const DIAS_CORTOS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Orden de pintado dentro de una celda y en la lista del mes. La nómina va
// primera porque es la que se busca de un vistazo.
// Iconos de Phosphor ([[feedback_iconos_phosphor]]): un emoji lo dibuja el
// sistema operativo, no hereda el color de la marca ni el tema noche.
const TIPOS = {
  nomina:     { ph: "ph-money",       label: "Nómina" },
  feriado:    { ph: "ph-flag-banner", label: "Feriado" },
  cumple:     { ph: "ph-cake",        label: "Cumpleaños" },
  ausencia:   { ph: "ph-calendar-x",  label: "Ausencia" },
};
const ORDEN_TIPOS = ["nomina", "feriado", "cumple", "ausencia"];

let mesVisible = null;     // Date apuntando al día 1 del mes en pantalla
let usuarios = null;
let pidiendoHistorico = false;


// ── Fechas ─────────────────────────────────────────────────────────

const mismoDia = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const ultimoDiaDe = (y, m) => new Date(y, m + 1, 0).getDate();

/** n-ésimo día de la semana del mes. nthDow(2026, 0, 1, 3) = 3er lunes de enero. */
function nthDow(y, m, dow, n) {
  const primero = new Date(y, m, 1);
  const salto = (dow - primero.getDay() + 7) % 7;
  return new Date(y, m, 1 + salto + (n - 1) * 7);
}

/** Último día de la semana del mes. lastDow(2026, 4, 1) = último lunes de mayo. */
function lastDow(y, m, dow) {
  const ultimo = new Date(y, m + 1, 0);
  const salto = (ultimo.getDay() - dow + 7) % 7;
  return new Date(y, m + 1, 0 - salto);
}


// ── Nómina ─────────────────────────────────────────────────────────
// Los días 15 y 30, sin mover por fin de semana ni feriado: es la fecha
// nominal del ciclo, no la de acreditación del banco. Decisión de Fernando,
// 2026-09-11.
//
// Febrero no tiene 30, así que la segunda quincena cae en el último día del
// mes — 28, o 29 en bisiesto. Los meses de 31 días sí pagan el 30.
function nominaDelMes(y, m) {
  const segunda = Math.min(30, ultimoDiaDe(y, m));
  return [15, segunda].map(d => ({
    dia: d,
    tipo: "nomina",
    texto: "Nómina",
  }));
}


// ── Feriados federales ─────────────────────────────────────────────
// Se calculan por la regla de cada uno en vez de mantener una tabla año a
// año: las reglas no cambian y así el calendario funciona en 2030 sin que
// nadie lo toque.
function feriadosDe(y) {
  return [
    { fecha: new Date(y, 0, 1),        nombre: "Año Nuevo",                fijo: true },
    { fecha: nthDow(y, 0, 1, 3),       nombre: "Día de Martin Luther King Jr." },
    { fecha: nthDow(y, 1, 1, 3),       nombre: "Día de los Presidentes" },
    { fecha: lastDow(y, 4, 1),         nombre: "Memorial Day" },
    { fecha: new Date(y, 5, 19),       nombre: "Juneteenth",               fijo: true },
    { fecha: new Date(y, 6, 4),        nombre: "Día de la Independencia",  fijo: true },
    { fecha: nthDow(y, 8, 1, 1),       nombre: "Día del Trabajo" },
    { fecha: nthDow(y, 9, 1, 2),       nombre: "Columbus Day" },
    { fecha: new Date(y, 10, 11),      nombre: "Día de los Veteranos",     fijo: true },
    { fecha: nthDow(y, 10, 4, 4),      nombre: "Acción de Gracias" },
    { fecha: new Date(y, 11, 25),      nombre: "Navidad",                  fijo: true },
  ];
}

/**
 * Los de fecha fija que caen en fin de semana se observan el viernes o el
 * lunes de al lado. La marca se queda en el día real — mover el feriado de
 * sitio confunde más de lo que ayuda — y la observancia se dice en la lista.
 */
function observanciaDe(feriado) {
  if (!feriado.fijo) return "";
  const dow = feriado.fecha.getDay();
  if (dow === 6) return "se observa el viernes anterior";
  if (dow === 0) return "se observa el lunes siguiente";
  return "";
}


// ── Cumpleaños ─────────────────────────────────────────────────────
// identity.birthdate viene en MM-DD, sin año: el año vive en hr-data y aquí
// no hace falta ([[project_dashboard_rrhh]]).
function cumplesDelMes(mes) {
  if (!Array.isArray(usuarios)) return [];
  const salida = [];
  for (const u of usuarios) {
    const bd = u.identity?.birthdate;
    if (!bd || !/^\d{2}-\d{2}$/.test(bd)) continue;
    const [mm, dd] = bd.split("-").map(Number);
    if (mm - 1 !== mes) continue;
    salida.push({
      dia: dd,
      tipo: "cumple",
      texto: u.identity?.name || u._email,
    });
  }
  return salida;
}


// ── Ausencias ──────────────────────────────────────────────────────
function ausenciasDelMes(y, m) {
  return getItems()
    .filter(it => it.tipo === "ausencia" && it.cuando instanceof Date &&
                  it.cuando.getFullYear() === y && it.cuando.getMonth() === m)
    .map(it => ({
      dia: it.cuando.getDate(),
      tipo: "ausencia",
      texto: it.name || it.email || "—",
    }));
}


// ── Armado del mes ─────────────────────────────────────────────────
function eventosDelMes(y, m) {
  const eventos = [
    ...nominaDelMes(y, m),
    ...cumplesDelMes(m),
    ...ausenciasDelMes(y, m),
  ];

  for (const f of feriadosDe(y)) {
    if (f.fecha.getMonth() !== m) continue;
    const obs = observanciaDe(f);
    eventos.push({
      dia: f.fecha.getDate(),
      tipo: "feriado",
      texto: f.nombre + (obs ? ` · ${obs}` : ""),
    });
  }

  const porDia = new Map();
  for (const ev of eventos) {
    if (!porDia.has(ev.dia)) porDia.set(ev.dia, []);
    porDia.get(ev.dia).push(ev);
  }
  for (const lista of porDia.values()) {
    lista.sort((a, b) => ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo));
  }
  return porDia;
}


// ── Render ─────────────────────────────────────────────────────────

function el(tag, className, texto) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (texto != null) n.textContent = texto;
  return n;
}

function pintar() {
  const cont = $("rh-cal-grid");
  if (!cont || !mesVisible) return;

  const y = mesVisible.getFullYear();
  const m = mesVisible.getMonth();
  const hoy = new Date();

  const titulo = $("rh-cal-title");
  if (titulo) titulo.textContent = `${MESES[m]} ${y}`;

  const porDia = eventosDelMes(y, m);

  cont.replaceChildren();

  for (const d of DIAS_CORTOS) cont.appendChild(el("div", "rh-cal-dow", d));

  // Huecos hasta el primer día: el mes no empieza en domingo casi nunca.
  const arranque = new Date(y, m, 1).getDay();
  for (let i = 0; i < arranque; i++) cont.appendChild(el("div", "rh-cal-cell vacia"));

  const total = ultimoDiaDe(y, m);
  for (let d = 1; d <= total; d++) {
    const celda = el("div", "rh-cal-cell");
    if (mismoDia(new Date(y, m, d), hoy)) celda.classList.add("hoy");

    celda.appendChild(el("div", "rh-cal-num", String(d)));

    const marcas = el("div", "rh-cal-marks");
    const eventos = porDia.get(d) || [];
    // Una marca por tipo: cinco cumpleaños el mismo día no pintan cinco
    // pasteles, pintan uno. El detalle está en la lista de abajo.
    const vistos = new Set();
    for (const ev of eventos) {
      if (vistos.has(ev.tipo)) continue;
      vistos.add(ev.tipo);
      const marca = el("i", `ph-fill ${TIPOS[ev.tipo].ph} rh-cal-mark m-${ev.tipo}`);
      marca.title = eventos.filter(e => e.tipo === ev.tipo).map(e => e.texto).join(" · ");
      marcas.appendChild(marca);
    }
    if (marcas.childElementCount) celda.appendChild(marcas);

    cont.appendChild(celda);
  }

  pintarLista(porDia, y, m);
}

function pintarLista(porDia, y, m) {
  const cont = $("rh-cal-list");
  if (!cont) return;
  cont.replaceChildren();

  const dias = [...porDia.keys()].sort((a, b) => a - b);
  if (!dias.length) {
    cont.appendChild(el("div", "ad-empty", "— Nada marcado este mes —"));
    return;
  }

  for (const d of dias) {
    for (const ev of porDia.get(d)) {
      const fila = el("div", "rh-cal-row");
      fila.appendChild(el("i", `ph-fill ${TIPOS[ev.tipo].ph} rh-cal-row-emoji m-${ev.tipo}`));
      fila.appendChild(el("span", "rh-cal-row-date", `${String(d).padStart(2, " ")} ${MESES[m].slice(0, 3)}`));
      fila.appendChild(el("span", "rh-cal-row-text", ev.texto));
      cont.appendChild(fila);
    }
  }

  // Las ausencias solo se pueden mostrar si el mes cae dentro de lo cargado.
  // Sin este aviso, un mes viejo se vería "sin ausencias" cuando en realidad
  // es "sin datos" — el mismo malentendido que se arregló en v2.45.1.
  const cobertura = getCoberturaDesde();
  const finDeMes = new Date(y, m + 1, 0, 23, 59, 59);
  if (cobertura && finDeMes < cobertura && !pidiendoHistorico) {
    const aviso = el("div", "rh-cal-warn");
    aviso.appendChild(el("span", null, "Las ausencias de este mes no están cargadas."));
    const btn = el("button", "rh-cal-loadall", "Cargar histórico");
    btn.type = "button";
    btn.addEventListener("click", async () => {
      pidiendoHistorico = true;
      btn.disabled = true;
      btn.textContent = "Cargando…";
      try { await cargarHistorico(); } finally { pidiendoHistorico = false; }
      pintar();
    });
    aviso.appendChild(btn);
    cont.appendChild(aviso);
  }
}


// ── Datos ──────────────────────────────────────────────────────────
async function asegurarUsuarios() {
  if (Array.isArray(usuarios)) return;
  // La vista Personas ya suele haberlos leído: se reusan en vez de pedir la
  // colección otra vez.
  const yaLeidos = getDirectorio();
  if (Array.isArray(yaLeidos) && yaLeidos.length) {
    usuarios = yaLeidos;
    return;
  }
  try {
    usuarios = await getAllUsers();
  } catch (e) {
    // Sin usuarios el calendario pierde los cumpleaños, no el resto.
    console.warn("RRHH calendario: no se pudo leer el equipo:", e.message);
    usuarios = [];
  }
}


// ── API de la vista ────────────────────────────────────────────────

/** La llama bindVistas() al abrir la pestaña. Idempotente. */
export async function abrirCalendario() {
  if (!mesVisible) mesVisible = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  pintar();                 // primero lo que no depende de Firestore
  await asegurarUsuarios();
  pintar();                 // y otra vez ya con los cumpleaños
}

function mover(delta) {
  if (!mesVisible) return;
  mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + delta, 1);
  pintar();
}

export function initCalendario() {
  const grid = $("rh-cal-grid");
  if (!grid) return;

  $("rh-cal-prev")?.addEventListener("click", () => mover(-1));
  $("rh-cal-next")?.addEventListener("click", () => mover(1));
  $("rh-cal-today")?.addEventListener("click", () => {
    const hoy = new Date();
    mesVisible = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    pintar();
  });

  // Si llegan ausencias nuevas mientras el calendario está abierto, se repinta.
  onDatosActualizados(() => { if (mesVisible && !$("rh-calendario")?.hidden) pintar(); });
}
