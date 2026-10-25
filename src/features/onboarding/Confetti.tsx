import { useEffect, useRef } from 'preact/hooks';
import { motionAllowed } from '../../app/motion';

/** Silver confetti: one burst from the card, falling with a little flutter. */
export function Confetti({ originY = 0.42, count = 90, seed = 1 }: { originY?: number; count?: number; seed?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !motionAllowed()) return;
    const context = element.getContext('2d');
    if (!context) return;
    let state = seed % 2147483647 || 1;
    const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
    const width = (element.width = element.clientWidth || 1280);
    const height = (element.height = element.clientHeight || 720);
    const pieces = Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2;
      const speed = 260 + random() * 520;
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 260, size: 5 + random() * 7, spin: (random() - .5) * 12, phase: random() * 6.28, tone: 190 + Math.floor(random() * 60) };
    });
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const time = (now - started) / 1000 - 0.15;
      context.clearRect(0, 0, width, height);
      if (time > 0) {
        for (const piece of pieces) {
          const drag = Math.exp(-time * 1.6);
          const x = width / 2 + piece.vx * (1 - drag) / 1.6 + Math.sin(time * 3 + piece.phase) * 14;
          const y = height * originY + piece.vy * (1 - drag) / 1.6 + 420 * time * time * 0.5;
          const alpha = Math.max(0, 1 - time / 2.6);
          if (alpha <= 0) continue;
          context.save();
          context.translate(x, y);
          context.rotate(piece.spin * time);
          context.scale(1, Math.cos(time * 6 + piece.phase));
          context.globalAlpha = alpha;
          context.fillStyle = `rgb(${piece.tone}, ${piece.tone + 2}, ${piece.tone + 8})`;
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
          context.restore();
        }
      }
      if (time < 2.8) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas class="onb-confetti" ref={canvas} aria-hidden="true" />;
}
