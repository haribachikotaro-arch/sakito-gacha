/* Capsule pile in a rectangular chamber. No external physics dependency. */
(() => {
  "use strict";

  const WIDTH = 240;
  const HEIGHT = 270;
  const STEP = 1 / 60;
  const COLORS = [
    { name: "green", value: "#719b78" },
    { name: "blue", value: "#729bb1" },
    { name: "orange", value: "#dd914e" },
    { name: "red", value: "#bf6d59" },
    { name: "purple", value: "#9584a5" }
  ];

  function rgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function tint(hex, amount) {
    return "rgb(" + rgb(hex).map((value) => Math.round(value + (255 - value) * amount)).join(",") + ")";
  }

  class CapsulePile {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.balls = [];
      this.mixing = false;
      this.destroyed = false;
      this.frame = 0;
      this.lastTime = 0;
      this.accumulator = 0;
      this.elapsed = 0;
      this.calmFrames = 0;
      this.rotorAngle = 0;
      this.driveAngle = 0;
      this.driveIdle = Infinity;
      this.driveSettling = -1;
      this.settlePath = null;
      this.resting = false;
      this.tick = this.tick.bind(this);
      this.resize = this.resize.bind(this);

      for (let index = 0; index < 12; index += 1) {
        this.balls.push(this.createBall(index, false));
      }
      // Simulate before first paint: the first frame is a supported pile.
      for (let frame = 0; frame < 300; frame += 1) this.step(STEP);
      this.balls.forEach((ball) => { ball.vx = 0; ball.vy = 0; ball.spin = 0; });

      this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(this.resize) : null;
      if (this.resizeObserver) this.resizeObserver.observe(canvas);
      window.addEventListener("resize", this.resize);
      this.resize();
    }

    createBall(index, fromTop) {
      const color = COLORS[index % COLORS.length];
      const radius = 23 + (index % 3) * 1.2;
      return {
        x: fromTop ? radius + Math.random() * (WIDTH - radius * 2) : 29 + (index % 4) * 60,
        y: fromTop ? radius + Math.random() * 24 : 35 + Math.floor(index / 4) * 58,
        r: radius,
        vx: fromTop ? (Math.random() - .5) * 25 : (Math.random() - .5) * 12,
        vy: 0,
        angle: (Math.random() - .5) * .8,
        spin: (Math.random() - .5) * .12,
        color: color.value,
        colorName: color.name,
        weight: radius * radius
      };
    }

    resize() {
      if (this.destroyed) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round((rect.width || WIDTH) * dpr));
      const height = Math.max(1, Math.round((rect.height || HEIGHT) * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.draw();
    }

    wake() {
      if (this.destroyed || this.frame) return;
      this.elapsed = 0;
      this.calmFrames = 0;
      this.lastTime = 0;
      this.accumulator = 0;
      this.frame = requestAnimationFrame(this.tick);
    }

    startMix() {
      if (this.destroyed) return;
      // Legacy callers may wake the pile; only turnBy() supplies mechanical motion.
      this.wake();
    }

    turnBy(deltaDegrees) {
      if (this.destroyed || !Number.isFinite(deltaDegrees) || deltaDegrees === 0) return;
      const delta = Math.max(-90, Math.min(90, deltaDegrees));
      this.rotorAngle += delta * Math.PI / 180 * .6;
      this.driveAngle += delta * Math.PI / 180 * .27;
      this.mixing = true;
      this.driveIdle = 0;
      this.driveSettling = .35;
      this.settlePath = null;
      this.resting = false;
      // The geared rake carries the whole supported pile around its low axle.
      // Input is consumed by the fixed physics step, not by pointer event timing.
      this.wake();
    }

    stopMix() {
      this.mixing = false;
      this.driveAngle = 0;
      this.driveIdle = Infinity;
      this.driveSettling = .35;
      this.settlePath = null;
      this.resting = false;
      this.balls.forEach((ball) => { ball.vx *= .15; ball.spin *= .15; });
      this.elapsed = 0;
      this.calmFrames = 0;
      this.wake();
    }

    take() {
      if (this.destroyed || !this.balls.length) return "blue";
      // Lowest ball nearest the center is swallowed by the hidden mechanism.
      let bestIndex = 0;
      let bestScore = Infinity;
      this.balls.forEach((ball, index) => {
        const score = (HEIGHT - ball.y - ball.r) * 2 + Math.abs(ball.x - WIDTH / 2) * .65;
        if (score < bestScore) { bestScore = score; bestIndex = index; }
      });
      const [ball] = this.balls.splice(bestIndex, 1);
      this.resting = false;
      this.driveSettling = -1;
      this.settlePath = null;
      this.elapsed = 0;
      this.wake();
      return ball.colorName;
    }

    refill() {
      if (this.destroyed) return;
      this.resting = false;
      this.driveSettling = -1;
      this.settlePath = null;
      while (this.balls.length < 12) {
        this.balls.push(this.createBall(Math.floor(Math.random() * COLORS.length), true));
      }
      this.elapsed = 0;
      this.wake();
    }

    settleSupport(fraction, maxDrop = Infinity) {
      // A stopped rake leaves a resting pile, never a capsule suspended in air.
      // Project down toward the nearest sphere/floor in bottom-to-top order.
      const ordered = this.balls.slice().sort((a, b) => b.y - a.y);
      ordered.forEach((ball) => {
        let clearance = HEIGHT - ball.r - ball.y;
        this.balls.forEach((support) => {
          if (support === ball || support.y <= ball.y) return;
          const dx = support.x - ball.x;
          const radius = support.r + ball.r;
          if (Math.abs(dx) >= radius) return;
          clearance = Math.min(clearance, support.y - ball.y - Math.sqrt(radius * radius - dx * dx));
        });
        const drop = Math.max(0, Math.min(maxDrop, clearance * fraction));
        ball.y += drop;
        ball.angle += drop * .32 / ball.r;
      });
    }

    step(dt) {
      if (this.resting) return 0;
      this.driveIdle += dt;
      if (this.driveIdle > .09) {
        this.mixing = false;
        this.driveAngle = 0;
      }
      if (!this.mixing && this.driveSettling >= 0) {
        if (!this.settlePath) {
          const start = this.balls.map((ball) => ({ y: ball.y, angle: ball.angle }));
          this.settleSupport(1);
          this.settlePath = this.balls.map((ball, index) => {
            const end = ball.y;
            ball.y = start[index].y;
            ball.angle = start[index].angle;
            ball.vx = 0;
            ball.vy = 0;
            ball.spin = 0;
            return { start: start[index].y, angle: start[index].angle, end };
          });
        }
        this.driveSettling = Math.max(0, this.driveSettling - dt);
        const progress = 1 - this.driveSettling / .35;
        const ease = progress * progress * (3 - 2 * progress);
        let movement = 0;
        this.balls.forEach((ball, index) => {
          const path = this.settlePath[index];
          const y = path.start + (path.end - path.start) * ease;
          movement += Math.abs(y - ball.y);
          ball.y = y;
          ball.angle = path.angle + (y - path.start) * .32 / ball.r;
        });
        if (this.driveSettling === 0) {
          this.resting = true;
        }
        return movement;
      }

      let motion = 0;
      const previous = this.balls.map((ball) => [ball.x, ball.y]);
      const drivenAngle = this.mixing ? Math.max(-.035, Math.min(.035, this.driveAngle)) : 0;
      this.driveAngle -= drivenAngle;
      const driveRate = drivenAngle / dt;
      this.balls.forEach((ball) => {
        if (drivenAngle) {
          const dx = ball.x - WIDTH / 2;
          const dy = ball.y - (HEIGHT - 59);
          // Broad curved rake fingers support the rising side, while contacts
          // transfer the push through the centre and across the top of the pile.
          // Different lever arms give every capsule a different rolling path.
          const rake = 1 + .14 * Math.sin(this.rotorAngle * 2 + ball.x / 31 + ball.y / 47);
          const targetX = -dy * driveRate * rake;
          let targetY = dx * driveRate * .47 * rake;
          if (targetY < 0) targetY *= Math.max(0, Math.min(1, (ball.y - 164) / 34));
          ball.vx += (targetX - ball.vx) * .78;
          ball.vy += (targetY - ball.vy) * .84;
          ball.spin = -driveRate * (.4 + .3 * Math.sin(ball.x / 35 + ball.y / 46));
        }
        ball.vy += 480 * dt;
        ball.vx *= this.mixing ? .95 : .82;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        ball.angle += ball.spin * dt;
        if (!drivenAngle) ball.spin *= .72;
      });

      // Several position/impulse iterations keep stacked spheres in contact.
      for (let pass = 0; pass < 9; pass += 1) {
        this.balls.forEach((ball) => {
          if (ball.x < ball.r) {
            ball.x = ball.r;
            if (ball.vx < 0) ball.vx *= -.06;
          }
          if (ball.x > WIDTH - ball.r) {
            ball.x = WIDTH - ball.r;
            if (ball.vx > 0) ball.vx *= -.06;
          }
          if (ball.y < ball.r) {
            ball.y = ball.r;
            if (ball.vy < 0) ball.vy = 0;
          }
          if (ball.y > HEIGHT - ball.r) {
            ball.y = HEIGHT - ball.r;
            if (ball.vy > 0) ball.vy = 0;
            ball.vx *= .82;
            ball.spin *= .8;
          }
        });

        for (let i = 0; i < this.balls.length; i += 1) {
          for (let j = i + 1; j < this.balls.length; j += 1) {
            const a = this.balls[i];
            const b = this.balls[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || .001;
            const gap = a.r + b.r - distance;
            if (gap <= 0) continue;
            const nx = dx / distance;
            const ny = dy / distance;
            const total = a.weight + b.weight;
            const aShare = b.weight / total;
            const bShare = a.weight / total;
            const correction = (gap + .001) * .9;
            a.x -= nx * correction * aShare;
            a.y -= ny * correction * aShare;
            b.x += nx * correction * bShare;
            b.y += ny * correction * bShare;

            const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (relative < 0) {
              const bounce = 0;
              const impulse = -(1 + bounce) * relative;
              a.vx -= impulse * nx * aShare;
              a.vy -= impulse * ny * aShare;
              b.vx += impulse * nx * bShare;
              b.vy += impulse * ny * bShare;
              a.vx *= .99;
              b.vx *= .99;
            }
          }
        }
      }

      this.balls.forEach((ball, index) => {
        ball.x = Math.max(ball.r, Math.min(WIDTH - ball.r, ball.x));
        ball.y = Math.min(HEIGHT - ball.r, ball.y);
        // A powered rise follows the rake, never a ballistic upward impulse.
        // Without input, remove upward momentum so the pile settles immediately.
        ball.vy = Math.max(this.mixing ? -70 : 0, ball.vy);
        const dx = ball.x - previous[index][0];
        const dy = ball.y - previous[index][1];
        ball.angle += (dx + dy * .32) / ball.r;
        motion += Math.hypot(dx, dy);
      });
      return motion;
    }

    tick(now) {
      this.frame = 0;
      if (this.destroyed) return;
      if (!this.lastTime) this.lastTime = now;
      const delta = Math.min((now - this.lastTime) / 1000, .05);
      this.lastTime = now;
      this.accumulator += delta;
      this.elapsed += delta;
      let motion = 0;
      while (this.accumulator >= STEP) {
        motion += this.step(STEP);
        this.accumulator -= STEP;
      }
      this.draw();
      this.calmFrames = motion < .18 ? this.calmFrames + 1 : 0;
      if (!this.mixing && (this.resting || this.calmFrames > 50 || this.elapsed > 8)) {
        // Final relaxation removes tiny solver residuals before sleeping.
        for (let frame = 0; frame < 45; frame += 1) this.step(STEP);
        this.balls.forEach((ball) => { ball.vx = 0; ball.vy = 0; ball.spin = 0; });
        this.draw();
        this.lastTime = 0;
        return;
      }
      this.frame = requestAnimationFrame(this.tick);
    }

    draw() {
      if (!this.context || this.destroyed) return;
      const ctx = this.context;
      ctx.setTransform(this.canvas.width / WIDTH, 0, 0, this.canvas.height / HEIGHT, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      this.drawRotor(ctx);
      this.balls.forEach((ball) => this.drawBall(ctx, ball));
    }

    drawRotor(ctx) {
      ctx.save();
      ctx.translate(WIDTH / 2, HEIGHT - 43);
      ctx.scale(1, .58);
      ctx.rotate(this.rotorAngle);
      ctx.fillStyle = "rgba(83,108,75,.2)";
      ctx.strokeStyle = "rgba(39,65,44,.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let index = 0; index < 64; index += 1) {
        const angle = index * Math.PI / 32;
        const radius = index % 4 < 2 ? 91 : 86;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Curved fingers remain behind the capsules: they scoop rather than strike.
      for (let arm = 0; arm < 4; arm += 1) {
        ctx.save();
        ctx.rotate(arm * Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(10, -6);
        ctx.quadraticCurveTo(50, -28, 80, -7);
        ctx.lineTo(83, 3);
        ctx.quadraticCurveTo(49, -11, 9, 9);
        ctx.closePath();
        ctx.fillStyle = "rgba(82,108,76,.58)";
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fillStyle = "#677e5e";
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    drawBall(ctx, ball) {
      const r = ball.r;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.angle);
      ctx.shadowColor = "rgba(32, 54, 43, .22)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = tint(ball.color, .58);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();

      const glass = ctx.createLinearGradient(-r, -r, r, r);
      glass.addColorStop(0, "rgba(255,255,255,.86)");
      glass.addColorStop(.42, tint(ball.color, .72));
      glass.addColorStop(1, tint(ball.color, .18));
      ctx.fillStyle = glass;
      ctx.fillRect(-r, -r, r * 2, r * 2);

      // The rolled ticket is visible through the clear upper shell.
      ctx.save();
      ctx.translate(0, -r * .17);
      ctx.rotate(-.22);
      ctx.fillStyle = "rgba(252,247,226,.65)";
      ctx.fillRect(-r * .31, -r * .29, r * .62, r * .54);
      ctx.strokeStyle = "rgba(71,94,76,.24)";
      ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.moveTo(-r * .18, -r * .12);
      ctx.lineTo(r * .18, -r * .12);
      ctx.moveTo(-r * .18, 0);
      ctx.lineTo(r * .1, 0);
      ctx.stroke();
      ctx.restore();

      const base = ctx.createLinearGradient(-r, 0, r, r);
      base.addColorStop(0, tint(ball.color, .22));
      base.addColorStop(.58, ball.color);
      base.addColorStop(1, "#3b5449");
      ctx.fillStyle = base;
      ctx.fillRect(-r, 0, r * 2, r);
      ctx.strokeStyle = "rgba(26,55,42,.38)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * .1, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,.77)";
      ctx.beginPath();
      ctx.ellipse(-r * .35, -r * .46, r * .11, r * .17, .5, 0, Math.PI * 2);
      ctx.fill();
      const sheen = ctx.createRadialGradient(-r * .3, -r * .4, 0, 0, 0, r);
      sheen.addColorStop(0, "rgba(255,255,255,.13)");
      sheen.addColorStop(.75, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(18,48,33,.2)");
      ctx.fillStyle = sheen;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.strokeStyle = "rgba(55,78,65,.31)";
      ctx.lineWidth = .9;
      ctx.beginPath();
      ctx.arc(0, 0, r - .4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (this.resizeObserver) this.resizeObserver.disconnect();
      window.removeEventListener("resize", this.resize);
    }
  }

  window.CapsulePile = CapsulePile;
})();
