// ═══════════════════════════════════════════
// Hero Hub · Efecto eléctrico para "Activar Misión"
// ═══════════════════════════════════════════
// Sistema de relámpagos procedurales + chispas dibujado en Canvas.
//
// API pública:
//   window.HeroElectricity.play(originX, originY, duration?)
//
// El canvas se crea bajo demanda al primer play() y permanece después
// (siempre transparent + pointer-events:none, así que no estorba).

(function () {
  let canvas = null;
  let ctx = null;
  let raf = null;
  const bolts = [];
  const sparks = [];
  const scheduledBolts = [];
  const scheduledSparks = [];
  let endTime = 0;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "electricity-canvas";
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10000;";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Generador procedural de rayos (midpoint displacement) ──
  function generateJaggedPath(x1, y1, x2, y2, displacement, iterations) {
    let points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    let disp = displacement;
    for (let it = 0; it < iterations; it++) {
      const next = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const offset = (Math.random() - 0.5) * disp;
        next.push({ x: mx + nx * offset, y: my + ny * offset });
        next.push(b);
      }
      points = next;
      disp *= 0.5;
    }
    return points;
  }

  function generateBolt(x1, y1, x2, y2, displacement, lifespan) {
    const points = generateJaggedPath(x1, y1, x2, y2, displacement, 6);
    const branches = [];
    // 0-3 ramificaciones cortas saliendo de puntos aleatorios
    const branchCount = Math.random() < 0.75 ? 1 + Math.floor(Math.random() * 3) : 0;
    for (let b = 0; b < branchCount; b++) {
      const idx = 2 + Math.floor(Math.random() * (points.length - 4));
      const start = points[idx];
      const tangent = Math.atan2(
        points[Math.min(idx + 1, points.length - 1)].y - points[Math.max(idx - 1, 0)].y,
        points[Math.min(idx + 1, points.length - 1)].x - points[Math.max(idx - 1, 0)].x
      );
      const branchAngle = tangent + (Math.random() - 0.5) * Math.PI * 0.9;
      const branchLen = 40 + Math.random() * 110;
      const ex = start.x + Math.cos(branchAngle) * branchLen;
      const ey = start.y + Math.sin(branchAngle) * branchLen;
      branches.push(generateJaggedPath(start.x, start.y, ex, ey, displacement * 0.35, 4));
    }
    return { points, branches, born: performance.now(), lifespan, life: 1 };
  }

  function drawPath(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }

  function drawBolt(bolt) {
    const a = bolt.life;
    // 1. Halo exterior cyan Hero — wide & soft
    ctx.shadowColor = "rgba(77, 208, 225, 1)";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = `rgba(6, 163, 182, ${0.18 * a})`;
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPath(bolt.points); ctx.stroke();

    // 2. Capa media cyan-claro
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(150, 230, 245, ${0.55 * a})`;
    ctx.lineWidth = 4;
    drawPath(bolt.points); ctx.stroke();

    // 3. Núcleo blanco brillante
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
    ctx.lineWidth = 1.4;
    drawPath(bolt.points); ctx.stroke();

    // Ramificaciones (más finas)
    for (const br of bolt.branches) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(150, 230, 245, 1)";
      ctx.strokeStyle = `rgba(150, 230, 245, ${0.5 * a})`;
      ctx.lineWidth = 2.2;
      drawPath(br); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * a})`;
      ctx.lineWidth = 0.8;
      drawPath(br); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // ── Chispas (partículas con gravedad + drag) ──
  function spawnSparks(x, y, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 6.5;
      sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1, // ligero empuje hacia arriba
        life: 1,
        size: 1 + Math.random() * 2.4,
        decay: 0.012 + Math.random() * 0.018
      });
    }
  }

  function updateSparks() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08;          // gravedad
      s.vx *= 0.985;         // drag
      s.vy *= 0.985;
      s.life -= s.decay;
      if (s.life <= 0) sparks.splice(i, 1);
    }
  }

  function drawSparks() {
    for (const s of sparks) {
      const a = Math.max(0, s.life);
      // halo cyan
      ctx.fillStyle = `rgba(77, 208, 225, ${a * 0.45})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * 2.3, 0, Math.PI * 2);
      ctx.fill();
      // core blanco
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Loop principal ──
  function loop() {
    const now = performance.now();

    // Disparar bolts/sparks programados
    while (scheduledBolts.length && scheduledBolts[0].at <= now) {
      const sched = scheduledBolts.shift();
      bolts.push(sched.create());
    }
    while (scheduledSparks.length && scheduledSparks[0].at <= now) {
      const sched = scheduledSparks.shift();
      spawnSparks(sched.x, sched.y, sched.count);
    }

    // Limpiar todo el frame
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Actualizar + dibujar bolts (vida basada en lifespan)
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const age = (now - b.born) / b.lifespan;
      b.life = Math.max(0, 1 - age);
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      drawBolt(b);
    }
    updateSparks();
    drawSparks();

    // Continuar mientras quede algo (o no haya pasado el endTime)
    const stillActive = bolts.length || sparks.length ||
                        scheduledBolts.length || scheduledSparks.length ||
                        now < endTime;
    if (stillActive) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  // ── API: play ──
  function play(originX, originY, duration) {
    duration = duration || 1500;
    ensureCanvas();

    // Respeta prefers-reduced-motion: solo unos sparks suaves, sin rayos
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      spawnSparks(originX, originY, 20);
      endTime = performance.now() + 400;
      if (!raf) raf = requestAnimationFrame(loop);
      return;
    }

    endTime = performance.now() + duration;
    const now = performance.now();
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Limpiar cualquier estado previo
    bolts.length = 0;
    sparks.length = 0;
    scheduledBolts.length = 0;
    scheduledSparks.length = 0;

    const scheduleBolt = (delay, fn) => {
      scheduledBolts.push({ at: now + delay, create: fn });
    };
    const scheduleSparkBurst = (delay, x, y, count) => {
      scheduledSparks.push({ at: now + delay, x, y, count });
    };

    // ── Fase 1 (0–300ms): BURST inicial — 10 rayos radiales del CTA ──
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 240 + Math.random() * 360;
      const ex = originX + Math.cos(angle) * dist;
      const ey = originY + Math.sin(angle) * dist;
      const delay = i * 22;
      scheduleBolt(delay, () => generateBolt(originX, originY, ex, ey, 75, 170));
      scheduleSparkBurst(delay + 70, ex, ey, 6 + Math.floor(Math.random() * 6));
    }
    scheduleSparkBurst(0, originX, originY, 18);
    scheduleSparkBurst(80, originX, originY, 12);

    // ── Fase 2 (220–1100ms): CAOS — rayos atravesando la pantalla de borde a borde ──
    for (let i = 0; i < 14; i++) {
      const delay = 220 + i * 60 + Math.random() * 50;
      const side1 = Math.floor(Math.random() * 4);
      const side2 = (side1 + 2) % 4;
      const startP = randomEdgePoint(side1, W, H);
      const endP = randomEdgePoint(side2, W, H);
      scheduleBolt(delay, () => generateBolt(startP.x, startP.y, endP.x, endP.y, 130, 130 + Math.random() * 90));
      scheduleSparkBurst(delay + 60, endP.x, endP.y, 4 + Math.floor(Math.random() * 5));
    }

    // ── Fase 3 (400–1400ms): BUZZ continuo — rayos cortos del CTA ──
    for (let i = 0; i < 18; i++) {
      const delay = 400 + i * 55;
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 280;
      const ex = originX + Math.cos(angle) * dist;
      const ey = originY + Math.sin(angle) * dist;
      scheduleBolt(delay, () => generateBolt(originX, originY, ex, ey, 45, 95));
    }

    // ── Fase 4 (constante): lluvia de chispas alrededor del CTA ──
    const sparkTicks = Math.floor(duration / 75);
    for (let i = 0; i < sparkTicks; i++) {
      const delay = i * 75;
      const spread = 60 + i * 6;
      const sx = originX + (Math.random() - 0.5) * spread;
      const sy = originY + (Math.random() - 0.5) * spread;
      scheduleSparkBurst(delay, sx, sy, 3 + Math.floor(Math.random() * 4));
    }

    if (!raf) raf = requestAnimationFrame(loop);
  }

  function randomEdgePoint(side, W, H) {
    // 0=top, 1=right, 2=bottom, 3=left  (con margen extra para que entren desde fuera)
    if (side === 0) return { x: Math.random() * W, y: -30 };
    if (side === 1) return { x: W + 30, y: Math.random() * H };
    if (side === 2) return { x: Math.random() * W, y: H + 30 };
    return { x: -30, y: Math.random() * H };
  }

  // Permite disparar chispas en cualquier punto desde otros scripts (ej. trail del héroe).
  function spark(x, y, count) {
    ensureCanvas();
    spawnSparks(x, y, count || 4);
    // Mantener el loop corriendo unos ms más si está dormido
    endTime = Math.max(endTime, performance.now() + 600);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  window.HeroElectricity = { play, spark };
})();
