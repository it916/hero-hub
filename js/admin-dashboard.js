// ═══════════════════════════════════════════
// Hero Hub · Admin — Panel general
// ═══════════════════════════════════════════
// Primera pestaña de admin.html desde v2.49.0. Antes se entraba directo a
// Métricas, que es una pantalla de análisis: para saber quién es el héroe del
// mes o cuánta gente hay activa había que ir tab por tab.
//
// Resume tres cosas que viven en sitios distintos:
//
//   · Spotlight → shared/spotlight (los honorees se resuelven contra users/)
//   · Equipo    → users/{email}: cuántos hay, cuántos activos, reparto por rol
//   · Actividad → events de los últimos 30 días
//
// No guarda nada ni edita nada: cada tarjeta lleva a la pestaña que sí lo hace.

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAllUsers } from "./user-store.js";
import { DEFAULT_ROLES } from "./roles.js";

const $ = id => document.getElementById(id);

const DIAS_ACTIVIDAD = 30;

function el(tag, className, texto) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (texto != null) n.textContent = texto;
  return n;
}

// Lleva a otra pestaña disparando el click del sidebar, para no duplicar aquí
// la lógica de mostrar/ocultar secciones que vive en el script de admin.html.
function irA(tab) {
  document.querySelector(`.admin-sidebar-link[data-tab="${tab}"]`)?.click();
}

function botonIr(texto, tab) {
  const b = el("button", "adash-link", texto);
  b.type = "button";
  b.addEventListener("click", () => irA(tab));
  const i = document.createElement("i");
  i.className = "ph ph-arrow-right";
  b.appendChild(i);
  return b;
}


// ── Héroe del mes ──────────────────────────────────────────────────
function pintarSpotlight(spotlight, usuarios) {
  const caja = $("adash-spotlight");
  if (!caja) return;
  caja.replaceChildren();

  caja.appendChild(el("div", "adash-card-title", "Héroe del mes"));

  const honorees = Array.isArray(spotlight?.honorees) ? spotlight.honorees : [];
  if (!honorees.length) {
    caja.appendChild(el("div", "ad-empty", "— Sin nadie destacado ahora mismo —"));
    caja.appendChild(botonIr("Elegir a alguien", "spotlight"));
    return;
  }

  const porEmail = new Map(usuarios.map(u => [String(u._email).toLowerCase(), u]));

  // El Spotlight admite hasta tres destacados. Apilados en vertical estiraban
  // la tarjeta y descuadraban la rejilla, asi que a partir de dos se pasa a
  // fila: foto arriba, nombre debajo, repartidos a lo ancho.
  const lista = el("div", "adash-honorees");
  if (honorees.length > 1) lista.classList.add("en-fila");

  for (const h of honorees) {
    // Los honorees viejos guardaban name/role a mano; los nuevos, solo el
    // email, y el nombre y la foto salen de users/ ([[project_users_refactor]]).
    const u = h.email ? porEmail.get(String(h.email).toLowerCase()) : null;
    const nombre = u?.identity?.name || h.name || h.email || "—";
    const cargo = u?.display?.jobTitle || h.role || "";
    const foto = u?.identity?.photo || "";

    const fila = el("div", "adash-honoree");
    const img = document.createElement("img");
    img.className = "adash-honoree-photo";
    img.alt = "";
    img.src = foto || "images/heroe.png";
    fila.appendChild(img);

    const datos = el("div", "adash-honoree-info");
    datos.appendChild(el("div", "adash-honoree-name", nombre));
    if (cargo) datos.appendChild(el("div", "adash-honoree-role", cargo));
    fila.appendChild(datos);

    lista.appendChild(fila);
  }
  caja.appendChild(lista);

  if (spotlight.message) {
    caja.appendChild(el("blockquote", "adash-quote", spotlight.message));
  }
  caja.appendChild(botonIr("Editar Spotlight", "spotlight"));
}


// ── Equipo ─────────────────────────────────────────────────────────
function pintarEquipo(usuarios) {
  const caja = $("adash-equipo");
  if (!caja) return;
  caja.replaceChildren();

  caja.appendChild(el("div", "adash-card-title", "Equipo"));

  const total = usuarios.length;
  const activos = usuarios.filter(u => u.access?.active !== false).length;

  const cifra = el("div", "adash-big");
  cifra.appendChild(el("span", "adash-big-n", String(total)));
  cifra.appendChild(el("span", "adash-big-lbl", total === 1 ? "persona" : "personas"));
  caja.appendChild(cifra);

  const sub = `${activos} con acceso · ${total - activos} desactivada${total - activos === 1 ? "" : "s"}`;
  caja.appendChild(el("div", "adash-sub", sub));

  // Reparto por rol. Se cuenta con la misma clave que usa el catálogo, así que
  // un rol retirado que siga en algún documento aparece como "sin rol".
  const porRol = new Map();
  for (const u of usuarios) {
    const rol = u.access?.role;
    const clave = rol && DEFAULT_ROLES[rol] ? rol : "—";
    porRol.set(clave, (porRol.get(clave) || 0) + 1);
  }

  const chips = el("div", "adash-chips");
  for (const [rol, n] of [...porRol.entries()].sort((a, b) => b[1] - a[1])) {
    const etiqueta = DEFAULT_ROLES[rol]?.label || "Sin rol";
    chips.appendChild(el("span", "adash-chip", `${etiqueta} · ${n}`));
  }
  caja.appendChild(chips);

  caja.appendChild(botonIr("Gestionar usuarios", "roles"));
}


// ── Actividad ──────────────────────────────────────────────────────
function pintarActividad(eventos) {
  const caja = $("adash-actividad");
  if (!caja) return;
  caja.replaceChildren();

  caja.appendChild(el("div", "adash-card-title", `Actividad · últimos ${DIAS_ACTIVIDAD} días`));

  if (!eventos.length) {
    caja.appendChild(el("div", "ad-empty", "— Sin visitas registradas en este periodo —"));
    caja.appendChild(botonIr("Ver métricas", "metrics"));
    return;
  }

  const personas = new Set(eventos.map(e => e.email)).size;
  const porPagina = new Map();
  for (const e of eventos) porPagina.set(e.page, (porPagina.get(e.page) || 0) + 1);
  const top = [...porPagina.entries()].sort((a, b) => b[1] - a[1])[0];

  const resumen = el("div", "adash-stats");
  const stat = (n, l) => {
    const s = el("div", "adash-stat");
    s.appendChild(el("span", "adash-stat-n", n));
    s.appendChild(el("span", "adash-stat-lbl", l));
    return s;
  };
  resumen.appendChild(stat(eventos.length.toLocaleString("es"), "visitas"));
  resumen.appendChild(stat(String(personas), personas === 1 ? "persona" : "personas"));
  resumen.appendChild(stat(top ? top[0] : "—", "la más vista"));
  caja.appendChild(resumen);

  // Mini gráfico: una barra por día, con la altura relativa al día más alto.
  // La columna necesita altura propia o el porcentaje no resuelve — el mismo
  // fallo que tenía el gráfico grande hasta v2.48.1.
  const porDia = new Map();
  for (let i = DIAS_ACTIVIDAD - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    porDia.set(clave(d), 0);
  }
  for (const e of eventos) {
    const d = e.timestamp?.toDate?.();
    if (!d) continue;
    const k = clave(d);
    if (porDia.has(k)) porDia.set(k, porDia.get(k) + 1);
  }
  const maximo = Math.max(...porDia.values(), 1);

  const spark = el("div", "adash-spark");
  for (const [dia, n] of porDia) {
    const col = el("div", "adash-spark-col");
    col.title = `${dia}: ${n} ${n === 1 ? "visita" : "visitas"}`;
    const barra = el("div", "adash-spark-bar");
    barra.style.height = `${(n / maximo) * 100}%`;
    if (n) barra.classList.add("con-valor");
    col.appendChild(barra);
    spark.appendChild(col);
  }
  caja.appendChild(spark);

  caja.appendChild(botonIr("Ver métricas", "metrics"));
}

function clave(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// ── Carga ──────────────────────────────────────────────────────────
let cargado = false;

window.loadAdminDashboard = async function ({ force = false } = {}) {
  if (cargado && !force) return;
  cargado = true;

  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_ACTIVIDAD);

  try {
    // Las tres fuentes en paralelo: ninguna depende de las otras.
    const [spSnap, usuarios, evSnap] = await Promise.all([
      getDoc(doc(db, "shared", "spotlight")),
      getAllUsers({ includeExcluded: true }),
      getDocs(query(
        collection(db, "events"),
        where("timestamp", ">=", Timestamp.fromDate(desde)),
        orderBy("timestamp", "desc"),
      )),
    ]);

    pintarSpotlight(spSnap.exists() ? spSnap.data() : null, usuarios);
    pintarEquipo(usuarios);
    pintarActividad(evSnap.docs.map(d => d.data()));
  } catch (e) {
    console.error("admin-dashboard:", e);
    cargado = false;   // que un fallo de red no deje el panel vacío para siempre
    const aviso = $("adash-error");
    if (aviso) {
      aviso.textContent = `No se pudo cargar el panel: ${e.message}`;
      aviso.hidden = false;
    }
  }
};
