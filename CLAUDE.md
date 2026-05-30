# Hero Hub — Contexto del Proyecto

## Qué es

Hero Hub es el **dashboard interno** de Hero Insurance USA, una aseguradora con sede en Florida. Funciona como cuartel general digital del equipo: directorio de contactos, agencias y organigramas, accesos a portales de carriers, guías, políticas, onboarding y herramientas de administración.

Es un proyecto **interno, no público** — solo accesible para empleados con cuenta del dominio corporativo.

## Stack técnico

- **Frontend**: HTML + CSS + JavaScript planos. Sin framework, sin paso de build, sin bundler.
- **Hosting**: GitHub — el sitio se sirve desde el repositorio; **push a `main` = deploy**.
- **Backend / datos**: Firebase Firestore.
- **Autenticación**: Google Auth, restringida al dominio `@heroinsuranceusa.com`.
- **Librerías externas vía CDN**: Lucide (íconos), SortableJS, GSAP (animaciones), Shoelace (componentes UI), Tabulator (tablas), Flatpickr (date pickers, locale ES), Chart.js (gráficos), Google Fonts.

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

> Trebuchet MS persiste como fallback y sigue siendo la fuente de texto en CSS heredado (ej. `agencias.css`). Para módulos nuevos usar el stack de arriba, definido en `css/styles.css` vía las variables `--sans` (Inter) y `--display` (Bricolage Grotesque).

Todo módulo nuevo debe respetar esta paleta para mantener consistencia visual con el resto del Hub.

## Modo oscuro

El Hub soporta **modo oscuro** además de Hero Light. Activación: toggle "Día / Noche" en el modal de Configuración (`widgets.js → openSettingsModal`). La selección se guarda por usuario en Firestore (`users/{email}.theme`) y se cachea en `localStorage["hero-theme"]` para pre-aplicarse antes de la auth (evita el flash de tema incorrecto).

- **Selector CSS:** `body[data-theme="dark"]` (y `[data-theme="dark"]` para scope reducido).
- **Dónde viven las reglas:** `css/styles.css` (general) y `css/agencias.css` (vista de agencias).
- **Regla para UI nueva:** todo módulo o componente debe contemplar ambos temas. Evitar fondos/colores hardcodeados (`#fff`, `white`, `#000`) — usar variables CSS o duplicar la regla bajo el selector dark.
- **Componentes Shoelace:** preferir setear variables `--sl-color-*` / `--sl-panel-background-color` bajo el selector dark en vez de sobreescribir selectores internos.

## Estructura del proyecto

```
hero-hub/
├── README.md
├── index.html                   ← login y dashboard principal
├── admin.html                   ← panel de administración (roles, métricas, log)
├── agencias.html                ← vista de agencias (con organigrama integrado)
├── directorio.html              ← directorio de contactos
├── equipo.html                  ← página del equipo
├── portales.html                ← accesos a carriers
├── guias.html                   ← guías internas
├── politicas.html               ← políticas
├── onboarding.html              ← onboarding de empleados nuevos
├── css/                         ← hojas de estilo
├── js/                          ← lógica y módulos
├── images/                      ← logo, fondos
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
