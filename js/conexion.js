// ═══════════════════════════════════════════
// Hero Hub · Registro de conexión
// ═══════════════════════════════════════════
// Deja constancia de desde dónde entra cada persona al Hub: IP pública,
// proveedor y ubicación aproximada. Administración pidió ese registro.
//
// Se dispara solo al iniciar sesión — no hay botón que pulsar. Se engancha en
// los dos puntos de entrada del Hub: js/auth.js (login en index.html) y
// js/page-guard.js (quien llega directo a otra página con la sesión ya viva).
//
// QUIÉN VE QUÉ: cada persona ve su propio registro en Mi Perfil. El del equipo
// entero solo lo consulta quien esté en CONEXIONES_ADMIN_EMAILS dentro del
// Worker. Se conserva 90 días y luego se borra solo.
//
// EL DATO NO LO PONE EL NAVEGADOR: lo lee el Worker de la propia petición
// (Cloudflare ya trae IP y geolocalización en cada una). Si lo mandara el
// cliente, cualquiera podría escribir la IP que quisiera y el registro no
// serviría para lo que se pide. Aquí solo se avisa de que alguien entró.
//
// Lo que este registro NO puede decir, y conviene no olvidar:
//   · una VPN lo desvía — se anota por dónde sale la conexión, no dónde está
//     la persona;
//   · la ciudad es aproximada, a veces la del nodo del proveedor;
//   · solo ve a quien abra el Hub. Quien trabaje la jornada entera en el CRM
//     no aparece. El historial de Google Workspace no tiene ese hueco.

const WORKER_URL = "https://hero-email-worker.broad-fire-d2d6.workers.dev";

// Una vez por pestaña. El Worker deduplica de todos modos (si ya hay entrada
// de hoy con la misma IP, actualiza esa en vez de crear otra), pero sin esta
// marca cada navegación entre páginas del Hub sería una petición más, y el
// límite del Worker es por IP — en una oficina con IP compartida, quince
// personas navegando lo agotarían entre todas.
const MARCA = "hero-conexion-registrada";


export async function registrarConexion(user) {
  if (!user || !user.email) return null;

  try {
    if (sessionStorage.getItem(MARCA)) return null;
  } catch (_) {
    // Sin sessionStorage (modo privado, navegador restringido) se registra
    // igual: mejor una petición de más que perder el registro.
  }

  try {
    const idToken = await user.getIdToken();
    const resp = await fetch(WORKER_URL + "/conexion/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "El servidor respondió " + resp.status);

    try { sessionStorage.setItem(MARCA, "1"); } catch (_) {}
    return data;
  } catch (e) {
    // Nunca se propaga: que falle el registro no puede impedirle a nadie
    // entrar a trabajar. Queda el aviso en consola y ya.
    console.warn("[conexion] no se pudo registrar:", e && e.message);
    return null;
  }
}

// Las conexiones de quien pregunta, para la sección de Mi Perfil. Reusa el
// mismo endpoint: registrar devuelve también el historial propio, así que
// pedirlas no cuesta una llamada aparte.
export async function misConexiones(user) {
  if (!user || !user.email) return [];
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch(WORKER_URL + "/conexion/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "El servidor respondió " + resp.status);
    return Array.isArray(data.registros) ? data.registros : [];
  } catch (e) {
    console.warn("[conexion] no se pudo leer el historial:", e && e.message);
    return [];
  }
}
