// ═══════════════════════════════════════════
// Hero Hub · Campaña de video en el landing
// ═══════════════════════════════════════════
// Muestra un banner de video con poster + botón play. La fecha de expiración
// vive en data-expires del <section>. Después de esa fecha, la sección se
// remueve del DOM y no vuelve a aparecer hasta que se actualice el atributo.
// Click en el botón → oculta el overlay, muestra los controles nativos del
// <video> y arranca la reproducción.

(function () {
  const section = document.getElementById("sec-campaign-video");
  if (!section) return;

  const expires = section.dataset.expires; // "YYYY-MM-DD"
  const today = new Date().toISOString().slice(0, 10);
  if (expires && today > expires) {
    section.remove();
    return;
  }
  section.hidden = false;

  const video = document.getElementById("campaign-video-el");
  const playBtn = document.getElementById("campaign-play-btn");
  if (!video || !playBtn) return;

  playBtn.addEventListener("click", () => {
    playBtn.style.display = "none";
    video.controls = true;
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  });

  // Si el user pausa desde los controles nativos y salta al final, dejamos
  // los controles visibles — no re-mostramos el botón overlay para no molestar.
})();
