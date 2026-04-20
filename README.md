# Hero Hub — Sub-Fase 2a (Sistema de Roles)

## Qué hace este paquete

Agrega al Hero Hub existente un **sistema de roles y permisos** para controlar qué puede ver cada usuario según su cargo:

- **admin** — ve todo, incluyendo el panel de admin
- **directivo** — ve todo excepto el panel de admin (CEO, COO, CFO)
- **rrhh** — ve Inicio, Equipo, Carriers, Directorio, Guías, Políticas, Onboarding
- **interno** — mismo alcance que rrhh (equipo interno de ventas, operaciones, etc.)
- **agente** — ve Inicio, Equipo, Carriers (solo "Mis Carriers"), Directorio, Guías, Onboarding. NO ve Políticas ni las cuentas compartidas de Jesús/Anny.

---

## PASO 1 — Crear el documento de roles en Firestore

Antes de subir nada, necesitas crear un documento en Firestore que contenga los emails de tu equipo y sus roles.

1. Abre la consola de Firebase → proyecto **hero-hub-de520** → Firestore Database.
2. Si no existe la colección `shared`, créala.
3. Dentro de `shared`, crea un documento llamado exactamente `roles` (minúsculas).
4. Agrega un campo de tipo **map** llamado `users` con esta estructura:

```
users: {
  "it@heroinsuranceusa.com": "admin",
  "ceo@heroinsuranceusa.com": "directivo",
  "coo@heroinsuranceusa.com": "directivo",
  "cfo@heroinsuranceusa.com": "directivo",
  "office@heroinsuranceusa.com": "rrhh",
  "ventas@heroinsuranceusa.com": "interno",
  "agente1@heroinsuranceusa.com": "agente"
}
```

Reemplaza los emails de ejemplo con los reales de tu equipo. Los emails deben estar **en minúsculas**.

> **Nota importante:** Si un usuario que ya usaba el Hub no está en esta lista, no podrá entrar hasta que lo agregues. Por seguridad te recomiendo agregar primero los admins y los directivos, hacer una prueba, y después ir agregando al resto.

> **Fallback de admin:** `it@heroinsuranceusa.com` siempre tiene acceso de admin aunque no esté en el documento. Esto es para que nunca te quedes fuera del sistema.

---

## PASO 2 — Subir los archivos al repo

En tu repo de GitHub del Hero Hub, **reemplaza** o **agrega** los siguientes archivos:

### Archivos NUEVOS (agregar):
- `js/roles.js` ← nuevo
- `js/page-guard.js` ← nuevo

### Archivos a REEMPLAZAR (reemplazan los que ya tienes):
- `js/auth.js`
- `js/equipo.js`
- `js/guias.js`
- `js/carriers.js`
- `js/directorio.js`
- `js/politicas.js`
- `js/onboarding.js`
- `equipo.html`
- `guias.html`

### Archivos que NO se tocan:
- `js/widgets.js` — sin cambios
- `js/birthday-card.js` — sin cambios
- `js/tracker.js` — sin cambios
- `js/app.js` — sin cambios
- `js/admin.js` — sin cambios
- `js/firebase-config.js` — sin cambios
- `index.html` — sin cambios
- `admin.html` — sin cambios
- `css/styles.css` — sin cambios

---

## PASO 3 — Editar manualmente 4 archivos HTML

Estos 4 HTMLs no te los puedo entregar ya modificados porque no tengo sus versiones originales completas. Los cambios son **muy pequeños**: solo agregar **una línea** en cada uno.

### 📄 `carriers.html`, `directorio.html`, `politicas.html`, `onboarding.html`

En cada uno de estos 4 archivos, busca al final (cerca del `</body>`) la sección que carga los scripts. Verás algo como:

```html
<script type="module" src="js/firebase-config.js"></script>
<script type="module" src="js/carriers.js"></script>
<script type="module" src="js/tracker.js"></script>
```

**Cambia a:**

```html
<script type="module" src="js/firebase-config.js"></script>
<script type="module" src="js/page-guard.js"></script>
<script type="module" src="js/carriers.js"></script>
<script type="module" src="js/tracker.js"></script>
```

Solo se agrega la línea de `page-guard.js` **entre** `firebase-config.js` y el script específico de la página. Ese orden es importante.

Haz lo mismo con los otros 3 archivos (cambiando `carriers.js` por el JS correspondiente de cada página).

---

## PASO 4 — Probar

Abre el Hub en una pestaña en incógnito y prueba:

1. **Como admin** (`it@heroinsuranceusa.com`): deberías ver todos los links del topbar incluyendo el botón de admin.
2. **Como un agente** (uno que hayas agregado a Firestore con rol `agente`): no deberías ver "Políticas" en el topbar. Si intentas entrar escribiendo `.../politicas.html` en la URL, debería redirigirte al inicio. Si entras a Carriers, deberías ver solo la pestaña "Mis Carriers".
3. **Con un email que no está en el documento**: deberías ver un mensaje "La cuenta X no tiene un rol asignado" y cerrarse la sesión.

---

## PASO 5 — Ajustar permisos después

Para agregar usuarios nuevos o cambiar roles: edita el documento `shared/roles` en Firestore. Los cambios se aplican al recargar la página (el rol se cachea por sesión).

Si quieres cambiar qué puede ver cada rol, edita `js/roles.js` — específicamente el objeto `ROLES` al inicio del archivo. Cada rol tiene un array `pages` con las páginas permitidas.

---

## Qué sigue (Sub-Fase 2b)

Una vez que este sistema esté estable y probado, las próximas mejoras serán:

- **Panel de admin para gestionar roles** (en lugar de editar Firestore a mano)
- **Módulo IT Console integrado** (fase 3)
- **Módulo RRHH integrado** (fase 4, absorbiendo Office Manager)
- **Módulo Finanzas integrado** (fase 4)

---

## Soporte

Si algo falla:
- Abre la consola del navegador (F12 → Console) y busca errores en rojo.
- El error más común será "No existe el documento shared/roles" — significa que olvidaste el Paso 1.
- Si un usuario queda bloqueado, puedes agregarlo rápidamente al documento de Firestore sin necesidad de deployment.
