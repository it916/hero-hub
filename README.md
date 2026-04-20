# Hero Hub — Sub-Fase 2b (Panel de Gestión de Roles)

Agrega al admin panel un nuevo tab "Roles" para gestionar desde la UI quién tiene acceso al Hero Hub y con qué rol. Se acabó editar Firestore a mano.

---

## Qué te permite hacer este panel

- **Ver** todos los usuarios autorizados con su foto, email, rol y fecha de última actualización
- **Agregar** un usuario nuevo con email + rol (con sugerencias auto-completadas desde el equipo)
- **Cambiar** el rol de cualquier usuario haciendo click en el dropdown
- **Eliminar** un usuario (le quita el acceso inmediatamente)
- **Ver estadísticas** rápidas: cuántos usuarios tienes por cada rol
- **Filtrar** la lista por rol (ej. "ver solo agentes")
- **Buscar** por nombre, email o rol

Solo los usuarios con rol `admin` ven este panel.

---

## Archivos a subir

### Nuevos (agregar):
- `js/roles-admin.js`
- `css/roles-admin.css`

### Reemplazar (sustituyen los que ya tienes):
- `js/admin.js`
- `admin.html`

### Sin cambios:
- Todos los demás archivos del Hub quedan igual.

---

## Pasos de despliegue

**1. Sube los 4 archivos al repo** (respetando las carpetas `js/` y `css/`).

**2. Hard refresh en el navegador** (`Ctrl+Shift+R`) para que cargue los archivos nuevos.

**3. Entra al admin** (botón del escudo verde arriba a la derecha del Hub) y verás un nuevo tab llamado "Roles".

**4. Primera vez que lo abras:** verás la tabla con todos los usuarios que tengas en `shared/roles`. Si hiciste cambios de rol desde Firestore antes, se ven aquí.

---

## Migración automática de formato

Cuando cambies el rol de un usuario por primera vez desde este panel, el sistema guarda automáticamente la información enriquecida:

**Antes (formato viejo):**
```json
{ "it@heroinsuranceusa.com": "admin" }
```

**Después (formato nuevo):**
```json
{
  "it@heroinsuranceusa.com": {
    "role": "admin",
    "updatedAt": "2026-04-20T15:30:00.000Z",
    "updatedBy": "it@heroinsuranceusa.com"
  }
}
```

Esto te da un registro de quién hizo cada cambio y cuándo. Los dos formatos funcionan sin problemas — `roles.js` los lee indistintamente.

---

## Protecciones incluidas

- **`it@heroinsuranceusa.com` no se puede eliminar** desde el panel (aparece con un escudo 🛡️ en la columna de acciones). Esto es por seguridad.
- **No puedes eliminarte a ti mismo.** Si eres admin y quieres quitarte, pídele a otro admin que lo haga.
- **Si intentas cambiar tu propio rol a algo que no sea admin**, te aparece una advertencia antes de guardar, para que no te bloquees accidentalmente.
- **Solo se aceptan emails `@heroinsuranceusa.com`.** Cualquier otro dominio es rechazado.
- **No se permiten emails duplicados.** Si el email ya existe, te sugiere cambiar el rol desde la tabla.

---

## Pruebas sugeridas

**1. Cargar el panel:** abre admin.html → tab "Roles". Deberías ver la tabla con los usuarios que ya están en Firestore.

**2. Agregar un usuario de prueba:** usa el botón "Agregar usuario". Si el email pertenece a un miembro registrado en `shared/team`, aparecerán sugerencias mientras escribes.

**3. Cambiar un rol:** usa el dropdown de cualquier usuario de prueba. Debe guardar automáticamente y mostrar un mensaje verde "✓ Rol cambiado".

**4. Intentar eliminarte:** haz click en la ✕ de tu propia fila. Debe salir un alert diciendo que no puedes eliminarte.

**5. Intentar eliminar `it@heroinsuranceusa.com`:** el botón ✕ debería estar reemplazado por un escudo 🛡️ (no clickeable).

**6. Filtrar:** haz click en "Agentes" y verifica que solo muestre agentes.

---

## Qué viene después (Sub-Fase 3)

Ahora que tienes un sistema de roles robusto y fácil de gestionar, podemos avanzar a:

- **Integrar IT Console al Hub** como una nueva página `it-console.html` con permisos de admin
- **Crear módulo RRHH** absorbiendo Office Manager
- **Crear módulo Finanzas** con reportes Medicare

---

## Soporte

- Si el tab "Roles" no aparece: verifica que hayas subido `admin.html` y hecho hard refresh.
- Si el panel sale vacío: confirma que el documento `shared/roles` existe en Firestore con el campo `users`.
- Si dice "Solo los administradores pueden acceder": tu usuario no tiene rol `admin` en Firestore. Edítalo a mano una última vez y listo.
