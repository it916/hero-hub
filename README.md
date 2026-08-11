# Hero Hub

**Cuartel general digital de Hero Insurance USA.** Dashboard interno del equipo con directorio, agencias, portales de carriers, guías, políticas, asistencia, contracting, finanzas, IT Console y herramientas de administración. Acceso restringido a empleados con cuenta `@heroinsuranceusa.com`.

> Versión actual: **v2.32.3** · Solo uso interno · `hub.heroinsuranceusa.com`

---

## Stack

- **Frontend:** HTML + CSS + JavaScript planos. Sin framework, sin bundler, sin paso de build.
- **Backend / datos:** Firebase Firestore.
- **Backend adicional:** Cloudflare Worker (`hero-email-worker` — vive en repo aparte `hero-it-console/`) para operaciones que requieren keys server-side: creación de usuarios Google Workspace, envío de emails via Resend, tickets de soporte, adjuntos R2.
- **Storage adicional:** Cloudflare R2 (`hero-tickets-attachments`) para adjuntos de tickets.
- **Auth:** Google Sign-In, restringida al dominio corporativo.
- **Hosting:** GitHub Pages — `push a main = deploy`.
- **Librerías vía CDN:** Lucide, Iconify (`@iconify-icon/web`), SortableJS, GSAP, Shoelace, Tabulator, Flatpickr (locale ES), Chart.js, jsPDF, html2canvas, Google Fonts.

---

## Páginas principales

| Archivo | Qué hace |
|---|---|
| `index.html` | Login + dashboard (HQ Command Center: saludo, clima, asistencia, próximo meeting) |
| `admin.html` | Panel admin con sidebar y tabs (Usuarios, Roles, Métricas, Asistencia, Log, Spotlight, Playlist) |
| `agencias.html` | Vista de agencias + organigrama, alimentada desde Google Sheet |
| `directorio.html` | Directorio de contactos del equipo |
| `equipo.html` | Grid con fichas del equipo — foto, cargo, bio |
| `mi-perfil.html` | Perfil personal, reporte de ausencias, stats del mes |
| `portales.html` | Accesos a carriers (tab Hero compartido + personales) |
| `guias.html` | Guías internas |
| `politicas.html` | Políticas internas |
| `onboarding.html` | Onboarding de empleados nuevos + glosario |
| `reuniones.html` | Meetings del equipo (integración Fathom) |
| `grabaciones.html` | Grabaciones de trainings (Google Drive) |
| `contracting.html` | Contracting hub — 4 carriers en producción |
| `finanzas.html` | Módulo Finanzas — ingresos, egresos, reportes, wizard exportar |
| `finanzas-manual.html` | Manual del módulo Finanzas |
| `it-console.html` | Consola IT (integrada al Hub desde v2.4) — usuarios Workspace, solicitudes, tickets, dispositivos, toolbox |
| `soporte.html` | Formulario público de tickets (sin login) |
| `solicitud-cuenta.html` | Formulario público de alta/baja de cuenta |
| `changelog.html` | Historial de cambios del Hub |

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

Variables CSS en `css/styles.css`: `--sans` (Inter), `--display` (Bricolage Grotesque), `--mono` (JetBrains Mono). Design system documentado en `docs/design-system.md`.

### Modo oscuro

Toggle **Sol/Luna** en el topbar. Selección persistida por usuario en Firestore (`users/{email}.prefs.theme`) y cacheada en `localStorage["hero-theme"]` para pre-aplicar el tema antes de la auth (evita el flash). Reglas bajo `body[data-theme="dark"]`. Todo módulo nuevo debe contemplar ambos temas.

---

## Roles

Roles definidos en Firestore (`users/{email}.access.role`): `admin`, `interno`, `IT`, `finanzas`, `agente`.

- El rol se aplica como clase en `<body>` (ej. `body.role-agente`) desde `js/auth.js`, y las páginas/secciones se ocultan vía CSS o guards (`js/page-guard.js`).
- El rol **agente** tiene acceso restringido: solo Inicio (sin asistencia, onboarding ni portales del staff), Equipo y Agencias.
- Cambios de rol se loguean en `audit-log` y requieren confirmación.

---

## Módulos clave

### Sistema de tickets de soporte (v2.30 – v2.32)

Formulario público en `soporte.html`. Backend en Cloudflare Worker. Prioridad calculada server-side desde impacto declarado por el usuario + categoría. Rate limit por IP + por email + honeypot. Adjuntos (PNG/JPG/PDF, máx 3 × 10MB) suben a Cloudflare R2. La consola IT (`it-console.html` → Tickets) muestra Kanban con impacto/equipo/adjuntos y modal de respuesta con Quick Replies + plantillas de casos comunes + checkbox "Notificar por email". El endpoint `POST /alta-agente/resolver` gatea que solo se pueda procesar una solicitud si está `autorizada`.

### Flujo de agentes inactivos (v2.28 – v2.32)

En el IT Console, agentes activos con ≥3 meses sin login se detectan automáticamente. IT envía aviso previo al correo personal (fuente: `recoveryEmail` de Google Workspace → `personalEmail` en Firestore → prompt on-the-fly). Tras 15 días sin respuesta, IT suspende con notificación. 15 días más → alerta de eliminación manual. Chips en el Home del IT Console suman los que califican en cada fase.

### IT Console (integrado desde v2.4)

`it-console.html` + `js/it-console.js` vive dentro del Hub, con auth híbrida Firebase → HMAC vía `/auth/hub-login` del Worker. Módulos: Home, Usuarios (Workspace + Equipo Interno), Solicitudes, Tickets, Dispositivos, Onboarding/Offboarding, Toolbox, Auditoría, Configuración.

### Módulo Finanzas

`finanzas.html` con CRUD de ingresos/egresos, dashboard de comparativas, reportes de pago con PDF client-side (jsPDF), wizard de exportar en 7 pasos, importación desde Excel. Manual de usuario en `finanzas-manual.html`.

### Contracting hub (v2.8)

`contracting.html` con 4 carriers en producción. Diseño adaptado del portal AGA. Bilingüe ES/EN. Escalable a más carriers desde JSON de config.

### Sistema de auditoría

`js/audit-log.js` expone `logEvent(ACTIONS.X, target, details)`. Cada evento se guarda en la colección `audit-log` con `timestamp`, `actor`, `actorName`, `action`, `target`, `details`. Se loguean: cambios de rol, alta/baja de usuarios, edición de carriers del equipo, cambios en directorio, spotlight, accesos denegados. **No** se loguean carriers personales ni logins (eso está en Métricas).

### Asistencia

Sección **"Mi Asistencia"** integrada en el HQ Command Center del `index.html`. 5 tipos: `Entrada` · `Salida` · `Inicio Break` · `Fin Break` · `Ausencia`. Firestore como fuente de verdad desde v2.24.0. Máquina de transiciones válidas en `js/attendance.js`. Sync cross-device via `onSnapshot` + reconciliación en `visibilitychange`/`focus`. Dashboard admin (tab dentro de `admin.html`) con vista agregada por persona y por día.

### Agencias

Datos cargados desde Google Sheet (flag `AGENCIAS_SHEET_URL`). Comisiones por plan se muestran como chips. Filtro de búsqueda con match EXACTO.

### Admin shell

`admin.html` usa layout **sidebar + main** con lazy-load por tab. Para agregar un tab nuevo: registrar entrada en el sidebar + módulo JS dedicado que se inicializa al activarse.

---

## Backend externo — Cloudflare Worker `hero-email-worker`

Vive en repo aparte: `hero-it-console/hero-email-worker.js` + `wrangler.toml`. Deploy con `wrangler deploy` desde ese directorio. URL: `https://hero-email-worker.broad-fire-d2d6.workers.dev`.

Bindings:
- `HERO_KV` — datos operativos (tickets, solicitudes, usuarios Workspace paralelos, config).
- `HERO_TICKETS_R2` — bucket R2 `hero-tickets-attachments` para adjuntos de tickets.

Endpoints públicos (sin auth): `POST /ticket`, `POST /ticket/attachment`, `POST /solicitud-cuenta`, `POST /alta-agente`, `GET /solicitud-cuenta/autorizar`.

Resto de endpoints requieren gate HMAC (emitido por `/auth/hub-login` para IT Console y `/finanzas/send-report` para Finanzas via Firebase ID token).

---

## Convenciones

- **Idioma de UI:** español latino neutro (NO argentino — usar tú/dime/prueba).
- **Fechas:** `MM/DD/YYYY` (US).
- **Versionado:** `x.y.z` semver. Nueva feature = minor bump (`.0`). Fix o iteración del mismo día = patch bump.
- **Commits:** en español, estilo `feat(modulo): …` / `fix(modulo): …` / `chore(...): …` / `style(...): …`.
- **Sin dependencias nuevas** sin discutirlo antes — el stack se mantiene plano a propósito.
- **Banderas:** SVG de `flagicons.lipis.dev` (los emoji se renderizan como texto en Windows).
- **Version bump en 17 HTML** con script PowerShell que preserva UTF-8 sin BOM (ver memoria `feedback_version_bump`).

---

## Despliegue

**Hosting del Hub:** GitHub Pages. **Push a `main` = deploy** en `hub.heroinsuranceusa.com`. No hay paso de build. Para forzar refresco tras un cambio, hard refresh (`Ctrl+Shift+R`).

**Deploy del Worker:** desde `hero-it-console/` corre `wrangler deploy`. Bindings de Cloudflare KV y R2 configurados en `wrangler.toml`.

---

## Equipo

| Persona | Rol |
|---|---|
| Fernando Romero | IT Manager — autor y mantenedor |
| Jesús Gutiérrez | CEO |
| Anny Medina | COO |
| Aurys Rodríguez | CFO |
