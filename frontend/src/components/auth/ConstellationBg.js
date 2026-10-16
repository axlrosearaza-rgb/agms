import { useEffect, useRef } from 'react';

// The sign-in pages' animated background — the dark navy sky with the
// constellation and the floating grade numbers. Used by the Login page and by
// Forgot Password / Set a New Password, so all three look like one place.
/* ── Constellation background ── */
export default function ConstellationBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf, W, H;

    const STAR_COUNT = 150;
    let stars = [];
    let mouse = { x: -9999, y: -9999 };

    /* ── Floating academic grades (1.0 to 5.0) ── */
    const GRADE_MARKS = [
      '1.0', '1.25', '1.5', '1.75', '2.0',
      '2.25', '2.5', '2.75', '3.0', '5.0',
      '1.00', '1.25', '1.50', '2.00', '1.0', '3.0'
    ];
    const GRADE_COUNT = 24;
    const MIN_GRADE_DIST = 140;
    let grades = [];

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      stars = Array.from({ length: STAR_COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.7 + 0.2,
        speed: Math.random() * 0.25 + 0.05,
        drift: (Math.random() - 0.5) * 0.15,
        twinkle: Math.random() * Math.PI * 2,
        color: Math.random() > 0.65
          ? `rgba(201,168,76,`
          : Math.random() > 0.5
            ? `rgba(58,184,204,`
            : `rgba(200,220,255,`,
      }));

      grades = [];
      for (let i = 0; i < GRADE_COUNT; i++) {
        let x = 0, y = 0, attempts = 0;
        do {
          x = Math.random() * W;
          y = Math.random() * H;
          attempts++;
        } while (
          attempts < 50 &&
          grades.some(g => Math.hypot(g.x - x, g.y - y) < MIN_GRADE_DIST)
        );

        grades.push({
          val: GRADE_MARKS[i % GRADE_MARKS.length],
          x,
          y,
          size: Math.random() * 6 + 12, // 12px to 18px
          baseAlpha: Math.random() * 0.22 + 0.14, // 0.14 to 0.36
          speed: Math.random() * 0.22 + 0.08,
          swayFreq: Math.random() * 0.012 + 0.006,
          swayPhase: Math.random() * Math.PI * 2,
          twinkle: Math.random() * Math.PI * 2,
          color: Math.random() > 0.6
            ? '201,168,76'   // gold
            : Math.random() > 0.45
              ? '58,184,204'  // teal
              : '200,225,255', // ethereal blue-white
        });
      }
    }

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    });

    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    function draw() {
      raf = requestAnimationFrame(draw);
      t += 0.012;

      const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
      bg.addColorStop(0,   '#060d1c');
      bg.addColorStop(0.5, '#0a1525');
      bg.addColorStop(1,   '#07111f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const n1 = ctx.createRadialGradient(W * 0.12, H * 0.45, 0, W * 0.12, H * 0.45, W * 0.35);
      n1.addColorStop(0, 'rgba(40,140,180,0.13)');
      n1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = n1; ctx.fillRect(0, 0, W, H);

      const n2 = ctx.createRadialGradient(W * 0.88, H * 0.55, 0, W * 0.88, H * 0.55, W * 0.32);
      n2.addColorStop(0, 'rgba(180,130,30,0.12)');
      n2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = n2; ctx.fillRect(0, 0, W, H);

      // Stars
      stars.forEach(s => {
        s.y -= s.speed;
        s.x += s.drift;
        if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; }
        if (s.x < -4 || s.x > W + 4) { s.x = Math.random() * W; }

        const pulse = Math.sin(t * 1.8 + s.twinkle) * 0.3 + 0.7;
        const alpha = s.a * pulse;

        const dx = s.x - mouse.x, dy = s.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 100) {
          const force = (100 - dist) / 100 * 1.2;
          s.x += (dx / dist) * force;
          s.y += (dy / dist) * force;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = s.color + alpha + ')';
        ctx.fill();
      });

      // Star connecting lines
      ctx.strokeStyle = 'rgba(180,200,255,0.04)';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
          if (d < 90) {
            ctx.globalAlpha = (1 - d / 90) * 0.25;
            ctx.beginPath();
            ctx.moveTo(stars[i].x, stars[i].y);
            ctx.lineTo(stars[j].x, stars[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Mutual separation between floating grade numbers so they maintain space
      for (let i = 0; i < grades.length; i++) {
        for (let j = i + 1; j < grades.length; j++) {
          const dx = grades[j].x - grades[i].x;
          const dy = grades[j].y - grades[i].y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < 120) {
            const push = ((120 - dist) / 120) * 0.35;
            const nx = dx / dist;
            const ny = dy / dist;
            grades[i].x -= nx * push;
            grades[i].y -= ny * push;
            grades[j].x += nx * push;
            grades[j].y += ny * push;
          }
        }
      }

      // ── Floating academic grade numbers (1.0 to 5.0) ──
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      grades.forEach(g => {
        g.y -= g.speed;
        g.x += Math.sin(t * g.swayFreq * 60 + g.swayPhase) * 0.28;

        if (g.y < -30) {
          g.y = H + 30;
          let candX = Math.random() * W;
          for (let att = 0; att < 20; att++) {
            const testX = Math.random() * W;
            if (!grades.some(other => other !== g && Math.hypot(other.x - testX, other.y - (H + 30)) < MIN_GRADE_DIST)) {
              candX = testX;
              break;
            }
          }
          g.x = candX;
        }
        if (g.x < -35) g.x = W + 35;
        if (g.x > W + 35) g.x = -35;

        // Mouse avoidance/repulsion
        const dx = g.x - mouse.x;
        const dy = g.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 110) {
          const force = (110 - dist) / 110 * 1.4;
          g.x += (dx / dist) * force;
          g.y += (dy / dist) * force;
        }

        const pulse = Math.sin(t * 1.5 + g.twinkle) * 0.25 + 0.75;
        const alpha = g.baseAlpha * pulse;

        ctx.font = `600 ${g.size}px 'Inter', sans-serif`;
        ctx.shadowColor = `rgba(${g.color}, ${alpha * 0.85})`;
        ctx.shadowBlur = 9;
        ctx.fillStyle = `rgba(${g.color}, ${alpha})`;
        ctx.fillText(g.val, g.x, g.y);
        ctx.shadowBlur = 0;
      });

      const vig = ctx.createLinearGradient(0, H * 0.6, 0, H);
      vig.addColorStop(0, 'rgba(6,13,28,0)');
      vig.addColorStop(1, 'rgba(6,13,28,0.7)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />;
}

// The soft glow behind the centered content (same as the Login page's).
export function AuthGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', top: '32%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'clamp(480px, 60vw, 800px)', height: 'clamp(480px, 60vw, 800px)', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(58, 184, 204, 0.1) 0%, rgba(201, 168, 76, 0.05) 45%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }}
    />
  );
}
