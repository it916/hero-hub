// ═══════════════════════════════════════════
// Hero Hub · Dashboard de Recursos Humanos
// ═══════════════════════════════════════════
// Módulo propio (rrhh.html) desde v2.44.0 — antes era el primer tab de
// admin.html. Reúne en una sola vista todo lo que el equipo reporta desde el
// tile "Reportar" del banner:
//
//   · Ausencia         → colección `attendance`, type="Ausencia"
//   · Corte eléctrico  ┐
//   · Sin internet     ├ colección `reports`
//   · Llegada tarde    ┘
//
// Son dos fuentes porque la ausencia nunca se movió: el motor de stats de
// asistencia y el histórico dependen de ella. Aquí se normalizan a la misma
// forma y se muestran como una sola lista, que es como HR las piensa.
//
// El fichaje (contadores en vivo, horas trabajadas) se retiró en v2.41.0 y
// vive plegado bajo "Historial de asistencia" — lo sigue rindiendo
// js/asistencia-dashboard.js, que se carga solo al abrir esa sección.

import { fetchReports } from "./reports-store.js";
import { getAllUsers } from "./user-store.js";
import {
  fetchAttendanceEvents, parseMMDDYYYY, parseEventDate,
  startOfDay, startOfWeek, startOfMonth,
} from "./attendance-stats.js";

// Por default traemos 90 días. Es bastante más que los 30 del dashboard de
// asistencia porque estos son pocos documentos: un aviso suelto por persona
// cada tanto, no cuatro fichajes diarios de todo el equipo.
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_FILAS = 80;

// `ph` es la clase de Phosphor, la fuente de iconos del Hub: nada de emojis,
// que los dibuja el sistema operativo y no heredan color ni tema.
const TIPO_META = {
  "ausencia":        { label: "Ausencia",        ph: "ph-calendar-x",      color: "#f43f5e" },
  "corte-electrico": { label: "Corte eléctrico", ph: "ph-lightning-slash", color: "#f5b830" },
  "falla-internet":  { label: "Sin internet",    ph: "ph-wifi-slash",      color: "#06a3b6" },
  "retraso":         { label: "Llegada tarde",   ph: "ph-clock-user",      color: "#8b5cf6" },
  // Cierres: el aviso de que la luz o el internet ya volvieron. Llevan
  // duracionMin, que es el dato que interesa de verdad.
  "corte-electrico-fin": { label: "Volvió la luz",      ph: "ph-lightning", color: "#0f8054" },
  "falla-internet-fin":  { label: "Volvió el internet", ph: "ph-wifi-high", color: "#0f8054" },
};

let items = [];
let historyLoaded = false;
let handlersBound = false;
const charts = {};

const $ = id => document.getElementById(id);

// ── Init ───────────────────────────────────────────────────────────
export async function initRRHHDashboard() {
  if (!handlersBound) {
    const refresh = $("rh-refresh");
    const full = $("rh-load-all");
    if (refresh) refresh.addEventListener("click", () => fetchAndRender({ loadAll: historyLoaded }));
    if (full) full.addEventListener("click", () => fetchAndRender({ loadAll: true }));
    const periodo = $("rh-period");
    if (periodo) periodo.addEventListener("change", () => {
      const custom = periodo.value === "custom";
      const wrap = $("rh-range");
      if (wrap) wrap.hidden = !custom;
      if (custom) asegurarPickers();
      renderConCobertura();
    });
    const tipo = $("rh-type");
    // El tipo no cambia el rango, así que no puede quedarse corto de datos.
    if (tipo) tipo.addEventListener("change", renderVisible);
    bindHistorial();
    handlersBound = true;
  }
  await fetchAndRender({ loadAll: false });
}

// El historial de asistencia es caro (trae todos los fichajes) y ya casi
// nadie lo mira: se carga la primera vez que alguien abre el desplegable.
function bindHistorial() {
  const det = $("rh-history");
  if (!det) return;
  det.addEventListener("toggle", async () => {
    if (!det.open || det.dataset.loaded) return;
    det.dataset.loaded = "1";
    const { initAsistenciaDashboard } = await import("./asistencia-dashboard.js");
    await initAsistenciaDashboard();
  });
}

// ── Estado visible de la vista general ─────────────────────────────
// Qué pestaña está al frente lo manda el selector de js/rrhh-personas.js,
// pero la toolbar (Actualizar / Cargar todo / periodo / tipo) es compartida y
// nunca se oculta. Por eso el estado se guarda aquí y solo se vuelca al DOM
// cuando la vista general está visible: si no, un "Actualizar" desde "Por
// persona" repintaba #rh-content encima del panel de personas.
let estadoGeneral = "loading";
let renderPendiente = false;

function enVistaGeneral() {
  const activo = document.querySelector(".rh-view-btn.active");
  return !activo || activo.dataset.view === "general";
}

function setEstadoGeneral(estado) {
  estadoGeneral = estado;
  aplicarVistaGeneral(enVistaGeneral());
}

// La llama bindVistas() al cambiar de pestaña. Con `visible` en false apaga
// los tres bloques; con true restaura el que corresponda al estado real —
// no siempre #rh-content, que era el bug: volver de "Por persona" mientras
// la carga había fallado mostraba el contenido vacío en vez del error.
export function aplicarVistaGeneral(visible = true) {
  const bloque = k => (visible && estadoGeneral === k ? "block" : "none");
  const loading = $("rh-loading");
  const errorEl = $("rh-error");
  const content = $("rh-content");
  if (loading) loading.style.display = bloque("loading");
  if (errorEl) errorEl.style.display = bloque("error");
  if (content) content.style.display = bloque("content");
  // Chart.js mide el contenedor al dibujar: si se rindió con display:none los
  // canvas quedan en 0px. Se difiere el render hasta que la vista se ve.
  if (visible && renderPendiente) {
    renderPendiente = false;
    render();
  }
}

function renderVisible() {
  if (enVistaGeneral()) render();
  else renderPendiente = true;
}

// ── Cobertura de datos ─────────────────────────────────────────────
// `items` solo tiene lo que se trajo: 90 días, salvo que se haya pedido el
// histórico. Un rango que empezaba antes de esa ventana devolvía cero, y cero
// por falta de datos se ve exactamente igual que cero por no haber reportes.
// Antes de renderizar se comprueba y, si hace falta, se trae todo.
let coberturaDesde = null;   // null = está cargado el histórico completo

async function asegurarCobertura() {
  if (historyLoaded || !coberturaDesde) return false;
  const sel = $("rh-period")?.value;
  const { desde } = rangoActual();
  // "Todo lo cargado" con media colección en memoria tampoco es todo.
  const pideMas = sel === "all" || (desde && desde < coberturaDesde);
  if (!pideMas) return false;
  await fetchAndRender({ loadAll: true });
  return true;   // fetchAndRender ya rindió; el caller no debe repetirlo
}

// Envuelve a renderVisible para los controles que pueden pedir un rango
// fuera de la ventana cargada.
async function renderConCobertura() {
  if (await asegurarCobertura()) return;
  renderVisible();
}

// ── Fetch ──────────────────────────────────────────────────────────
async function fetchAndRender({ loadAll = false } = {}) {
  setEstadoGeneral("loading");

  try {
    const opts = loadAll ? {} : { from: daysAgo(DEFAULT_LOOKBACK_DAYS) };

    // Las dos fuentes van en paralelo: son colecciones distintas y ninguna
    // depende de la otra.
    const [reports, eventos] = await Promise.all([
      fetchReports(opts),
      fetchAttendanceEvents(opts),
    ]);

    items = reports.map(normReporte)
      .concat(eventos.filter(e => e.tipo === "Ausencia").map(normAusencia))
      .filter(it => it.cuando)
      .sort((a, b) => b.cuando - a.cuando);

    historyLoaded = loadAll;
    coberturaDesde = loadAll ? null : daysAgo(DEFAULT_LOOKBACK_DAYS);
    const btn = $("rh-load-all");
    if (btn) {
      btn.textContent = loadAll ? `Todo cargado (${items.length})` : "Cargar todo el histórico";
      btn.disabled = loadAll;
    }

    const sufijo = loadAll ? " · histórico completo" : ` · últimos ${DEFAULT_LOOKBACK_DAYS} días`;
    $("rh-last-update").textContent =
      "Actualizado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + sufijo;

    // Primero se muestra el contenedor y después se dibuja: al revés, los
    // canvas se medirían contra un #rh-content todavía en display:none.
    setEstadoGeneral("content");
    renderVisible();
  } catch (e) {
    console.error("rrhh-dashboard:", e);
    setEstadoGeneral("error");
    pintarError($("rh-error"), e.message);
    if (window.refreshIcons) window.refreshIcons();
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Normalización de las dos fuentes ───────────────────────────────
// `cuando` es siempre el momento del hecho reportado, no el del envío:
// es lo que HR mira. `reportadoAt` guarda el envío para el detalle.
// "3 h 20 min sin servicio". Es lo que RRHH quiere leer de un cierre, en vez
// del detalle vacío que traen estos avisos.
function duracionTexto(min) {
  if (min < 1) return "restablecido enseguida";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const partes = [];
  if (h) partes.push(h === 1 ? "1 hora" : `${h} horas`);
  if (m) partes.push(m === 1 ? "1 minuto" : `${m} minutos`);
  return `Estuvo ${partes.join(" y ")} sin servicio`;
}

function normReporte(r) {
  const porFecha = r.fecha ? parseMMDDYYYY(r.fecha) : null;
  return {
    id: r.id,
    tipo: r.type,
    label: r.label,
    name: r.name,
    email: r.email,
    cuando: r.ocurrido || porFecha || r.reportadoAt,
    hora: r.hora,
    detalle: r.duracionMin != null ? duracionTexto(r.duracionMin) : r.detalle,
    llegadaEstimada: r.llegadaEstimada,
    alMomento: r.alMomento,
    reportadoAt: r.reportadoAt,
  };
}

function normAusencia(ev) {
  const reportadoAt = parseEventDate(ev);
  return {
    id: `${ev.email}-${ev.fecha}-${ev.hora}`,
    tipo: "ausencia",
    label: "Ausencia",
    name: ev.nombre || ev.email,
    email: ev.email,
    cuando: ev.fechaObjetivo ? parseMMDDYYYY(ev.fechaObjetivo) : reportadoAt,
    hora: null,
    detalle: ev.motivo || "",
    llegadaEstimada: null,
    alMomento: null,
    reportadoAt,
  };
}

// ── Formato ────────────────────────────────────────────────────────
function hm12(hm) {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  const suf = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suf}`;
}

function fechaUS(d) {
  if (!d) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function horaDe(d) {
  if (!d) return "";
  return hm12(String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"));
}

// ── Render ─────────────────────────────────────────────────────────
function rangoActual() {
  const now = new Date();
  const sel = $("rh-period").value;
  if (sel === "today") return { desde: startOfDay(now), hasta: null, label: "hoy" };
  if (sel === "week")  return { desde: startOfWeek(now), hasta: null, label: "esta semana" };
  if (sel === "month") return { desde: startOfMonth(now), hasta: null, label: "este mes" };
  if (sel === "last90") {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    d.setHours(0, 0, 0, 0);
    return { desde: d, hasta: null, label: "los últimos 90 días" };
  }
  if (sel === "custom") {
    const desde = parseMMDDYYYY($("rh-from").value);
    const hasta = parseMMDDYYYY($("rh-to").value);
    // El "hasta" tapa el final del día: si no, un reporte de las 3 PM del
    // último día del rango quedaría fuera por unas horas.
    if (hasta) hasta.setHours(23, 59, 59, 999);
    const fmt = d => d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "?";
    return { desde, hasta, label: `${fmt(desde)} → ${fmt(hasta)}` };
  }
  return { desde: null, hasta: null, label: "todo el periodo cargado" };
}

// Flatpickr se instancia la primera vez que se elige "Personalizado".
let fpDesde = null, fpHasta = null;
function asegurarPickers() {
  if (fpDesde && fpHasta) return;
  const from = $("rh-from"), to = $("rh-to");
  if (!from || !to || typeof flatpickr === "undefined") return;

  const hoy = new Date();
  const mesAtras = new Date();
  mesAtras.setDate(mesAtras.getDate() - 30);

  fpDesde = flatpickr(from, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: mesAtras, maxDate: hoy,
    onChange: ([d]) => { if (d && fpHasta) fpHasta.set("minDate", d); renderConCobertura(); },
  });
  // Sin minDate: el "hasta" arrancaba limitado a hace 30 días, así que un
  // rango cerrado antiguo (marzo → abril) no se podía ni elegir.
  fpHasta = flatpickr(to, {
    locale: "es", dateFormat: "m/d/Y", defaultDate: hoy, maxDate: hoy,
    onChange: ([d]) => { if (d && fpDesde) fpDesde.set("maxDate", d); renderConCobertura(); },
  });
}

// ── Estado compartido con la vista por persona ─────────────────────
// js/rrhh-personas.js consume esto en vez de volver a leer Firestore: los
// dos módulos viven en la misma página y comparten la instancia.
const suscriptores = [];

export function getItemsEnRango() {
  const { desde, hasta } = rangoActual();
  return items.filter(it =>
    (!desde || it.cuando >= desde) && (!hasta || it.cuando <= hasta));
}

export function getEtiquetaRango() {
  return rangoActual().label;
}

export function onDatosActualizados(cb) {
  suscriptores.push(cb);
}


// ── Identidad de quien reporta ─────────────────────────────────────
// Un reporte guarda el correo con el que se envió — que puede ser un alias de
// identity.emails[] — y el nombre tal como estaba ese día. Agrupar por
// `name || email` partía en dos barras a la misma persona: por el alias, y por
// un nombre que cambió (casada, tilde añadida, apellido completo).
//
// El directorio resuelve ambos casos: todo alias apunta al docId y la etiqueta
// sale del nombre oficial. Se pide una sola vez y sin bloquear el pintado: las
// barras salen con lo que haya y se repintan cuando llega.
let alias = null;          // email normalizado -> { key, label }
let aliasPedido = false;
let usuarios = null;       // el array crudo, para quien necesite más que el alias

const normEmail = e => String(e || "").toLowerCase().trim();

/** Llena el directorio con usuarios ya leídos, para no releer la colección. */
export function setDirectorio(users) {
  if (!Array.isArray(users) || !users.length) return;
  usuarios = users;
  alias = construirAlias(users);
  aliasPedido = true;
  renderVisible();
}

/** El directorio ya leído, o null si todavía no lo pidió nadie. */
export function getDirectorio() {
  return usuarios;
}

/** Todo lo cargado, sin filtrar por el rango de la toolbar. */
export function getItems() {
  return items;
}

/**
 * Hasta qué fecha llega lo que hay en memoria. null = el histórico completo.
 * Quien pinte un mes anterior a esto tiene que pedir `cargarHistorico()` o
 * enseñará un mes vacío que parecerá un mes sin novedades.
 */
export function getCoberturaDesde() {
  return coberturaDesde;
}

export async function cargarHistorico() {
  if (historyLoaded) return;
  await fetchAndRender({ loadAll: true });
}

function construirAlias(users) {
  const mapa = new Map();
  for (const u of users) {
    const key = normEmail(u._email);
    if (!key) continue;
    const label = u.identity?.name || u._email;
    mapa.set(key, { key, label });
    const otros = Array.isArray(u.identity?.emails) ? u.identity.emails : [];
    for (const e of otros) {
      const alt = normEmail(e);
      // El docId manda: un alias nunca pisa a otra persona ya registrada.
      if (alt && !mapa.has(alt)) mapa.set(alt, { key, label });
    }
  }
  return mapa;
}

function pedirDirectorio() {
  if (aliasPedido) return;
  aliasPedido = true;
  getAllUsers()
    .then(users => {
      usuarios = users;
      alias = construirAlias(users);
      renderVisible();
    })
    .catch(e => {
      // Sin directorio las barras siguen saliendo, agrupadas por correo.
      console.warn("RRHH: no se pudo leer el directorio para agrupar:", e.message);
    });
}

/** Identidad canónica de un item: docId del Hub si se reconoce, si no el correo. */
function identidadDe(it) {
  const email = normEmail(it.email);
  const encontrado = alias && alias.get(email);
  if (encontrado) return encontrado;
  return { key: email || it.name || "—", label: it.name || email || "—" };
}

function render() {
  const { desde, hasta, label } = rangoActual();
  const tipoSel = $("rh-type").value;

  $("rh-period-label").textContent = label;

  const enRango = items.filter(it =>
    (!desde || it.cuando >= desde) && (!hasta || it.cuando <= hasta));
  const visibles = tipoSel === "all" ? enRango : enRango.filter(it => it.tipo === tipoSel);

  pintarKPIs(enRango);
  pintarLista(visibles);
  pintarBarras(visibles);

  // La ficha por persona depende del mismo rango: se entera acá en vez de
  // duplicar los listeners del selector.
  suscriptores.forEach(cb => { try { cb(); } catch (e) { console.error("rrhh:", e); } });

  if (window.refreshIcons) window.refreshIcons();
}

// Los KPIs ignoran el filtro de tipo a propósito: son el panorama del
// periodo, no del filtro. Si no, el usuario filtra por "Ausencia" y los
// otros tres contadores se van a cero sin motivo aparente.
function pintarKPIs(enRango) {
  Object.keys(TIPO_META).forEach(tipo => {
    const el = $("rh-kpi-" + tipo);
    if (el) el.textContent = enRango.filter(it => it.tipo === tipo).length;
  });
}

function pintarLista(lista) {
  const cont = $("rh-list");
  cont.replaceChildren();

  if (!lista.length) {
    const vacio = document.createElement("div");
    vacio.className = "ad-empty";
    vacio.textContent = "— Sin reportes en este periodo —";
    cont.appendChild(vacio);
    return;
  }

  lista.slice(0, MAX_FILAS).forEach(it => cont.appendChild(filaReporte(it)));

  if (lista.length > MAX_FILAS) {
    const mas = document.createElement("div");
    mas.className = "rh-more";
    mas.textContent = `y ${lista.length - MAX_FILAS} reportes más en este periodo`;
    cont.appendChild(mas);
  }
}

/** <i> de Phosphor suelto, para meter dentro de un texto. */
function iconoInline(clases) {
  const i = document.createElement("i");
  i.className = clases;
  return i;
}

function filaReporte(it) {
  const meta = TIPO_META[it.tipo] || { ph: "ph-clipboard-text", color: "#5a7480" };

  const fila = document.createElement("div");
  fila.className = "rh-item";
  fila.dataset.tipo = it.tipo;

  const emoji = document.createElement("div");
  emoji.className = "rh-item-emoji";
  const icono = document.createElement("i");
  icono.className = `ph-fill ${meta.ph}`;
  icono.style.color = meta.color;
  emoji.appendChild(icono);

  const cuerpo = document.createElement("div");
  cuerpo.className = "rh-item-body";

  const linea1 = document.createElement("div");
  linea1.className = "rh-item-top";

  const quien = document.createElement("span");
  quien.className = "rh-item-name";
  quien.textContent = it.name;

  const que = document.createElement("span");
  que.className = "rh-item-tag";
  que.textContent = it.label;
  que.style.color = meta.color;

  linea1.append(quien, que);

  // Marca de confianza: "al momento" es un aviso en caliente; "hora
  // corregida" es alguien que ajustó el dato a mano antes de enviarlo.
  if (it.alMomento === true) {
    const marca = document.createElement("span");
    marca.className = "rh-item-flag rh-flag-live";
    marca.append(iconoInline("ph-fill ph-circle"), " al momento");
    marca.title = "Se reportó con la hora actual, sin editarla";
    linea1.appendChild(marca);
  } else if (it.alMomento === false) {
    const marca = document.createElement("span");
    marca.className = "rh-item-flag rh-flag-edited";
    marca.append(iconoInline("ph ph-pencil-simple"), " hora corregida");
    marca.title = "La persona ajustó la fecha o la hora antes de enviar";
    linea1.appendChild(marca);
  }

  const linea2 = document.createElement("div");
  linea2.className = "rh-item-detail";
  linea2.textContent = it.detalle || "—";

  cuerpo.append(linea1, linea2);

  const cuando = document.createElement("div");
  cuando.className = "rh-item-when";

  const fecha = document.createElement("div");
  fecha.className = "rh-item-date";
  fecha.textContent = fechaUS(it.cuando);

  const hora = document.createElement("div");
  hora.className = "rh-item-time";
  if (it.hora) hora.textContent = hm12(it.hora);
  else if (it.llegadaEstimada) hora.textContent = "llega " + hm12(it.llegadaEstimada);
  else hora.textContent = "todo el día";

  cuando.append(fecha, hora);
  cuando.title = it.reportadoAt
    ? `Enviado el ${fechaUS(it.reportadoAt)} a las ${horaDe(it.reportadoAt)}`
    : "";

  fila.append(emoji, cuerpo, cuando);
  return fila;
}

function pintarBarras(lista) {
  const canvas = $("rh-person-bars");
  if (!canvas || typeof Chart === "undefined") return;

  pedirDirectorio();

  const porPersona = new Map();
  lista.forEach(it => {
    const { key, label } = identidadDe(it);
    const acum = porPersona.get(key) || { label, n: 0 };
    acum.n += 1;
    porPersona.set(key, acum);
  });

  const orden = [...porPersona.values()].sort((a, b) => b.n - a.n).slice(0, 12);

  if (charts.persons) charts.persons.destroy();
  charts.persons = new Chart(canvas, {
    type: "bar",
    data: {
      labels: orden.map(o => o.label),
      datasets: [{ label: "Reportes", data: orden.map(o => o.n), backgroundColor: "#06a3b6", borderRadius: 6 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function pintarError(cont, detalle) {
  cont.replaceChildren();

  const iconWrap = document.createElement("div");
  iconWrap.className = "ad-error-icon";
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", "alert-triangle");
  iconWrap.appendChild(icon);

  const texto = document.createElement("div");
  texto.className = "ad-error-text";
  texto.textContent = "No pudimos cargar los reportes.";

  const det = document.createElement("div");
  det.className = "ad-error-detail";
  det.textContent = detalle || "Verifica tu conexión y las reglas de Firestore.";

  cont.append(iconWrap, texto, det);
}

// ── Arranque ───────────────────────────────────────────────────────
// rrhh.html carga este módulo directamente. Hay que esperar a que
// page-guard resuelva la sesión y el rol: antes de eso las lecturas a
// Firestore se rechazan por reglas y el panel arrancaría en error.
if (document.getElementById("rh-list")) {
  const ctx = window.HeroHubContext;
  if (ctx && ctx.readyPromise) ctx.readyPromise.then(() => initRRHHDashboard());
  else initRRHHDashboard();
}
