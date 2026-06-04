# Hero Hub

**Cuartel general digital de Hero Insurance USA.** Dashboard interno con directorio, agencias, organigramas, accesos a carriers, guías, políticas, onboarding, asistencia y herramientas de administración. Acceso restringido a empleados con cuenta `@heroinsuranceusa.com`.

> Versión actual: **v2.1** · Solo uso interno.

---

## Stack

- **Frontend:** HTML + CSS + JS planos. Sin framework, sin bundler, sin paso de build.
- **Backend / datos:** Firebase Firestore.
- **Auth:** Google Sign-In, restringida al dominio corporativo.
- **Hosting:** GitHub Pages — `push a main = deploy`.
- **Librerías vía CDN:** Lucide, SortableJS, GSAP, Shoelace, Tabulator, Flatpickr (locale ES), Chart.js, Google Fonts.

---

## Páginas

| Archivo | Qué hace |
|---|---|
| `index.html` | Login + dashboard (cuartel general, banner, asistencia, misiones) |
| `admin.html` | Panel admin con sidebar y tabs (Roles, Métricas, Asistencia, Log, Carriers del equipo, Spotlight, Playlist) |
| `agencias.html` | Vista de agencias + organigrama, alimentada desde Google Sheet |
| `directorio.html` | Directorio de contactos del equipo |
| `equipo.html` | Página individual de cada miembro |
| `portales.html` | Accesos a carriers (tab Hero compartido + personales) |
| `guias.html` | Guías internas |
| `politicas.html` | Políticas |
| `onboarding.html` | Onboarding de empleados nuevos + glosario |

---

## Branding — "Hero Light"

| Token | Valor |
|---|---|
| Primario | `#06a3b6` (cyan Hero) |
| Fondo | `#f0f4f8` |
| Superficies | `#ffffff` |
| Display | Bricolage Grotesque |
| Texto / UI | Inter |
| Datos / mono | JetBrains Mono |

Variables CSS en `css/styles.css`: `--sans` (Inter), `--display` (Bricolage Grotesque).

### Modo oscuro

Toggle "Día / Noche" en el modal de Configuración. Selección persistida por usuario en Firestore (`users/{email}.theme`) y cacheada en `localStorage["hero-theme"]` para pre-aplicar el tema antes de la auth (evita el flash). Reglas bajo `body[data-theme="dark"]` en `css/styles.css` y `css/agencias.css`. Todo módulo nuevo debe contemplar ambos temas.

---

## Roles

Roles definidos en Firestore (`users/{email}.role`): `admin`, `interno`, `office`, `agente`, `it`.

- El rol se aplica como clase en `<body>` (ej. `body.role-agente`) desde `js/auth.js`, y las páginas/secciones se ocultan vía CSS o guards (`js/page-guard.js`).
- El rol **agente** tiene acceso restringido: solo Inicio (sin asistencia, onboarding ni portales), Equipo y Agencias.
- Cambios de rol se loguean en `audit-log` y requieren confirmación.

---

## Módulos clave

### Sistema de auditoría
`js/audit-log.js` expone `logEvent(ACTIONS.X, target, details)`. Cada evento se guarda en la colección `audit-log` con `timestamp`, `actor`, `actorName`, `action`, `target`, `details`. Se loguean: cambios de rol, alta/baja de usuarios, edición de carriers del equipo, cambios en directorio, eliminación de mensajes, actualización del spotlight y accesos denegados. **No** se loguean carriers personales ni logins (eso está en Métricas). Retención sugerida: 1 año (botón "Limpiar >1 año" en el panel Log).

### Asistencia
Sección "Mi Asistencia" en el dashboard con 7 acciones (entrada, salida a almuerzo, regreso, etc.) → Google Apps Script → Google Sheet. El **dashboard de asistencia** vive como tab dentro de `admin.html` y consume el mismo Sheet vía `doGet`.

### Agencias
Datos cargados desde Google Sheet (flag `AGENCIAS_SHEET_URL`). Comisiones por plan se muestran como chips. Filtro de búsqueda con match EXACTO.

### Admin shell
`admin.html` usa layout **sidebar + main** con lazy-load por tab. Para agregar un tab nuevo: registrar entrada en el sidebar + módulo JS dedicado que se inicializa al activarse.

---

## Estructura

```
hero-hub/
├── *.html                 ← páginas (ver tabla arriba)
├── css/
│   ├── styles.css         ← base + dark mode general
│   ├── agencias.css       ← vista de agencias + dark
│   ├── roles-admin.css    ← panel de roles
│   ├── audit-panel.css    ← panel de log
│   ├── directorio-filters.css
│   └── widgets.css        ← modales y widgets compartidos
├── js/
│   ├── firebase-config.js auth.js page-guard.js
│   ├── app.js widgets.js topbar-dropdown.js
│   ├── admin.js roles-admin.js audit-log.js audit-panel.js
│   ├── attendance.js asistencia-dashboard.js
│   ├── agencias.js directorio.js equipo.js portales.js
│   ├── guias.js politicas.js onboarding.js
│   ├── birthday-card.js next-meeting.js user-photo.js
│   ├── electricity.js tracker.js roles.js
├── images/ icons/
├── CLAUDE.md README.md
```

---

## Convenciones

- **Idioma de UI:** español.
- **Fechas:** `MM/DD/YYYY` (US).
- **Commits:** en español, estilo `feat(modulo): …` / `fix(modulo): …` / `chore(...): …`.
- **Sin dependencias nuevas** sin discutirlo antes.
- **Banderas:** usar SVG de `flagicons.lipis.dev` (los emoji se renderizan como texto en Windows).

---

## Despliegue

Hosting en GitHub Pages. **Push a `main` = deploy.** No hay paso de build. Para forzar refresco tras un cambio, hard refresh (`Ctrl+Shift+R`).

---

## Equipo

| Persona | Rol |
|---|---|
| Fernando Romero | IT Manager — autor y mantenedor |
| Jesús Gutiérrez | CEO |
| Anny Medina | COO |
| Aurys Rodríguez | CFO |
