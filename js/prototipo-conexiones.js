// ═══════════════════════════════════════════════════════════════
//  Prototipo — Registro de conexiones (Fase A)
// ═══════════════════════════════════════════════════════════════
// Pide al Worker el dato de conexión de quien abre la página y lo enseña.
// NO guarda nada: la Fase A existe para poder mostrar qué se capturaría
// antes de decidir si se registra a alguien.
//
// El dato viene del Worker (POST /conexion/quien-soy) y no de un servicio
// de terceros: Cloudflare ya trae la IP y la geolocalización en cada
// petición, así que ninguna IP de un empleado sale hacia fuera. Además es la
// única fuente fiable — la IP la ve el Worker, no el navegador. Si el día de
// mañana el registro lo escribiera el cliente, cualquiera podría mandar la
// IP que quisiera y el registro no serviría para lo que se pide.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { loadUserRole, filterTopbarByRole, applyRoleClasses } from "./roles.js";
import { getFreshGooglePhotoURL } from "./user-photo.js";

const WORKER_URL = "https://hero-email-worker.broad-fire-d2d6.workers.dev";

// Filas inventadas para enseñar la forma que tendría la consulta. Las IP van
// recortadas: en una maqueta que se comparte no hace falta que parezcan reales.
const EJEMPLO = [
  { persona: "Fulano Pérez",   hora: "09/18 · 09:02 AM", ip: "190.x.x.x", isp: "Digitel",  desde: "Caracas, VE" },
  { persona: "Mengana López",  hora: "09/18 · 08:47 AM", ip: "72.x.x.x",  isp: "Comcast",  desde: "Miami, FL, US" },
  { persona: "Zutano Ramírez", hora: "09/18 · 08:31 AM", ip: "186.x.x.x", isp: "Movistar", desde: "Valencia, VE" },
  { persona: "Perengana Ruiz", hora: "09/17 · 05:12 PM", ip: "201.x.x.x", isp: "Inter",    desde: "Maracaibo, VE" },
];

function pintarEjemplo() {
  const tbody = document.getElementById("proto-ejemplo");
  if (!tbody) return;
  tbody.replaceChildren();
  EJEMPLO.forEach(fila => {
    const tr = document.createElement("tr");
    [
      ["col-persona", fila.persona],
      ["col-mono", fila.hora],
      ["col-mono", fila.ip],
      ["", fila.isp],
      ["", fila.desde],
    ].forEach(([clase, texto]) => {
      const td = document.createElement("td");
      if (clase) td.className = clase;
      td.textContent = texto;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function campo(label, valor) {
  const wrap = document.createElement("div");
  const l = document.createElement("div");
  l.className = "proto-campo-label";
  l.textContent = label;
  wrap.appendChild(l);
  const v = document.createElement("div");
  v.className = "proto-campo-valor" + (valor ? "" : " vacio");
  // Un campo vacío se dice, no se deja en blanco: al enseñar esto hay que
  // poder distinguir "no lo sabemos" de "se nos olvidó pintarlo".
  v.textContent = valor || "no disponible";
  wrap.appendChild(v);
  return wrap;
}

function pintarMia(datos) {
  const cont = document.getElementById("proto-mia");
  if (!cont) return;
  cont.replaceChildren();

  const grid = document.createElement("div");
  grid.className = "proto-campos";

  const lugar = [datos.ciudad, datos.region, datos.pais].filter(Boolean).join(", ");
  grid.appendChild(campo("IP pública", datos.ip));
  grid.appendChild(campo("Proveedor (ISP)", datos.isp));
  grid.appendChild(campo("Ubicación aproximada", lugar));
  grid.appendChild(campo("Zona horaria", datos.zonaHoraria));
  cont.appendChild(grid);

  const sello = document.createElement("div");
  sello.className = "proto-sello";
  const cuando = datos.fecha
    ? new Date(datos.fecha).toLocaleString("en-US", {
        month: "2-digit", day: "2-digit", year: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : "—";
  sello.textContent = "Consultado el " + cuando + " para " + (datos.email || "tu cuenta")
    + ". Este dato no se guardó en ningún sitio.";
  cont.appendChild(sello);
}

function pintarError(mensaje) {
  const cont = document.getElementById("proto-mia");
  if (!cont) return;
  cont.replaceChildren();
  const err = document.createElement("div");
  err.className = "proto-error";
  err.textContent = mensaje;
  cont.appendChild(err);
}

async function consultarMiConexion(user) {
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch(WORKER_URL + "/conexion/quien-soy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "El servidor respondió " + resp.status);
    pintarMia(data);
  } catch (e) {
    console.warn("[prototipo-conexiones]", e && e.message);
    pintarError("No se pudo consultar la conexión: " + (e.message || "error desconocido"));
  }
}

// ── Guardia propia ───────────────────────────────────────────
// Esta página NO usa page-guard.js a propósito. page-guard exige que la
// página figure en la lista de permitidas del rol (roles.js → canAccessPage),
// y un prototipo no debería obligar a tocar la matriz de permisos ni a dejar
// rastro en shared/rolePermissions por algo que quizá se borre la semana que
// viene. Lo que sí exige, igual que el resto del Hub: sesión iniciada y cuenta
// del dominio.
//
// El rol se carga solo para filtrar el topbar, que si no mostraría enlaces
// que a un agente no le tocan.
pintarEjemplo();

onAuthStateChanged(auth, async user => {
  if (!user || !user.email.endsWith("@heroinsuranceusa.com")) {
    location.href = "index.html";
    return;
  }

  try {
    const userRole = await loadUserRole(user.email);
    if (userRole) {
      applyRoleClasses(userRole);
      filterTopbarByRole(userRole);
    }
  } catch (e) {
    // Sin rol se sigue: el prototipo no decide nada según el rol, y quedarse
    // en "Verificando acceso" por no poder pintar el topbar sería peor.
    console.warn("[prototipo-conexiones] rol no disponible:", e && e.message);
  }

  // El avatar lo carga cada página; user-menu.js solo lo copia al desplegable.
  try {
    const av = document.getElementById("user-avatar");
    if (av) av.src = await getFreshGooglePhotoURL(user);
  } catch (_) {}

  // Revelar la página. Lo hace cada página del Hub por su cuenta — page-guard
  // valida, pero no muestra nada.
  const loading = document.getElementById("loading");
  const dash = document.getElementById("dashboard");
  if (loading) loading.style.display = "none";
  if (dash) dash.style.display = "block";
  if (window.refreshIcons) window.refreshIcons();

  consultarMiConexion(user);
});
