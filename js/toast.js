/**
 * Hero Hub — Sistema global de toasts
 *
 * Uso:
 *   heroToast("Guardado")
 *   heroToast.success("Ingreso creado")
 *   heroToast.error("No se pudo guardar", { duration: 5000 })
 *   heroToast.info("Cargando reporte...")
 *
 * Opciones:
 *   duration: ms antes de auto-dismiss (default 3200, 0 = sin auto-dismiss)
 *   variant : "success" | "error" | "info" | "neutral" (o pasar en fn específica)
 *
 * Devuelve { dismiss() } para cerrar manualmente antes del timeout.
 */
(function () {
  const STYLE_ID = "hero-toast-style";
  const CONTAINER_ID = "hero-toast-container";

  const CSS = `
    #${CONTAINER_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: calc(100vw - 48px);
    }
    .hero-toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 260px;
      max-width: 420px;
      padding: 12px 14px;
      background: var(--card, #fff);
      color: var(--text, #0a3d4a);
      border: 1px solid var(--border, rgba(10,61,74,.10));
      border-left-width: 3px;
      border-radius: 12px;
      box-shadow: var(--shadow, 0 8px 24px rgba(6,107,120,.10));
      font-family: var(--sans, 'Inter', system-ui, sans-serif);
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
      transform: translateX(120%);
      opacity: 0;
      transition: transform .28s cubic-bezier(.22,1,.36,1), opacity .2s ease;
    }
    .hero-toast.show { transform: translateX(0); opacity: 1; }
    .hero-toast.hide { transform: translateX(120%); opacity: 0; }
    .hero-toast-icon {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #fff;
      font-family: var(--sans, 'Inter', system-ui, sans-serif);
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
    }
    .hero-toast-msg { flex: 1; min-width: 0; word-wrap: break-word; }
    .hero-toast-close {
      background: transparent;
      border: 0;
      color: var(--muted, #5a7480);
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 6px;
      transition: background-color .15s ease, color .15s ease;
    }
    .hero-toast-close:hover { background: var(--paper-2, #e8f4f6); color: var(--text, #0a3d4a); }
    .hero-toast-close:focus-visible { outline: 2px solid var(--cyan, #06a3b6); outline-offset: 1px; }

    .hero-toast.success { border-left-color: var(--emerald, #10b981); }
    .hero-toast.success .hero-toast-icon { background: var(--emerald, #10b981); }
    .hero-toast.error { border-left-color: var(--rose, #f43f5e); }
    .hero-toast.error .hero-toast-icon { background: var(--rose, #f43f5e); }
    .hero-toast.info { border-left-color: var(--cyan, #06a3b6); }
    .hero-toast.info .hero-toast-icon { background: var(--cyan, #06a3b6); }
    .hero-toast.neutral { border-left-color: var(--muted, #5a7480); }
    .hero-toast.neutral .hero-toast-icon { display: none; }

    @media (max-width: 480px) {
      #${CONTAINER_ID} { bottom: 16px; right: 16px; left: 16px; max-width: none; }
      .hero-toast { min-width: 0; max-width: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .hero-toast { transition: opacity .12s ease; transform: none; }
      .hero-toast.show, .hero-toast.hide { transform: none; }
    }
  `;

  const ICONS = { success: "✓", error: "!", info: "i" };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement("div");
      c.id = CONTAINER_ID;
      c.setAttribute("aria-live", "polite");
      c.setAttribute("aria-atomic", "true");
      document.body.appendChild(c);
    }
    return c;
  }

  function show(message, opts) {
    opts = opts || {};
    const variant = opts.variant || "neutral";
    const duration = opts.duration != null ? opts.duration : 3200;

    ensureStyle();
    const container = ensureContainer();

    const toast = document.createElement("div");
    toast.className = "hero-toast " + variant;
    toast.setAttribute("role", variant === "error" ? "alert" : "status");

    if (ICONS[variant]) {
      const icon = document.createElement("span");
      icon.className = "hero-toast-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = ICONS[variant];
      toast.appendChild(icon);
    }

    const msg = document.createElement("div");
    msg.className = "hero-toast-msg";
    msg.textContent = String(message);
    toast.appendChild(msg);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "hero-toast-close";
    close.setAttribute("aria-label", "Cerrar notificación");
    close.textContent = "×";
    toast.appendChild(close);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));

    let dismissed = false;
    let timer = null;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      toast.classList.remove("show");
      toast.classList.add("hide");
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
    }

    close.addEventListener("click", dismiss);
    if (duration > 0) timer = setTimeout(dismiss, duration);

    return { dismiss };
  }

  const heroToast = function (message, opts) { return show(message, opts); };
  heroToast.success = function (msg, opts) { return show(msg, Object.assign({}, opts, { variant: "success" })); };
  heroToast.error   = function (msg, opts) { return show(msg, Object.assign({}, opts, { variant: "error" })); };
  heroToast.info    = function (msg, opts) { return show(msg, Object.assign({}, opts, { variant: "info" })); };
  heroToast.neutral = function (msg, opts) { return show(msg, Object.assign({}, opts, { variant: "neutral" })); };

  window.heroToast = heroToast;
})();
