/**
 * Hero Hub — Diálogo global de confirmación
 *
 * Reemplaza al confirm() nativo con un modal Shoelace consistente con el design system.
 *
 * Uso:
 *   const ok = await heroConfirm({
 *     title: "Eliminar miembro",
 *     message: "¿Eliminar a Fernando Romero? Esta acción no se puede deshacer.",
 *     confirmLabel: "Eliminar",
 *     variant: "danger"
 *   });
 *   if (!ok) return;
 *
 * Opciones:
 *   title        (string)  encabezado del modal — default "¿Confirmas?"
 *   message      (string)  cuerpo del mensaje — default ""
 *   confirmLabel (string)  texto del botón principal — default "Confirmar"
 *   cancelLabel  (string)  texto del botón secundario — default "Cancelar"
 *   variant      (string)  "primary" | "warning" | "danger" — default "primary"
 *
 * Devuelve Promise<boolean>: true si el usuario confirmó, false en cualquier otro caso
 * (cancelar, ESC, click fuera).
 *
 * Requiere Shoelace cargado en la página (sl-dialog + sl-button).
 */
(function () {
  const STYLE_ID = "hero-confirm-style";

  const CSS = `
    .hero-confirm-dialog::part(panel) {
      border-radius: 16px;
    }
    .hero-confirm-body {
      font-family: var(--sans, 'Inter', system-ui, sans-serif);
      font-size: 14px;
      line-height: 1.5;
      color: var(--text, #0a3d4a);
      padding: 4px 0 8px;
    }
  `;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function heroConfirm(opts) {
    opts = opts || {};
    const title = opts.title || "¿Confirmas?";
    const message = opts.message || "";
    const confirmLabel = opts.confirmLabel || "Confirmar";
    const cancelLabel = opts.cancelLabel || "Cancelar";
    const variant = opts.variant || "primary";
    const btnVariant = variant === "danger" ? "danger"
                     : variant === "warning" ? "warning"
                     : "primary";

    ensureStyle();

    return new Promise((resolve) => {
      const dialog = document.createElement("sl-dialog");
      dialog.label = title;
      dialog.className = "hero-confirm-dialog";

      const body = document.createElement("div");
      body.className = "hero-confirm-body";
      body.textContent = message;
      dialog.appendChild(body);

      const btnCancel = document.createElement("sl-button");
      btnCancel.setAttribute("slot", "footer");
      btnCancel.setAttribute("variant", "default");
      btnCancel.textContent = cancelLabel;
      dialog.appendChild(btnCancel);

      const btnOk = document.createElement("sl-button");
      btnOk.setAttribute("slot", "footer");
      btnOk.setAttribute("variant", btnVariant);
      btnOk.textContent = confirmLabel;
      dialog.appendChild(btnOk);

      document.body.appendChild(dialog);

      let result = false;
      btnCancel.addEventListener("click", () => { result = false; dialog.hide(); });
      btnOk.addEventListener("click", () => { result = true; dialog.hide(); });
      dialog.addEventListener("sl-after-hide", () => {
        resolve(result);
        dialog.remove();
      });

      // Shoelace lazy-registra el custom element en el primer uso; sin esto
      // el primer heroConfirm() no dispara la apertura visualmente.
      customElements.whenDefined("sl-dialog").then(() => dialog.show());
    });
  }

  window.heroConfirm = heroConfirm;
})();
