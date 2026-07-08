# Hero Hub · Design System

**Última actualización:** 2026-07-08 (v2.14.0)
**Alcance:** dashboard interno Hero Insurance USA
**Stack:** HTML + CSS + JavaScript plano · Firebase · Shoelace (subset) · Lucide · GSAP · Tabulator · Flatpickr · Chart.js

Este documento es la referencia oficial del sistema visual del Hub. Sirve para:
- Mantener consistencia visual entre módulos
- Onboarding rápido de quien tenga que tocar UI
- Evitar reinventar componentes que ya existen

---

## 1 · Filosofía "Hero Light"

- **Cyan como identidad**: `#06a3b6` es la firma. Se usa en primarios, focus states, brand accents.
- **Superficies calmadas**: fondo `--paper` `#f0f4f8` (cielo lavado) y cards blancos.
- **Tipografía con carácter**: Bricolage Grotesque para titulares (con toque humanista), Inter para UI, JetBrains Mono para datos.
- **Densidad razonable**: no maximalista, no minimalista de por sí. Prioriza legibilidad para lectura larga (finanzas, directorios).
- **Modo oscuro nativo**: no un afterthought — cada módulo nuevo debe verificarlo.

---

## 2 · Design Tokens

Todos los tokens viven en `css/styles.css` bajo `:root` y se overriden bajo `body[data-theme="dark"]`.

### 2.1 Paleta

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--cyan` | `#06a3b6` | igual | Primario (brand) |
| `--cyan-2` | `#0891a3` | igual | Gradients, hover |
| `--cyan-deep` | `#066b78` | igual | Text accents fuertes |
| `--teal-dark` | `#0a3d4a` | igual | Base decorativa |
| `--teal-darker` | `#062a33` | igual | Tooltip, backgrounds oscuros |
| `--navy` / `--navy-2` | `#021528` / `#032250` | igual | Decorativos, banners |
| `--gold` / `--gold-2` | `#f5b830` / `#ffd166` | igual | Highlights secundarios |
| `--emerald` | `#10b981` | igual | Success / positivo |
| `--rose` | `#f43f5e` | igual | Danger / negativo |
| `--blue` | `#0065F3` | igual | Info / links externos |
| `--paper` | `#f0f4f8` | `#06151a` | Background app |
| `--paper-2` | `#e8f4f6` | `#0a2026` | Background hover / soft |
| `--card` | `#ffffff` | `#0f2a33` | Superficies elevadas |
| `--text` | `#0a3d4a` | `#e8f4f6` | Texto principal |
| `--text-2` | `#1a4a5a` | `#b8d4d8` | Texto secundario |
| `--muted` | `#5a7480` | `#7a9aa5` | Placeholders, labels |
| `--border` | `rgba(10,61,74,.10)` | `rgba(255,255,255,.08)` | Bordes suaves |
| `--border-2` | `rgba(10,61,74,.18)` | `rgba(255,255,255,.14)` | Bordes fuertes |

### 2.2 Sombras (3 niveles)

| Token | Uso |
|---|---|
| `--shadow-sm` | Cards en reposo, chips |
| `--shadow` | Cards al hover, modales inline |
| `--shadow-lg` | Modales, popovers |

Ejemplo:
```css
box-shadow: var(--shadow-sm);
```

### 2.3 Radii (2 niveles + convención)

| Token | Valor | Uso |
|---|---|---|
| `--r` | `22px` | Cards principales, superficies grandes |
| `--r-sm` | `14px` | Chips, cards pequeñas, inputs |
| — | `999px` | Píldoras (badges circulares) |
| — | `50%` | Avatares, icon-buttons redondos |

**Regla:** en módulos nuevos usar únicamente `var(--r)` y `var(--r-sm)`. No introducir 12/16/18/26 sueltos.

### 2.4 Spacing (nuevo en v2.14.0)

Escala tokenizada en `:root`:

| Token | Valor |
|---|---|
| `--s-1` | `4px` |
| `--s-2` | `8px` |
| `--s-3` | `12px` |
| `--s-4` | `16px` |
| `--s-5` | `20px` |
| `--s-6` | `24px` |
| `--s-7` | `32px` |
| `--s-8` | `40px` |

**Migración progresiva:** módulos existentes mantienen los valores hardcoded. Módulos nuevos deben usar tokens.

### 2.5 Tipografía

| Token | Font stack | Cuándo |
|---|---|---|
| `--display` | `'Bricolage Grotesque', system-ui, sans-serif` | Titulares H1/H2, hero KPIs |
| `--sans` | `'Inter', system-ui, sans-serif` | UI, body, formularios |
| `--mono` | `'JetBrains Mono', ui-monospace, monospace` | Datos numéricos, IDs, KPIs |

Escala de tamaños en uso:

| Rol | Tamaño |
|---|---|
| Label uppercase | 10-11px |
| Body / UI | 13-14px |
| Subtitulo | 16-18px |
| Valor KPI compacto | 18-24px |
| H2 / stat grande | 24-28px |
| Hero KPI | 32-44px |

Convención: valores numéricos usan `font-variant-numeric: tabular-nums` para alineación monospace.

> Trebuchet MS persiste como fallback en `agencias.css`. Módulos nuevos usan el stack Inter/Bricolage.

---

## 3 · Modo Oscuro

### 3.1 Activación

- Toggle sol/luna en el topbar (`widgets.js → toggleHubTheme`).
- Selección guardada por usuario en Firestore (`users/{email}.theme`).
- Cache en `localStorage["hero-theme"]` para pre-aplicar antes de auth y evitar flash.

### 3.2 Selector CSS

Preferido: `body[data-theme="dark"]`
Aceptado (legacy): `[data-theme="dark"]` — usado en `agencias.css`

### 3.3 Reglas para módulos nuevos

- **Nunca** hardcodear `#fff`, `white`, `#000`, `black`, `#f0f4f8`, ni grays específicos.
- Usar siempre tokens (`var(--card)`, `var(--paper)`, `var(--text)`, `var(--border)`, etc.).
- Si un componente necesita un color específico bajo dark mode, agregar bloque:
  ```css
  body[data-theme="dark"] .mi-componente { background: ... }
  ```
- Para Shoelace: setear variables `--sl-color-*` / `--sl-panel-*` en vez de sobrescribir selectores internos.

---

## 4 · Componentes

### 4.1 Botones

| Clase | Rol | Ejemplo |
|---|---|---|
| `.btn-primary` | Acción principal (gradient cyan) | Guardar, Enviar |
| `.btn-ghost-dark` | Secundaria (outline) | Cancelar |
| `.btn-mini` | CTA compacto en cards | "Ver más" |
| `.btn-small-danger` | Destructivo pequeño | "Eliminar" |
| `.icon-btn` | 36×36 icon-only | Editar inline |
| `sl-button` | Solo en formularios Finanzas | — |

Hover estándar: `translateY(-2px)` + shadow más marcada.

### 4.2 Cards y superficies

- **Reutilizables:** `.card-shell`, `.tool-item`, `.guia-card`, `.dir-card`
- **Especializados:** `.mission-banner`, `.arsenal-square-card`, `.bday-panel`, `.alarm-card`, `.ag-tree-node`, `.fexp-card`, `.fimp-card`

Patrón base:
```css
background: var(--card);
border: 1px solid var(--border);
border-radius: var(--r);
box-shadow: var(--shadow-sm);
transition: transform .2s ease, box-shadow .2s ease;
```

### 4.3 Inputs y form controls

Focus state universal (usar en cualquier input nuevo):
```css
.mi-input:focus {
  outline: none;
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px rgba(6, 163, 182, .15);
}
```

- Modal usa `<input>` nativo
- Formularios Finanzas usan `sl-input` / `sl-select` / `sl-textarea`
- ⚠️ **Gotcha conocido:** `sl-select` dentro de `sl-dialog` cierra el modal. Usar `<select>` nativo dentro de `sl-dialog`.

### 4.4 KPIs (patrón hero + strip — Finanzas Dashboard)

Estructura recomendada para dashboards que priorizan una métrica:

```html
<div class="fd-hero-kpi">
  <div class="fd-hero-label">Neto Real</div>
  <div class="fd-hero-value" id="miKpi">$0.00</div>
  <div class="fd-hero-sub">Ganancia menos egresos del periodo</div>
</div>

<div class="fd-metric-strip">
  <div class="fd-metric">...</div>
  <!-- 3-5 métricas de apoyo -->
</div>
```

- Hero: gradient cyan, valor 44px monospace.
- Strip: 5 → 3 → 2 columnas con divisores verticales, valores 18px monospace.
- Clase `.negative` en el valor cuando es negativo (evita `style.color` inline).

### 4.5 Badges y chips

Radius `999px` · padding `4-14px` · `display: inline-flex`

| Clase | Uso |
|---|---|
| `.meta-chip` | Metadata neutral |
| `.stat-pill` | Stat inline con acento cyan |
| `.filter-chip` (+ `.active`) | Filtro toggleable |
| `.fc-origen-badge` | Badge con color por categoría (Finanzas) |
| `.ag-tree-tag` | Estados matrix/warn/hold/count (Agencias) |

### 4.6 Modales

- **Custom:** `.modal-overlay` + `.modal` (`backdrop-filter: blur(20px)`, z-index 1000)
- **Shoelace:** `sl-dialog` en Finanzas (sin overrides)

### 4.7 Navegación (topbar)

- Sticky top · `backdrop-filter: blur(20px)` · z-index 100
- Nav dropdown popper-style (z-index 110)
- Flatten en `@900px`
- Avatar dropdown: `js/user-menu.js` auto-init en las 15 páginas

### 4.8 Loaders

- `.ld` (dots pulse)
- `.pulse-dot` (indicador live emerald)
- Animaciones custom para módulos específicos (birthday)
- ❌ **Sin skeleton screens todavía** — TODO futuro

### 4.9 Toasts (`heroToast` — global, v2.14.0)

Sistema global en `js/toast.js`. Requiere `<script defer src="js/toast.js"></script>` en el HTML.

**API:**
```js
heroToast("Mensaje neutro")
heroToast.success("Guardado correctamente")
heroToast.error("No se pudo guardar", { duration: 5000 })
heroToast.info("Cargando reporte...")
heroToast.neutral("Copiado al portapapeles")

// Sin auto-dismiss:
const t = heroToast.error("Error crítico", { duration: 0 })
// ...luego
t.dismiss()
```

**Comportamiento:**
- Aparece en `bottom-right` (móvil: full-width con márgenes)
- Auto-dismiss `3200ms` por defecto (`duration: 0` desactiva)
- Botón cerrar siempre disponible
- `role="alert"` para errores, `role="status"` para el resto
- Respeta `prefers-reduced-motion`

**Reemplaza:**
- `.fc-status` de Finanzas
- alerts inline aisladas
- llamadas manuales a `alert()` (que se deben evitar)

---

## 5 · Convenciones

### 5.1 Spacing

- Módulos nuevos: usar tokens `--s-1` a `--s-8`
- Módulos existentes: mantener valores actuales (no refactor masivo)

### 5.2 Z-index (jerarquía)

| Nivel | Valor | Elemento |
|---|---|---|
| Base | `0-1` | Contenido normal |
| Topbar | `100` | `.hero-topbar` |
| Dropdown | `110` | `.nav-dropdown` |
| Modal | `1000` | `.modal-overlay`, `sl-dialog` |
| Toast | `9999` | `heroToast` |

### 5.3 Breakpoints (canónicos)

En orden descendente:
```
1320px  1100px  900px  700px  600px  560px  420px
```

Primario: **900px** (nav se flatten a mobile).

> Recomendación futura: consolidar a 4 puntos (`1280 / 1024 / 768 / 480`). Todavía no aplicado.

### 5.4 Animaciones y transiciones

- Curva estándar: `cubic-bezier(.22, 1, .36, 1)` (ease-out fuerte)
- Duración micro-interacciones: **150-300ms**
- Curva alternativa: `ease` para hover-outs suaves
- **Accesibilidad:** todo se respeta `@media (prefers-reduced-motion: reduce)` globalmente (v2.14.0)

### 5.5 Iconos

- Fuente única: **Lucide** vía CDN
- ❌ **No emojis como iconos** (Windows renderiza banderas como texto "VE"/"CU")
- ⚠️ Banderas: usar SVG de `flagicons.lipis.dev`, no emoji

---

## 6 · Prefijos por módulo

| Prefijo | Módulo | Archivo |
|---|---|---|
| `fd-` | Finanzas Dashboard | `css/finanzas.css` |
| `fpr-` | Finanzas Print Report | `css/finanzas.css` |
| `fc-` | Finanzas Chargebacks | `css/finanzas.css` |
| `fi-` | Finanzas Ingresos | `css/finanzas.css` |
| `fimp-` | Finanzas Import | `css/finanzas.css` |
| `fexp-` | Finanzas Export | `css/finanzas.css` |
| `ag-` | Agencias | `css/agencias.css` |
| `dir-` | Directorio | `css/styles.css` |
| `bday-` | Birthday widget | `css/styles.css` |
| `ctr-` | Contracting | `css/styles.css` |
| `hero-toast-` | Sistema de toasts | inyectado por `js/toast.js` |

---

## 7 · Anti-patrones a evitar

| ❌ Mal | ✅ Bien |
|---|---|
| `background: #ffffff` | `background: var(--card)` |
| `color: #000` | `color: var(--text)` |
| `border: 1px solid #e5e7eb` | `border: 1px solid var(--border)` |
| Emojis como iconos (`🎨 🚀`) | SVG Lucide (`<i data-lucide="palette">`) |
| `alert("Guardado")` | `heroToast.success("Guardado")` |
| Radii nuevos (`13px`, `17px`, `26px`) | `var(--r)` o `var(--r-sm)` |
| `style.color = "..."` inline | Clase modificadora (`.negative`, `.positive`) |
| Animaciones sin `reduced-motion` (v2.14+) | Cubierto globalmente ✓ |
| Ignorar dark mode en un módulo nuevo | Testear con toggle antes de merge |
| Hardcodear breakpoints raros | Reusar de la lista canónica |

---

## 8 · Checklist para componentes nuevos

Antes de commitear un componente nuevo:

- [ ] Usa tokens (`var(--*)`) para colores, bordes, sombras, radios
- [ ] Funciona en modo oscuro (toggle sol/luna, verificar visualmente)
- [ ] Focus states visibles (usar el patrón cyan + glow)
- [ ] Sin emojis como icono
- [ ] Sin `alert()`/`confirm()` nativos — usar `heroToast` o modal custom
- [ ] Responsive verificado a 900px y 480px como mínimo
- [ ] Sin `!important` salvo en el bloque global de reduced-motion
- [ ] Naming con prefijo del módulo (`ag-`, `fd-`, etc.) si es específico

---

## 9 · Referencias internas

- Auth y roles: `js/auth.js`
- Menú del avatar: `js/user-menu.js`
- Modo oscuro: `js/widgets.js → toggleHubTheme`
- Toast global: `js/toast.js`
- Changelog visible: `data/changelog.json` → `changelog.html`
- Convenciones de commit: `CLAUDE.md`

---

## 10 · Cambios en este documento

| Fecha | Versión | Cambio |
|---|---|---|
| 2026-07-08 | v2.14.0 | Documento creado. Se agregaron tokens de spacing, sistema global de toast, y regla global de `prefers-reduced-motion`. Se cubrieron 5 gaps de dark mode en `agencias.css`. |
