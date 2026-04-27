/**
 * Animated meteor + star canvas — ported from the vanilla app.
 *
 * Renders behind the entire app (fixed position, low z-index). Only
 * runs while the dark theme is active and the document is visible;
 * frees its rAF loop otherwise so it costs nothing in light mode or
 * background tabs.
 */
import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

type Star = { x: number; y: number; radius: number; alpha: number; speed: number; phase: number };

interface SparkInternal { x: number; y: number; vx: number; vy: number; life: number; decay: number }
interface MeteorInternal {
  x: number; y: number; vx: number; vy: number;
  trail: { x: number; y: number }[];
  maxTrail: number;
  size: number;
  alive: boolean;
  sparks: SparkInternal[];
  color: { r: number; g: number; b: number };
}

function spawnMeteor(width: number, height: number): MeteorInternal {
  const angle = 2.62 + (Math.random() - 0.5) * 0.52;
  const speed = 5 + Math.random() * 13;
  const tone = Math.random();
  const color =
    tone < 0.22 ? { r: 158, g: 190, b: 255 } :
    tone < 0.57 ? { r: 255, g: 255, b: 255 } :
    tone < 0.81 ? { r: 255, g: 248, b: 212 } :
                  { r: 255, g: 228, b: 148 };
  return {
    x: width * (0.28 + Math.random() * 0.72),
    y: height * (-0.02 - Math.random() * 0.09),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    trail: [],
    maxTrail: 20 + Math.floor(Math.random() * 38),
    size: 0.8 + Math.random() * 2.2,
    alive: true,
    sparks: [],
    color,
  };
}

function drawMeteor(ctx: CanvasRenderingContext2D, m: MeteorInternal) {
  const count = m.trail.length;
  if (count < 2) return;
  const { r, g, b } = m.color;
  // Wide soft trail.
  for (let i = 1; i < count; i++) {
    const f = i / count;
    const a = m.trail[i - 1]; const c = m.trail[i];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.strokeStyle = `rgba(${r},${g},${b},${Math.pow(f, 2.9) * 0.36})`;
    ctx.lineWidth = Math.max(0.4, Math.pow(f, 1.2) * m.size * 5.8);
    ctx.lineCap = "round";
    ctx.stroke();
  }
  // Bright core trail.
  for (let i = 1; i < count; i++) {
    const f = i / count;
    const a = m.trail[i - 1]; const c = m.trail[i];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.strokeStyle = `rgba(${r},${g},${b},${Math.pow(f, 1.85) * 0.92})`;
    ctx.lineWidth = Math.max(0.25, Math.pow(f, 1.75) * m.size * 1.7);
    ctx.lineCap = "round";
    ctx.stroke();
  }
  // Glow + head.
  const glowR = m.size * 11.5;
  const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, glowR);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.17, `rgba(${r},${g},${b},0.42)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.beginPath(); ctx.arc(m.x, m.y, glowR, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.arc(m.x, m.y, m.size * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,1)"; ctx.fill();
  // Sparks.
  for (const s of m.sparks) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.65, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${s.life * 0.65})`;
    ctx.fill();
  }
}

export function MeteorBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    stars: [] as Star[],
    meteors: [] as MeteorInternal[],
    rafId: 0,
    nextSpawnAt: 0,
  });

  useEffect(() => {
    if (theme !== "dark") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Reseed stars on resize so density stays consistent.
      stateRef.current.stars = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: 0.7 + Math.random() * 1.8,
        alpha: 0.18 + Math.random() * 0.7,
        speed: 0.3 + Math.random() * 1.9,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function frame(now: number) {
      const s = stateRef.current;
      if (document.visibilityState === "hidden" || !canvas || !ctx) {
        s.rafId = 0;
        return;
      }
      s.rafId = requestAnimationFrame(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = now * 0.001;
      for (const star of s.stars) {
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * star.speed + star.phase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${star.alpha * twinkle})`;
        ctx.fill();
      }

      const active = s.meteors.filter((m) => m.alive);
      if (now >= s.nextSpawnAt && active.length < 3) {
        s.meteors.push(spawnMeteor(canvas.width, canvas.height));
        s.nextSpawnAt = now + 650 + Math.random() * 2700;
      }

      for (let i = s.meteors.length - 1; i >= 0; i--) {
        const m = s.meteors[i];
        if (!m.alive) { s.meteors.splice(i, 1); continue; }
        // Update
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > m.maxTrail) m.trail.shift();
        m.vx *= 0.9993; m.vy *= 0.9993;
        m.x += m.vx; m.y += m.vy;
        if (Math.random() < 0.09) {
          m.sparks.push({
            x: m.x, y: m.y,
            vx: m.vx * 0.07 + (Math.random() - 0.5) * 2,
            vy: m.vy * 0.05 + (Math.random() - 0.5) * 1.8,
            life: 0.55 + Math.random() * 0.5,
            decay: 0.028 + Math.random() * 0.042,
          });
        }
        m.sparks = m.sparks.filter((sp) => {
          sp.x += sp.vx; sp.y += sp.vy; sp.vy += 0.1; sp.life -= sp.decay;
          return sp.life > 0;
        });
        if (m.x < -200 || m.y > canvas.height + 100 || m.x > canvas.width + 60) m.alive = false;
        drawMeteor(ctx, m);
      }
    }

    resize();
    stateRef.current.nextSpawnAt = performance.now() + 300;
    stateRef.current.rafId = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (stateRef.current.rafId) cancelAnimationFrame(stateRef.current.rafId);
        stateRef.current.rafId = 0;
      } else {
        stateRef.current.nextSpawnAt = performance.now() + 300;
        if (!stateRef.current.rafId) stateRef.current.rafId = requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    // Capture the current animation bucket for cleanup; the ref may point to a
    // newer bucket by the time React tears this effect down.
    const effectState = stateRef.current;

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (effectState.rafId) cancelAnimationFrame(effectState.rafId);
      effectState.rafId = 0;
      effectState.meteors = [];
      effectState.stars = [];
    };
  }, [theme]);

  if (theme !== "dark") return null;
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10 pointer-events-none"
      aria-hidden
    />
  );
}
