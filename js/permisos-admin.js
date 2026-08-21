// ═══════════════════════════════════════════
// Hero Hub · Panel de Permisos por rol
// ═══════════════════════════════════════════
// Vive en admin.html bajo el tab "Permisos". Edita shared/rolePermissions,
// el doc que js/roles.js lee al arrancar para decidir qué páginas y qué
// features ve cada rol.
//
// Lo que NO hace, a propósito:
//   - No crea ni elimina roles. Las claves son código (DEFAULT_ROLES).
//   - No toca el rol admin: siempre ve todo, y las casillas van bloqueadas.
//   - No permite desmarcar index ni mi-perfil: sin ellas el usuario queda
//     en un redirect infinito o con el menú del avatar roto.
//
// Importante: esto controla VISIBILIDAD, no acceso a los datos. Quien teclee
// la URL directa o abra la consola sigue topándose únicamente con las reglas
// de Firestore. Por eso la pantalla lo dice en un aviso, para que nadie
// suponga que desmarcar una casilla protege información.

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  DEFAULT_ROLES, FEATURES, PAGE_LABELS, PAGINAS_OBLIGATORIAS,
  loadRolesCatalog
} from "./roles.js";
import { logEvent, ACTIONS } from "./audit-log.js";

const DOC_REF = () => doc(db, "shared", "rolePermissions");

// Orden de los roles en las columnas (admin primero, agente al final)
const ORDEN_ROLES = ["admin", "interno", "it", "agente"];

// Orden preferido de las filas: primero las páginas que casi todos comparten,
// al final las restringidas. Es solo una preferencia de presentación — las
// páginas que no estén aquí se añaden al final igualmente. Sin eso, agregar
// una página a PAGE_LABELS y olvidarla en esta lista la dejaría sin fila en
// la matriz, invisible y sin ningún error que lo avisara.
const ORDEN_PREFERIDO = [
  "index", "equipo", "portales", "mi-perfil", "changelog",
  "agencias", "directorio", "guias", "politicas", "onboarding",
  "reuniones", "grabaciones", "contracting", "solicitud-cuenta",
  "finanzas", "finanzas-manual", "it-console", "admin"
];

function paginasOrdenadas() {
  const todas = Object.keys(PAGE_LABELS);
  const primero = ORDEN_PREFERIDO.filter(p => todas.includes(p));
  const resto = todas.filter(p => !primero.includes(p));
  return [...primero, ...resto];
}

let estado = null;        // { [rol]: { pages:Set, features:Set } }
let estadoOriginal = null;
let meta = { updatedAt: null, updatedBy: null };
let adminEmail = null;

// ═══════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════

export async function initPermisosPanel(emailDelAdmin) {
  adminEmail = emailDelAdmin || null;
  await cargar();
  render();
}

// ═══════════════════════════════════════════
// CARGA
// ═══════════════════════════════════════════

async function cargar() {
  let guardado = null;
  try {
    const snap = await getDoc(DOC_REF());
    if (snap.exists()) {
      const data = snap.data();
      guardado = data.roles || null;
      meta = { updatedAt: data.updatedAt || null, updatedBy: data.updatedBy || null };
    }
  } catch (e) {
    console.warn("[permisos] No se pudo leer shared/rolePermissions:", e.message);
  }

  estado = {};
  for (const rol of ORDEN_ROLES) {
    const base = DEFAULT_ROLES[rol];
    if (!base) continue;
    const remoto = guardado && guardado[rol];
    estado[rol] = {
      pages: new Set(remoto && Array.isArray(remoto.pages) ? remoto.pages : base.pages),
      features: new Set(remoto && Array.isArray(remoto.features) ? remoto.features : base.features)
    };
  }
  estadoOriginal = clonarEstado(estado);
}

function clonarEstado(origen) {
  const copia = {};
  for (const rol of Object.keys(origen)) {
    copia[rol] = {
      pages: new Set(origen[rol].pages),
      features: new Set(origen[rol].features)
    };
  }
  return copia;
}

/**
 * Qué cambió respecto a lo guardado, por rol. Va al audit log: sin esto el
 * registro solo dice "alguien tocó los permisos", que es tanto como nada
 * cuando dentro de unos meses haya que averiguar por qué un rol perdió algo.
 * Devuelve {} si no hay diferencias.
 */
function calcularDiff() {
  const diff = {};
  for (const rol of Object.keys(estado)) {
    const antes = estadoOriginal[rol];
    const ahora = estado[rol];

    const cambios = {};
    const pagesQuitadas  = [...antes.pages].filter(p => !ahora.pages.has(p));
    const pagesAgregadas = [...ahora.pages].filter(p => !antes.pages.has(p));
    const featsQuitadas  = [...antes.features].filter(f => !ahora.features.has(f));
    const featsAgregadas = [...ahora.features].filter(f => !antes.features.has(f));

    if (pagesQuitadas.length)  cambios.paginasQuitadas  = pagesQuitadas;
    if (pagesAgregadas.length) cambios.paginasAgregadas = pagesAgregadas;
    if (featsQuitadas.length)  cambios.featuresQuitadas = featsQuitadas;
    if (featsAgregadas.length) cambios.featuresAgregadas = featsAgregadas;

    if (Object.keys(cambios).length) diff[rol] = cambios;
  }
  return diff;
}

function hayCambios() {
  for (const rol of Object.keys(estado)) {
    const a = estado[rol], b = estadoOriginal[rol];
    if (a.pages.size !== b.pages.size || a.features.size !== b.features.size) return true;
    for (const p of a.pages) if (!b.pages.has(p)) return true;
    for (const f of a.features) if (!b.features.has(f)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
// Se construye con DOM API en vez de innerHTML: son ~90 casillas con
// listeners y así no hay que re-parsear ni delegar eventos.

function render() {
  const cont = document.getElementById("permisos-content");
  if (!cont) return;
  cont.replaceChildren();

  cont.appendChild(construirAviso());

  const avisos = document.createElement("div");
  avisos.id = "perm-avisos";
  cont.appendChild(avisos);
  cont.appendChild(construirTabla("Páginas", filasDePaginas(), "pages"));
  cont.appendChild(construirTabla("Features", filasDeFeatures(), "features"));
  cont.appendChild(construirPie());

  avisosDeCoherencia();
  actualizarBotonGuardar();
  if (window.refreshIcons) window.refreshIcons();
}

function construirAviso() {
  const box = document.createElement("div");
  box.className = "perm-aviso";

  const icono = document.createElement("i");
  icono.setAttribute("data-lucide", "shield-alert");
  box.appendChild(icono);

  const texto = document.createElement("div");
  const fuerte = document.createElement("strong");
  fuerte.textContent = "Esto controla lo que se ve, no lo que se puede leer. ";
  texto.appendChild(fuerte);
  texto.appendChild(document.createTextNode(
    "Quien escriba la dirección de una página directamente sigue topándose solo con las reglas de Firestore. " +
    "Para proteger datos hay que cambiar las reglas, no estas casillas."
  ));
  box.appendChild(texto);
  return box;
}

function filasDePaginas() {
  return paginasOrdenadas().map(p => ({
    clave: p,
    etiqueta: PAGE_LABELS[p],
    obligatoria: PAGINAS_OBLIGATORIAS.includes(p),
    grupo: null,
    nota: null
  }));
}

function filasDeFeatures() {
  const claves = Object.keys(FEATURES);
  const grupos = [];
  for (const clave of claves) {
    const f = FEATURES[clave];
    if (!grupos.includes(f.group)) grupos.push(f.group);
  }
  const filas = [];
  for (const grupo of grupos) {
    let primeraDelGrupo = true;
    for (const clave of claves) {
      if (FEATURES[clave].group !== grupo) continue;
      filas.push({
        clave,
        etiqueta: FEATURES[clave].label,
        obligatoria: false,
        grupo: primeraDelGrupo ? grupo : null,
        nota: FEATURES[clave].nota || null
      });
      primeraDelGrupo = false;
    }
  }
  return filas;
}

function construirTabla(titulo, filas, tipo) {
  const seccion = document.createElement("section");
  seccion.className = "perm-seccion";

  const h = document.createElement("h3");
  h.className = "perm-seccion-titulo";
  h.textContent = titulo;
  seccion.appendChild(h);

  const wrap = document.createElement("div");
  wrap.className = "perm-tabla-wrap";

  const tabla = document.createElement("table");
  tabla.className = "perm-tabla";

  // Cabecera
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  const thVacio = document.createElement("th");
  thVacio.className = "perm-col-nombre";
  trh.appendChild(thVacio);
  for (const rol of ORDEN_ROLES) {
    const th = document.createElement("th");
    th.textContent = DEFAULT_ROLES[rol].label;
    if (DEFAULT_ROLES[rol].isAdmin) th.classList.add("perm-col-bloqueada");
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  tabla.appendChild(thead);

  // Cuerpo
  const tbody = document.createElement("tbody");
  for (const fila of filas) {
    if (fila.grupo) {
      const trg = document.createElement("tr");
      const tdg = document.createElement("td");
      tdg.className = "perm-grupo";
      tdg.colSpan = ORDEN_ROLES.length + 1;
      tdg.textContent = fila.grupo;
      trg.appendChild(tdg);
      tbody.appendChild(trg);
    }
    tbody.appendChild(construirFila(fila, tipo));
  }
  tabla.appendChild(tbody);

  wrap.appendChild(tabla);
  seccion.appendChild(wrap);
  return seccion;
}

function construirFila(fila, tipo) {
  const tr = document.createElement("tr");

  const tdNombre = document.createElement("td");
  tdNombre.className = "perm-col-nombre";
  tdNombre.appendChild(document.createTextNode(fila.etiqueta));
  if (fila.nota) {
    const nota = document.createElement("span");
    nota.className = "perm-nota";
    nota.textContent = fila.nota;
    tdNombre.appendChild(nota);
  }
  tr.appendChild(tdNombre);

  for (const rol of ORDEN_ROLES) {
    const td = document.createElement("td");
    td.className = "perm-celda";

    const esAdmin = !!DEFAULT_ROLES[rol].isAdmin;
    const bloqueada = esAdmin || fila.obligatoria;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "perm-check";
    check.checked = esAdmin ? true : estado[rol][tipo].has(fila.clave);
    check.disabled = bloqueada;
    check.setAttribute("aria-label", `${fila.etiqueta} · ${DEFAULT_ROLES[rol].label}`);
    if (bloqueada) {
      check.title = esAdmin
        ? "El rol Administrador siempre ve todo"
        : "Esta página no se puede quitar: el usuario quedaría sin a dónde ir";
    }

    check.addEventListener("change", () => {
      if (check.checked) estado[rol][tipo].add(fila.clave);
      else estado[rol][tipo].delete(fila.clave);
      avisosDeCoherencia();
      actualizarBotonGuardar();
    });

    td.appendChild(check);
    tr.appendChild(td);
  }

  tr.dataset.clave = fila.clave;
  tr.dataset.tipo = tipo;
  return tr;
}

function construirPie() {
  const pie = document.createElement("div");
  pie.className = "perm-pie";

  const info = document.createElement("div");
  info.className = "perm-pie-info";
  info.id = "perm-meta";
  info.textContent = textoMeta();
  pie.appendChild(info);

  const acciones = document.createElement("div");
  acciones.className = "perm-pie-acciones";

  const restaurar = document.createElement("button");
  restaurar.type = "button";
  restaurar.className = "btn-ghost-dark";
  restaurar.textContent = "Restaurar valores por defecto";
  restaurar.addEventListener("click", restaurarDefaults);
  acciones.appendChild(restaurar);

  const guardar = document.createElement("button");
  guardar.type = "button";
  guardar.className = "btn-primary";
  guardar.id = "perm-guardar";
  guardar.textContent = "Guardar cambios";
  guardar.addEventListener("click", guardarCambios);
  acciones.appendChild(guardar);

  pie.appendChild(acciones);
  return pie;
}

function textoMeta() {
  if (!meta.updatedAt) return "Sin cambios guardados todavía — el Hub usa los valores por defecto.";
  const f = new Date(meta.updatedAt);
  const fecha = `${String(f.getMonth() + 1).padStart(2, "0")}/${String(f.getDate()).padStart(2, "0")}/${f.getFullYear()}`;
  const hora = f.toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
  return `Última edición: ${meta.updatedBy || "—"} · ${fecha} ${hora}`;
}

function actualizarBotonGuardar() {
  const btn = document.getElementById("perm-guardar");
  if (!btn) return;
  const cambios = hayCambios();
  btn.disabled = !cambios;
  btn.textContent = cambios ? "Guardar cambios" : "Sin cambios";
}

// ═══════════════════════════════════════════
// COHERENCIA
// ═══════════════════════════════════════════
// Combinaciones que no rompen nada pero dejan al usuario mirando un botón
// que no lleva a ninguna parte. Se avisa, no se impide.

const REGLAS_COHERENCIA = [
  {
    feature: "tile-correos",
    pagina: "solicitud-cuenta",
    mensaje: 'El tile "Correos" lleva a Solicitud de cuenta: sin esa página, el usuario acaba rebotado al inicio.'
  },
  {
    feature: "tile-finanzas",
    pagina: "finanzas",
    mensaje: 'El tile "Finanzas" lleva a la página de Finanzas, que ese rol no tiene habilitada.'
  },
  {
    feature: "tile-it-console",
    pagina: "it-console",
    mensaje: 'El tile "IT Console" lleva a una página que ese rol no tiene habilitada.'
  },
  {
    feature: "admin-migracion",
    pagina: "admin",
    mensaje: "Los tabs de migración viven dentro del panel de Admin, al que ese rol no entra."
  }
];

function avisosDeCoherencia() {
  const cont = document.getElementById("perm-avisos");
  if (!cont) return;
  cont.replaceChildren();

  const problemas = [];
  for (const rol of ORDEN_ROLES) {
    if (DEFAULT_ROLES[rol].isAdmin) continue;
    for (const regla of REGLAS_COHERENCIA) {
      if (estado[rol].features.has(regla.feature) && !estado[rol].pages.has(regla.pagina)) {
        problemas.push(`${DEFAULT_ROLES[rol].label}: ${regla.mensaje}`);
      }
    }
  }

  if (!problemas.length) return;

  const box = document.createElement("div");
  box.className = "perm-coherencia";
  const titulo = document.createElement("strong");
  titulo.textContent = problemas.length === 1 ? "Hay una combinación incoherente:" : `Hay ${problemas.length} combinaciones incoherentes:`;
  box.appendChild(titulo);

  const lista = document.createElement("ul");
  for (const p of problemas) {
    const li = document.createElement("li");
    li.textContent = p;
    lista.appendChild(li);
  }
  box.appendChild(lista);
  cont.appendChild(box);
}

// ═══════════════════════════════════════════
// ACCIONES
// ═══════════════════════════════════════════

async function restaurarDefaults() {
  const ok = await window.heroConfirm?.({
    title: "Restaurar valores por defecto",
    message: "Se descartan los permisos configurados y vuelve la configuración original del Hub. Todavía tendrás que pulsar Guardar para publicarlo.",
    confirmLabel: "Restaurar",
    variant: "warning"
  });
  if (ok === false) return;

  for (const rol of ORDEN_ROLES) {
    const base = DEFAULT_ROLES[rol];
    estado[rol] = { pages: new Set(base.pages), features: new Set(base.features) };
  }
  render();
  avisosDeCoherencia();
  // Con window. delante a propósito: el optional chaining no protege de un
  // ReferenceError si el identificador no está declarado, solo de null.
  window.heroToast?.info("Valores por defecto cargados. Pulsa Guardar para publicarlos.");
}

async function guardarCambios() {
  const btn = document.getElementById("perm-guardar");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  // Se calcula antes de mover estadoOriginal, que es contra lo que se compara.
  const diff = calcularDiff();

  const roles = {};
  for (const rol of ORDEN_ROLES) {
    const base = DEFAULT_ROLES[rol];
    // El rol admin se guarda siempre completo, pase lo que pase en la UI.
    roles[rol] = base.isAdmin
      ? { pages: Object.keys(PAGE_LABELS), features: Object.keys(FEATURES) }
      : { pages: [...estado[rol].pages], features: [...estado[rol].features] };
  }

  const payload = {
    roles,
    updatedAt: new Date().toISOString(),
    updatedBy: adminEmail || "—"
  };

  try {
    await setDoc(DOC_REF(), payload);
    meta = { updatedAt: payload.updatedAt, updatedBy: payload.updatedBy };
    estadoOriginal = clonarEstado(estado);

    // Refrescar el catálogo en memoria y en localStorage para que el propio
    // admin vea el efecto sin recargar de más.
    await loadRolesCatalog({ force: true });

    await logEvent(ACTIONS.PERMISOS_UPDATE, adminEmail, {
      rolesAfectados: Object.keys(diff),
      cambios: diff
    });

    const metaEl = document.getElementById("perm-meta");
    if (metaEl) metaEl.textContent = textoMeta();
    window.heroToast?.success("Permisos guardados. Aplican en el próximo ingreso de cada usuario.");
  } catch (e) {
    console.error("[permisos] Error guardando:", e);
    window.heroToast?.error("No se pudieron guardar los permisos: " + e.message);
  } finally {
    actualizarBotonGuardar();
  }
}
