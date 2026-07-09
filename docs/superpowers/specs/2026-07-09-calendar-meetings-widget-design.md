# Widget de meetings de Google Calendar en el dashboard

**Fecha:** 2026-07-09
**Autor del brainstorming:** Fernando Romero (IT Manager) + Claude
**Estado:** Spec aprobado (pendiente implementation plan)

## 1 · Motivación

El dashboard del Hero Hub muestra hoy información operativa personal (Mi Asistencia) pero no expone al usuario sus próximos meetings. Cada empleado tiene que ir a Google Calendar en una pestaña aparte para saber a qué hora es su próxima reunión y cómo unirse. Un widget nativo en el dashboard que muestre los próximos meetings y permita unirse con un click reduce esa fricción y consolida el Hub como el punto de partida diario.

## 2 · Alcance

**Incluido:**
- Widget en `index.html` que muestra meetings del calendario primario del usuario para **hoy y mañana**, agrupados por día.
- Item compacto por meeting: hora + título + botón "Unirme" (si hay link detectable).
- Detección de links: `hangoutLink` (Meet nativo), `conferenceData.entryPoints`, regex sobre `location` y `description`.
- Badge "En curso" para meetings sucediendo ahora.
- Estados: loading, con meetings, empty, reconectar, error transitorio.
- Refresh automático cada 5 min + al recuperar foco de pestaña.
- Layout: 2 columnas junto a Mi Asistencia en desktop; apilado en móvil.
- Modo oscuro cubierto desde el arranque.

**Fuera de scope:**
- Múltiples calendars (solo `primary`).
- Crear/editar/aceptar/rechazar eventos.
- Notificaciones push antes del meeting.
- Vista completa de calendar (ya existe en calendar.google.com).
- Widget de meetings en otras páginas del Hub.
- Marcar asistencia automática al abrir un meeting.

## 3 · Decisiones de producto

| Decisión | Elegido | Motivación |
|---|---|---|
| Ubicación | Dashboard (index.html), 2 columnas al lado de Mi Asistencia | Máxima visibilidad, contexto operativo personal arriba |
| Auth de Calendar | Scope `calendar.readonly` agregado al login para todos | Sin fricción durante el uso; consent explícito al iniciar sesión |
| Ventana temporal | Hoy + mañana, agrupados por día | Refleja el horizonte de planificación natural sin saturar |
| Densidad del item | Compacto (hora + título + botón "Unirme") | Cabe más contexto vertical; información suficiente para decidir |

## 4 · Arquitectura

### 4.1 Componentes nuevos

- **`js/calendar-widget.js`** — módulo de dashboard. Responsable de:
  - Consumir el `accessToken` de Google publicado por `js/auth.js`.
  - Refrescar el token silenciosamente cuando expira (~1 hora).
  - Hacer fetch al Google Calendar API v3.
  - Post-procesar eventos (filtrar, detectar links, agrupar).
  - Renderizar el DOM del widget.
  - Manejar clicks (Unirme → abrir en nueva pestaña; Reconectar → dispara re-auth).
  - Refresh automático (setInterval 5 min + `visibilitychange`).

- **HTML del widget** en `index.html` — sección dentro del contenedor de "Mi Asistencia", convertido a grid 2 columnas.

- **CSS del widget** en `css/styles.css` — respetando design tokens (`--card`, `--border`, `--r-sm`, spacing `--s-*`, colores light+dark).

### 4.2 Componentes modificados

- **`js/auth.js`**:
  - Agregar `provider.addScope("https://www.googleapis.com/auth/calendar.readonly")` al `GoogleAuthProvider` del `signInWithPopup`.
  - Después del signIn, extraer `accessToken` con `GoogleAuthProvider.credentialFromResult(userCredential)`.
  - Guardar en `sessionStorage["hero-gcal-token"] = { accessToken, expiresAt, email }`.
  - Emitir custom event `hero-gcal-token-ready` para que `calendar-widget.js` lo consuma.

- **Layout de Mi Asistencia en `index.html` + `css/styles.css`**:
  - El contenedor actual pasa a ser grid 2 columnas: asistencia izquierda / meetings derecha.
  - Breakpoint <900px → una sola columna, meetings debajo de asistencia.

## 5 · Flujo de datos

### 5.1 Adquisición del token

1. Usuario hace login. `signInWithPopup` con scope `calendar.readonly` agregado.
2. Google muestra consent (una vez por cuenta). Al aceptar, retorna `UserCredential`.
3. `js/auth.js` extrae `accessToken` con `GoogleAuthProvider.credentialFromResult()`.
4. Guarda `{ accessToken, expiresAt: now + 55 min, email }` en `sessionStorage`.
5. Emite `hero-gcal-token-ready` en `window`.

### 5.2 Refresh silencioso

1. Al pedir meetings, `calendar-widget.js` verifica `sessionStorage["hero-gcal-token"].expiresAt`.
2. Si vencido: llama `signInWithPopup(auth, provider)` con `provider.setCustomParameters({ login_hint: user.email, prompt: 'none' })`.
3. Si el user sigue logueado en Google → sin popup, retorna nuevo credential → nuevo token.
4. Si Google requiere interacción (sesión expirada, permiso revocado) → falla → estado "Reconectar".

### 5.3 Fetch de eventos

```
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
  ?timeMin=<inicio del día HOY, ISO 8601 con TZ>
  &timeMax=<fin del día MAÑANA, ISO 8601 con TZ>
  &singleEvents=true
  &orderBy=startTime
  &maxResults=20
Authorization: Bearer <accessToken>
```

### 5.4 Post-procesamiento

1. **Filtrar** eventos donde:
   - `status === "cancelled"` → descartar.
   - `eventType === "outOfOffice"` o `eventType === "focusTime"` → descartar.
   - `attendees.find(a => a.self)?.responseStatus === "declined"` → descartar.
   - Sin `start.dateTime` (all-day: solo tienen `start.date`) → descartar.

2. **Detectar link para "Unirme"** priorizando:
   - `hangoutLink` (Google Meet).
   - `conferenceData.entryPoints[0].uri` (Zoom/Teams via conference).
   - Regex sobre `location`: `/https?:\/\/[^\s]+/`.
   - Regex sobre `description`: `/https?:\/\/(?:us\d+web\.zoom\.us|meet\.google\.com|teams\.microsoft\.com|.*\.zoom\.us)\/\S+/`.
   - Si nada → item se muestra sin botón, con badge gris "Sin link".

3. **Agrupar** en `hoy` / `mañana` según fecha local del `start.dateTime`.

4. **Marcar en curso**: si `start.dateTime <= now <= end.dateTime` → badge "En curso" (cyan, pulsando).

5. **Marcar próximo**: si `now < start.dateTime && (start.dateTime - now) <= 15 min` → badge "En N min" (gold), donde N se recalcula en cada refresh.

6. **Limitar** a 6 items totales. Si hay más, mostrar footer con link a `calendar.google.com`.

### 5.5 Refresh triggers

- `setInterval(fetchMeetings, 5 * 60 * 1000)`.
- `document.addEventListener("visibilitychange", ...)` → refresh si `document.visibilityState === "visible"` y último fetch > 60 segundos.

## 6 · Estados de UI

| Estado | Cuándo | Presentación |
|---|---|---|
| Loading | Primera carga o refresh manual | Skeleton con 2-3 filas placeholder |
| Con meetings | Fetch OK con eventos | Header "HOY" / "MAÑANA" + filas compactas |
| Empty | Fetch OK sin eventos | Icon calendar tachado + "Sin meetings próximos ✨" + subtexto |
| Reconectar | Token inválido y refresh silencioso falló | Icon warning + "Necesitas reconectar Google Calendar" + botón cyan "Reconectar" |
| Error transitorio | Fetch falló por red o 5xx (después de 2 retries) | "No pudimos cargar tu calendar" + botón "Reintentar" |
| En curso (por item) | `start <= now <= end` | Borde izquierdo cyan + badge "En curso" pulsando (respeta `prefers-reduced-motion`) |
| Próximo (por item, <15 min) | `now < start && start - now < 15 min` | Badge "En 15 min" en gold |
| Sin link (por item) | No se detectó link joinable | Badge gris "Sin link" en lugar del botón |

## 7 · Edge cases

| Caso | Manejo |
|---|---|
| User canceló el permiso en el consent screen del login | Token sin scope de calendar → fetch 403 → estado "Reconectar" con explicación clara |
| User revoca el permiso desde myaccount.google.com | Fetch 401 con `invalid_grant` → refresh silencioso falla → estado "Reconectar" |
| Meeting sin link joinable | Item con badge gris "Sin link" |
| Meeting all-day (`start.date` sin `dateTime`) | Filtrado |
| Meeting rechazado (declined) | Filtrado |
| Meeting cancelado por organizador | Filtrado |
| Más de 6 meetings en la ventana | Se muestran los primeros 6 con footer "Ver más en Google Calendar" (link) |
| Sin conexión a internet | Estado "Error transitorio" con reintentar; retry silencioso en próximo `visibilitychange` |
| Access token expiró entre sesiones | Detección al inicio del widget → refresh silencioso antes del primer render |
| Cambio de zona horaria (viajes, DST) | `Intl.DateTimeFormat` para formatear en zona del navegador; `new Date(start.dateTime)` respeta la TZ del ISO string |
| Modal Shoelace u otro overlay abierto durante refresh | El widget se re-renderiza en su contenedor sin interferir con overlays; sin toasts asociados al refresh (es silencioso) |

## 8 · Accesibilidad

- Lista de meetings con `role="list"` y cada item con `role="listitem"`.
- Botón "Unirme" con `aria-label` "Unirme al meeting «Título» a las HH:MM".
- Badges con `aria-label` descriptivo.
- Contraste WCAG AA verificado en light y dark mode.
- Respeta `prefers-reduced-motion` (regla global ya en `css/styles.css`) → pulsing de "En curso" se desactiva.
- Foco visible en todos los botones.

## 9 · Persistencia

- **`sessionStorage["hero-gcal-token"]`** = `{ accessToken, expiresAt, email }`.
  - Se limpia al cerrar el navegador (por diseño de sessionStorage).
  - No se usa `localStorage` porque el token no debe sobrevivir cierres de navegador.
- **Cache de eventos**: variable de módulo en `calendar-widget.js`. No persistido. Se re-fetch al recargar.

## 10 · Testing manual

Casos a verificar antes del push a `main`:

1. Primer login con nuevo scope → Google muestra consent → aceptar → widget renderiza.
2. Empty state real (cuenta sin meetings hoy/mañana).
3. Meeting con Meet nativo → botón abre `hangoutLink`.
4. Meeting con Zoom en `location` → regex detecta → botón funciona.
5. Meeting sin link joinable → badge "Sin link".
6. Meeting en curso → badge "En curso" con highlight cyan.
7. Meeting all-day (vacaciones) → filtrado.
8. Meeting rechazado → filtrado.
9. Layout 2 columnas en desktop (≥900px).
10. Layout apilado en móvil (<900px).
11. Modo oscuro completo (colores, contrastes, badges).
12. Reconectar flow: revocar en myaccount.google.com → recargar Hub → widget muestra "Reconectar" → click → popup → widget se rellena.
13. Refresh de token: pestaña abierta >1h → cambiar de tab y volver → `visibilitychange` dispara refresh silencioso → sigue funcionando.

## 11 · Rollout

### 11.1 Prerrequisitos manuales

**Antes o después del deploy — obligatorio:**
- En Google Cloud Console (proyecto de Firebase) → APIs & Services → OAuth consent screen:
  - Agregar scope `https://www.googleapis.com/auth/calendar.readonly`.
  - Si el proyecto está en modo "Internal" (Workspace @heroinsuranceusa.com), la verificación es inmediata.
  - Si está en "External", Google puede requerir verificación de app (proceso de días).
- En Google Cloud Console → APIs & Services → Library:
  - Habilitar "Google Calendar API" si aún no está.

### 11.2 Comportamiento en producción tras deploy

- Empleados ya logueados que NO cierran sesión: mantienen su token de Firebase Auth pero sin token de calendar. El widget muestra "Reconectar" hasta que hagan click y acepten el consent extra. Aceptable.
- Empleados que hagan login fresco: verán el consent del nuevo scope en el popup de Google. Al aceptar, widget funciona.
- Empleado que rechaza el consent: el signIn se completa igual (Firebase no bloquea), pero sin token de calendar. Widget en estado "Reconectar" permanente hasta que reintente.

### 11.3 Cuota

- Google Calendar API: 1,000,000 queries/día por proyecto.
- Estimación con 30 empleados × refresh cada 5 min × 8h/día = ~2,880 queries/día.
- Margen amplio (0.3% de la cuota).

## 12 · Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Scope `calendar.readonly` no declarado en OAuth consent → fetch falla para todos | Verificar en Google Cloud Console antes del deploy |
| Empleado no acepta el consent → login roto | El consent es aditivo; Firebase completa signIn igual. El resto del Hub funciona; solo el widget muestra "Reconectar" |
| Popup silencioso bloqueado por browser | Fallback a estado "Reconectar" con botón visible → popup completo al clickear |
| Calendar API v3 deprecation | Estable, sin planes de deprecation anunciados |
| Access token expuesto en sessionStorage | Riesgo mínimo (mismo origen; no persiste al cerrar navegador). Alternativa (backend proxy) fuera de scope del stack actual |

## 13 · Archivos afectados

| Archivo | Cambio |
|---|---|
| `index.html` | Cargar `js/calendar-widget.js`; markup del widget dentro de un contenedor grid para Asistencia + Meetings |
| `js/auth.js` | Agregar scope `calendar.readonly`; capturar y publicar `accessToken` |
| `js/calendar-widget.js` | **NUEVO** — módulo del widget (~200-250 líneas) |
| `css/styles.css` | Grid layout 2 columnas para asistencia+meetings; estilos del widget; reglas de modo oscuro |

## 14 · Extensiones futuras (no en este spec)

- Widget de meetings de la semana en `mi-perfil.html`.
- Notificaciones "Tu meeting empieza en 5 min" (Firebase Cloud Messaging).
- Ver meetings de calendars secundarios/compartidos.
- Detectar automáticamente cuando el usuario abre un meeting desde el Hub y registrar la asistencia en el sistema interno.
