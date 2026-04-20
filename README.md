# Hero Hub — Sub-Fase 2c (Log de Auditoría)

Agrega un sistema de auditoría completo al Hero Hub. Registra automáticamente las acciones importantes (cambios de roles, ediciones de carriers del equipo, cambios en el directorio, eliminación de mensajes, actualizaciones del spotlight) y te permite consultarlas desde un nuevo tab "Log" en el panel de admin.

---

## Qué registra el sistema

El log captura estos eventos automáticamente:

| Tipo | Cuándo se registra |
|---|---|
| **Usuario agregado** | Admin crea un usuario en el panel de roles |
| **Rol cambiado** | Admin cambia el rol de un usuario existente |
| **Usuario eliminado** | Admin elimina un usuario del sistema |
| **Carrier del equipo agregado/editado/eliminado** | Cambios en credenciales de Jesús o Anny |
| **Contacto agregado/editado/eliminado** | Cambios en el Directorio |
| **Mensaje eliminado** | Admin borra un mensaje de la Playlist |
| **Spotlight actualizado** | Admin cambia el Hero Spotlight |

> **Importante:** NO se registran cambios en los carriers **personales** de cada usuario (esos son privados) ni las visitas/logins (para eso está el tab "Métricas").

---

## Dónde se guarda

En Firestore, colección nueva llamada `audit-log`. Cada documento es un evento con estos campos:

- `timestamp` — cuándo pasó
- `actor` — email del que lo hizo
- `actorName` — nombre del actor
- `action` — tipo de evento (ej. `role.update`)
- `target` — email/nombre del afectado
- `details` — datos extra del cambio (ej. `{from: "agente", to: "interno"}`)

Retención: **1 año**. Hay un botón "Limpiar >1 año" en el panel para eliminar eventos antiguos manualmente cuando quieras.

---

## Archivos a subir

### Nuevos (agregar):
- `js/audit-log.js`
- `js/audit-panel.js`
- `css/audit-panel.css`

### Reemplazar (sustituyen los que ya tienes):
- `admin.html`
- `js/admin.js`
- `js/roles-admin.js`
- `js/carriers.js`
- `js/directorio.js`
- `css/roles-admin.css` (columna de fecha compactada para que ya no se superponga)

---

## Qué cambió en la columna "Última actualización" del panel de roles

Tal como pediste, la dejé pero más compacta:
- Formato de fecha cambió de "20 abr, 2026" a "20/04/26" (más corto)
- Ancho de columna reducido de 150px a 110px
- El "por [usuario]" tiene ancho máximo para que no empuje contenido

Con esto la columna respeta su espacio y no se sobrepone con la columna de rol.

---

## Instrucciones de despliegue

**1. Sube los 9 archivos al repo** (nuevos y reemplazados). Respeta las carpetas `js/` y `css/`.

**2. Hard refresh** (`Ctrl+Shift+R`) para asegurar que los archivos nuevos carguen.

**3. Entra al admin → tab "Log".** La primera vez estará vacío porque el log se genera hacia adelante, no retroactivamente.

**4. Genera eventos de prueba:** ve al tab Roles y haz un cambio pequeño (ej. cambia un rol y regrésalo a lo que estaba). Vuelve al tab Log y deberías ver tu evento registrado.

---

## Qué te permite hacer el panel Log

**Ver eventos cronológicamente** (más recientes arriba), con:
- Ícono de color según el tipo de evento (verde para crear, cyan para editar, rojo para eliminar, amarillo para alertas de seguridad)
- Acción realizada
- Sobre quién se hizo
- Detalles del cambio (ej. "Cambio: agente → interno")
- Quién lo hizo y cuándo

**Filtros disponibles:**
- Por tipo de acción (chips: Todos / Usuarios creados / Cambios de rol / Etc.)
- Por rango de fechas (7/30/90/365 días o Todo)
- Búsqueda libre por texto (busca en actor, target, acción y detalles)

**Estadísticas rápidas arriba:**
- Total de eventos en el rango seleccionado
- Usuarios únicos que generaron eventos
- Acción más frecuente

---

## Commit sugerido

```
feat: add audit log for sensitive actions
```

---

## Qué viene después

Con esto queda cerrada toda la Fase 2 (roles + panel admin + auditoría). La próxima fase puede ser:

**Fase 3 — Integrar IT Console al Hub**
Crear una página `it-console.html` dentro del Hub con el dashboard de administración IT, accesible solo para rol `admin`.

**Fase 4 — Crear módulo RRHH**
Absorbiendo las funciones actuales del Office Manager (asistencia, permisos) más funciones nuevas.

**Fase 5 — Módulo Finanzas**
Reportes Medicare integrados.

---

## Notas técnicas

- El sistema es **"fire and forget"**: si falla el logging por algún motivo, NO bloquea la acción original del usuario. Solo queda un warning en consola del navegador.
- Los eventos se guardan con `Timestamp.now()` del servidor, no del cliente, así que siempre tienen hora correcta.
- La función `logEvent()` está exportada en `audit-log.js` — si más adelante quieres loguear algo desde otro módulo, solo importas `{ logEvent, ACTIONS }` y llamas `logEvent(ACTIONS.XXX, target, details)`.
