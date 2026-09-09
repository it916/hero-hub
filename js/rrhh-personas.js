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

import { getAllUsers, countryLabel, countryFlagUrl } from "./user-store.js";
import { getAllHrData, saveHrData } from "./hr-store.js";
import { getItemsEnRango, getEtiquetaRango, onDatosActualizados } from "./rrhh-dashboard.js";

const TIPO_EMOJI = {
  "ausencia": "🚫",
  "retraso": "⏰",
  "corte-electrico": "⚡",
  "falla-internet": "📶",
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

const $ = id => document.getElementById(id);

let personas = [];
let hrData = new Map();    // email -> { city, address, startDate, schedule, docsUrl }
let seleccionada = null;   // email
let editando = false;

// Devuelve siempre un objeto, aunque la persona no tenga ficha todavia.
function hrDe(email) {
  return hrData.get(email) || { city: null, address: null, startDate: null, schedule: null, docsUrl: null };
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

// identity.birthdate se guarda como MM/DD (sin año) o MM/DD/YYYY.
function cumpleTexto(birthdate) {
  if (!birthdate) return "";
  const [m, d] = String(birthdate).split("/").map(Number);
  if (!m || !d) return String(birthdate);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${d} de ${meses[m - 1] || "?"}`;
}

function horarioTexto(schedule) {
  if (!schedule || !schedule.from || !schedule.to) return "";
  const dias = Array.isArray(schedule.days) ? schedule.days : [];
  let cuando = "";
  if (dias.length) {
    const ord = DIAS.filter(d => dias.includes(d.n));
    // Lunes a viernes es el caso normal: se dice así en vez de listar cinco.
    const esLaV = dias.length === 5 && [1, 2, 3, 4, 5].every(n => dias.includes(n));
    cuando = esLaV ? "lunes a viernes" : ord.map(d => d.largo).join(", ");
  }
  return `${hm12(schedule.from)} – ${hm12(schedule.to)}${cuando ? " · " + cuando : ""}`;
}

// ── Helpers de DOM ─────────────────────────────────────────────────
function el(tag, className, texto) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (texto != null) n.textContent = texto;
  return n;
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

function seleccionar(email) {
  seleccionada = email;
  editando = false;
  pintarLista();
  pintarFicha();
}

// ── Ficha ──────────────────────────────────────────────────────────
function pintarFicha() {
  const vacio = $("rh-card-empty");
  const cuerpo = $("rh-card-body");
  if (!cuerpo) return;

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

  const iso = p.identity?.country || "";
  const ciudad = hrDe(p._email).city || "";
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

  caja.appendChild(dato("Horario asignado", horarioTexto(hr.schedule)));

  const inicio = hr.startDate;
  const anos = antiguedad(inicio);
  caja.appendChild(dato("En Hero desde", inicio ? `${inicio}${anos ? " · " + anos : ""}` : ""));

  caja.appendChild(dato("Cumpleaños", cumpleTexto(p.identity?.birthdate)));

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

  const fila1 = el("div", "rh-form-row");
  fila1.append(campo("Ciudad", ciudad), campo("En Hero desde", inicio));

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
    fila1,
    fila2,
    campo("Días de trabajo", chips),
    campo("Dirección completa", direccion),
    campoDocs,
    acciones
  );

  // Flatpickr sobre la fecha de ingreso, con el mismo formato US del Hub.
  if (typeof flatpickr === "function") {
    flatpickr(inicio, { locale: "es", dateFormat: "m/d/Y", allowInput: true });
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

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    const ficha = {
      city: ciudad || null,
      address: direccion || null,
      startDate: inicio || null,
      schedule: from && to ? { from, to, days } : null,
      docsUrl: docsUrl || null,
    };
    await saveHrData(p._email, ficha);

    // Se actualiza la copia en memoria para no releer toda la colección.
    hrData.set(p._email, ficha);

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

  const suyos = getItemsEnRango().filter(it => it.email === p._email);

  const resumen = el("div", "rh-mini-kpis");
  Object.entries(TIPO_EMOJI).forEach(([tipo, emoji]) => {
    const n = suyos.filter(it => it.tipo === tipo).length;
    const kpi = el("div", "rh-mini-kpi");
    if (!n) kpi.classList.add("cero");
    kpi.appendChild(el("span", "rh-mini-emoji", emoji));
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
    fila.appendChild(el("span", "rh-mini-row-emoji", TIPO_EMOJI[it.tipo] || "📋"));
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
      // #rh-content lo muestra/oculta el dashboard con style.display; un
      // atributo `hidden` no le ganaria a un display:block inline.
      const general = $("rh-content");
      const personas_ = $("rh-personas");
      if (general) general.style.display = vista === "general" ? "block" : "none";
      if (personas_) personas_.hidden = vista !== "personas";
      // El historial de asistencia pertenece a la vista general.
      const hist = $("rh-history");
      if (hist) hist.hidden = vista !== "general";

      if (vista === "personas" && !personas.length) cargarPersonas();
      if (window.refreshIcons) window.refreshIcons();
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────
function init() {
  if (!$("rh-people-list")) return;

  bindVistas();

  const filtro = $("rh-people-filter");
  if (filtro) filtro.addEventListener("input", pintarLista);

  // Cuando cambia el rango de fechas arriba, la ficha abierta se repinta.
  onDatosActualizados(() => { if (seleccionada) pintarFicha(); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
