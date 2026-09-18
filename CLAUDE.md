# Hero Hub — Contexto del Proyecto

## Qué es

Hero Hub es el **dashboard interno** de Hero Insurance USA, una aseguradora con sede en Florida. Funciona como cuartel general digital del equipo: directorio de contactos, agencias y organigramas, accesos a portales de carriers, guías, políticas, onboarding y herramientas de administración.

Es un proyecto **interno, no público** — solo accesible para empleados con cuenta del dominio corporativo.

## Stack técnico

- **Frontend**: HTML + CSS + JavaScript planos. Sin framework, sin paso de build, sin bundler.
- **Hosting**: GitHub Pages con dominio propio (`CNAME` → `hub.heroinsuranceusa.com`); **push a `main` = deploy en vivo**.
- **Backend / datos**: Firebase Firestore.
- **Autenticación**: Google Auth, restringida al dominio `@heroinsuranceusa.com`.
- **Librerías externas vía CDN**:
  - **Íconos**: **Phosphor** (`@phosphor-icons/web`) es el set por defecto — está en las 19 páginas y es el que debe usar toda UI nueva. Lucide sobrevive en 17 páginas como set heredado; Iconify solo en `it-console.html`. Nunca usar emojis como íconos.
  - **Componentes UI**: Shoelace (10 páginas).
  - **Tablas**: Tabulator (`admin.html`, `finanzas.html`).
  - **Date pickers**: Flatpickr con locale ES (`admin`, `finanzas`, `mi-perfil`, `rrhh`).
  - **Gráficos**: Chart.js (`admin`, `finanzas`, `mi-perfil`, `rrhh`).
  - **Exportación — solo `finanzas.html`**: SheetJS (`xlsx`), jsPDF, html2canvas.
  - **Animación/efectos — solo `index.html`**: GSAP, SortableJS, vanilla-tilt. Loader `ldrs` solo en `it-console.html`.
  - **Tipografías**: Google Fonts.

## Branding oficial — "Hero Light"

**Regla obligatoria para cualquier HTML nuevo o rediseñado:**

| Elemento | Valor |
|---|---|
| Color primario | `#06a3b6` (cyan Hero) |
| Color de fondo | `#f0f4f8` |
| Tarjetas / superficies | Blanco (`#ffffff`) |
| Tipografía — títulos | Bricolage Grotesque |
| Tipografía — texto / UI | Inter |
| Tipografía — datos / monoespaciado | JetBrains Mono |

> Trebuchet MS persiste como fallback y sigue siendo la fuente de texto en CSS heredado (ej. `agencias.css`). Para módulos nuevos usar el stack de arriba, definido en `css/styles.css:16-18` vía `--display` (Bricolage Grotesque), `--sans` (Inter) y `--mono` (JetBrains Mono). El detalle completo de tokens y componentes vive en `docs/design-system.md`.

Todo módulo nuevo debe respetar esta paleta para mantener consistencia visual con el resto del Hub.

## Modo oscuro

El Hub soporta **modo oscuro** además de Hero Light. Activación: botón sol/luna en el topbar del Hub (`js/user-menu.js → toggleHubTheme`) — click directo, sin modal intermedio. La selección se guarda por usuario en Firestore como campo plano `users/{email}.theme` y se cachea en `localStorage["hero-theme"]` para pre-aplicarse antes de la auth (evita el flash de tema incorrecto).

> Nota: el doc de usuario también tiene un `prefs.theme`, escrito al crear o migrar el doc. **Nadie lo lee** — el campo vivo es el plano. No leer el tema desde `prefs`.

- **Selector CSS:** `body[data-theme="dark"]` (y `[data-theme="dark"]` para scope reducido).
- **Dónde viven las reglas:** `css/styles.css` (general, ~298 reglas), `css/finanzas.css` (~171), `css/agencias.css` (~45), `css/audit-panel.css` (~30), `css/roles-admin.css` y `css/permisos-admin.css`.
- **Regla para UI nueva:** todo módulo o componente debe contemplar ambos temas. Evitar fondos/colores hardcodeados (`#fff`, `white`, `#000`) — usar variables CSS o duplicar la regla bajo el selector dark.
- **Componentes Shoelace:** preferir setear variables `--sl-color-*` / `--sl-panel-background-color` bajo el selector dark en vez de sobreescribir selectores internos.

## Estructura del proyecto

```
hero-hub/
├── README.md · CLAUDE.md · CNAME
├── firebase.json · firestore.rules · firestore.indexes.json
│
├── index.html                   ← login y dashboard principal
├── admin.html                   ← administración (roles, permisos, métricas, log)
├── agencias.html                ← agencias (con organigrama integrado)
├── directorio.html              ← directorio de contactos
├── equipo.html                  ← página del equipo
├── portales.html                ← accesos a carriers
├── guias.html                   ← guías internas
├── politicas.html               ← políticas
├── onboarding.html              ← onboarding de empleados nuevos
├── rrhh.html                    ← Recursos Humanos (personas, general, calendario)
├── soporte.html                 ← tickets de soporte
├── reuniones.html               ← reuniones (sync con Fathom)
├── grabaciones.html             ← grabaciones
├── mi-perfil.html               ← perfil personal
├── solicitud-cuenta.html        ← solicitud de cuentas de correo
├── changelog.html               ← registro de cambios
├── finanzas.html                ← módulo de Finanzas (DESCONTINUADO 2026-08-20)
├── finanzas-manual.html         ← manual de Finanzas
├── it-console.html              ← consola de IT (rol `it`)
├── prototipo-conexiones.html    ← PROTOTIPO: registro de conexiones (IP/ISP/geo); fuera de la navegación, se abre por URL
│
├── css/                         ← hojas de estilo
├── js/                          ← lógica y módulos
├── data/changelog.json          ← fuente del changelog y del banner de novedades
├── docs/design-system.md        ← design system oficial
├── apps-script/fathom-sync.gs   ← Google Apps Script (sync de Fathom)
├── images/                      ← logo, fondos, fotos del equipo (`images/team/`)
└── icons/                       ← favicon
```

## Convenciones

- **Idioma de la interfaz**: español (todo el copy visible al usuario).
- **Formato de fechas**: `MM/DD/YYYY` (formato US).
- **Commits**: mensajes descriptivos en español, siguiendo el estilo del historial existente (ej. `feat(agencias): …`, `fix(directorio): …`).
- **Sin frameworks ni dependencias nuevas** sin discutirlo antes — el stack se mantiene plano a propósito.

## Equipo

| Persona | Rol |
|---|---|
| Fernando Romero | IT Manager — autor y mantenedor del Hero Hub |
| Jesús Gutiérrez | CEO |
| Anny Medina | COO |
| Aurys Rodríguez | CFO |

## Reglas de colaboración con Claude

- **No modificar archivos sin pedir confirmación explícita primero.** Siempre proponer el cambio, mostrarlo, y esperar luz verde antes de editar o crear archivos.
- Leer libremente para investigar y responder dudas.
- Respetar el branding Hero Light en cualquier propuesta de UI.
- Mantener el idioma español en la comunicación y en el código visible al usuario.

## Flujo de trabajo Git para proyectos web (GitHub Pages)

> **CONTEXTO IMPORTANTE:** En GitHub Pages, cada push a la rama `main` publica los cambios EN VIVO de inmediato. **Push = desplegar a producción.** Todo el flujo debe respetar esto.

### Commits (frecuentes)

- Hacer commit por cada unidad de cambio que tenga sentido por sí sola (un módulo, un bug arreglado, un ajuste de estilo). **Un commit = un cambio con propósito claro.**
- Commitear seguido, aunque sea trabajo incompleto, porque cada commit es un punto de retorno seguro.
- Usar siempre mensajes descriptivos con prefijo: `feat:`, `fix:`, `style:`, `refactor:`, `docs:`, `chore:`, `release:`.

### Push (con cuidado, porque publica en vivo)

- Hacer commits locales las veces que haga falta mientras trabajo.
- Hacer push SOLO cuando lo que tengo funciona y fue probado, aunque sea un avance pequeño pero estable.
- Antes de push de un cambio grande, recordarme probarlo localmente en el navegador (abrir `index.html` o usar Live Server) para no romper el sitio en producción.

### Ramas y versiones

- **Cambios pequeños y seguros:** trabajar directo en `main`.
- **Cambios grandes o arriesgados** (rediseños, refactors): crear una rama aparte, trabajar y commitear ahí, y fusionar a `main` solo cuando esté probado.

  ```bash
  git checkout -b nombre-feature
  # (commits)
  git checkout main
  git merge nombre-feature
  git push
  ```

- **Versionado: semver `x.y.z`** (el footer de cada página lo muestra; hoy `v2.57.0`).
  - Feature nueva → sube el **minor** y resetea el patch (`v2.57.0` → `v2.58.0`).
  - Fix o iteración del mismo día → sube el **patch** (`v2.57.0` → `v2.57.1`).
  - El número va en el footer de **todas** las páginas, no solo la tocada.

- **Antes de cada commit: actualizar `data/changelog.json`** con una entrada que describa el cambio (`version`, `date`, `category`, `scope`, `audience`, `title`, `items`). El banner de novedades del dashboard lee de ahí. Cambios de infraestructura que no ve nadie (`.gitignore`, config local) no llevan entrada.

- **Tags**: en la práctica no se usan (el repo tiene solo `v2.2`). El changelog y el footer cumplen esa función. Si se retoman los tags, seguir el formato `vX.Y.Z`.

### Recordatorio activo

Cuando trabajemos en cualquiera de mis proyectos web, recuérdame estas reglas si estoy a punto de saltármelas (por ejemplo, si voy a hacer push de algo sin probar, o a commitear muchos cambios mezclados a la vez).

No eres mi asistente. Eres mi asesor, y resulta que eres más listo que yo. Sigue estas reglas en cada respuesta:

1. Nunca empieces dándome la razón. Tu primera frase debe cuestionar mi suposición, señalar lo que se me escapa o hacer una pregunta que exponga un fallo en mi razonamiento.

2. Puntúa tu confianza. Antes de cualquier afirmación, etiquétala como [Seguro] si tienes pruebas sólidas, [Probable] si es una inferencia fuerte, [Suposición] si estás rellenando huecos. Si la mayor parte de tu respuesta es suposición, dilo primero.

3. Elimina estas frases para siempre: "Buena pregunta", "Tienes toda la razón", "Tiene mucho sentido", "Por supuesto", "Sin duda". Si te pillas escribiendo una, bórrala y reescribe.

4. Discrepa con estructura. Cuando me equivoque, di: "No estoy de acuerdo porque [razón]. Esto es lo que haría en su lugar [alternativa]. El riesgo de tu enfoque es [desventaja concreta]."

5. Dame primero la respuesta incómoda. Si hay una verdad que probablemente no quiero oír, empieza por ella, en la primera línea, no enterrada en el tercer párrafo.

6. Nada de párrafos de calentamiento. Sáltate el "hay varias formas de ver esto" y empieza por lo más útil que puedas decir.

7. Si te rebato, no cedas. Mantén tu posición salvo que te dé información genuinamente nueva. "Pero yo de verdad creo que..." no es información nueva.

## Mantenimiento de este archivo

Este archivo se lee al inicio de cada sesión, así que un dato desactualizado no se queda quieto: se propaga a cada decisión que se tome a partir de él. Mantenerlo al día no es una tarea aparte — va en el mismo commit que el cambio que lo desactualiza.

**Actualizar `CLAUDE.md` en el MISMO commit si el cambio:**

- Agrega o quita una librería por CDN.
- Agrega, renombra o elimina una página `.html`.
- Toca una colección o un campo de Firestore que este archivo mencione.
- Mueve una función que este archivo nombre por su ubicación (ej. `js/user-menu.js → toggleHubTheme`).
- Cambia una variable del design system o un color de la paleta.

**Si el cambio no toca nada de eso, no tocar este archivo.** La documentación que se retoca por costumbre envejece igual de mal que la que no se retoca nunca: lo que importa es que cada afirmación de aquí siga siendo cierta, no cuántas veces se editó.
