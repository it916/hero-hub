// ═══════════════════════════════════════════
// Hero Hub · Dropdowns del Topbar
// ═══════════════════════════════════════════
// Maneja los grupos colapsables (Operaciones, Recursos) del topbar:
//   - Click en el toggle abre/cierra el dropdown (cerrando los otros).
//   - Click fuera o tecla Esc cierra el abierto.
//   - Si alguno de los hijos es la página actual, el toggle padre
//     queda con .active para indicar dónde estás.
//
// En mobile (≤900px), los dropdowns están siempre expandidos (controlado
// por CSS), así que el JS no interfiere — los clicks pasan a los hijos.

(function () {
  function init() {
    const groups = document.querySelectorAll(".nav-group");
    if (!groups.length) return;

    // Marcar como .active el grupo padre si alguno de sus hijos ya está activo
    // (el HTML de cada página marca su propio enlace con class="nav-link active").
    groups.forEach(group => {
      const activeChild = group.querySelector(".nav-dropdown .nav-link.active");
      if (activeChild) {
        const toggle = group.querySelector(".nav-group-toggle");
        if (toggle) toggle.classList.add("active");
      }
    });

    const closeAll = (except) => {
      groups.forEach(g => {
        if (g === except) return;
        g.classList.remove("open");
        const t = g.querySelector(".nav-group-toggle");
        if (t) t.setAttribute("aria-expanded", "false");
      });
    };

    groups.forEach(group => {
      const toggle = group.querySelector(".nav-group-toggle");
      if (!toggle) return;

      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !group.classList.contains("open");
        closeAll(group);
        group.classList.toggle("open", willOpen);
        toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });
    });

    // Click fuera cierra todos
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".nav-group")) closeAll(null);
    });

    // Esc cierra todos
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll(null);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
