import { useEffect, useRef, useState } from 'preact/hooks';
import { motionAllowed } from '../../app/motion';

/** The covers the phone falls back on when search gives too few (same list as WelcomeStep.kt). */
export const WELCOME_COVERS = ['Zi_XLOBDo_Y', 'fJ9rUzIMcZQ', 'hTWKbfoikeg', 'dQw4w9WgXcQ', '1w7OgIMMRc4', 'A_MjCqQoLLA', 'Gs069dndIYk', '4fndeDfaWCg', 'PWgvGjAhvIw', '_Yhyp-_hX2s', 'kXYiU_JCYtU', 'yKNxeF4KMsY', 'rYEDA3JcQqw', '4NRXx6U8ABQ', 'oygrmJFKYZY', 'ZRtdQ81jPUQ', 'M2cckDmNLMI', 'mpjTE0qPqJc', 'Qp3b-RXtz4w', 'OPf0YbXqDm0', 'JGwWNGJdvx8'].map((id) => `https://i.ytimg.com/vi/${id}/sddefault.jpg`);

const easeInOut = (t: number) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the disc and the tonearm are at `ms` into the sequence (phone: spawn, play 5 s, despawn). */
export function discState(ms: number): { off: number; arm: number; shake: boolean; done: boolean } {
  const PLAY = 5000;
  const t0 = 1300;
  if (ms < t0 + PLAY) {
    const off = ms < 400 ? 1 : 1 - easeOutBack(clamp((ms - 400) / 900));
    const arm = ms < 700 ? lerp(-90, -30, easeInOut(clamp(ms / 700))) : lerp(-30, -15, easeOutBack(clamp((ms - 700) / 500)));
    return { off, arm, shake: ms >= 1200, done: false };
  }
  const d = ms - (t0 + PLAY);
  const off = lerp(0, 1, easeInOut(clamp(d / 900)));
  const arm = d < 400 ? lerp(-15, -30, easeInOut(clamp(d / 400))) : d < 700 ? -30 : lerp(-30, -90, easeInOut(clamp((d - 700) / 600)));
  return { off, arm, shake: false, done: d >= 1900 };
}

function Disc({ u, hiding, onDone }: { u: number; hiding: boolean; onDone(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const width = (element.width = element.clientWidth || 1280);
    const height = (element.height = element.clientHeight || 720);
    const column = Math.min(width, height * 0.8);
    const left = (width - column) / 2;
    const dp = column / 360;
    const reduced = !motionAllowed();
    const started = performance.now();
    let frame = 0;
    let finished = false;
    const draw = (now: number) => {
      const ms = reduced ? 1800 : now - started;
      const state = discState(ms);
      const spin = ((ms / 4000) * 360) % 360;
      const shake = state.shake ? Math.sin(ms / 200 * Math.PI) : 0;
      context.clearRect(0, 0, width, height);
      const cx = left + column + state.off * column * 1.5;
      const cy = height * 0.3 - state.off * height * 0.6;
      const maxR = column * 0.85;
      context.save();
      context.translate(cx, cy);
      const s = 1 + state.off * 0.5;
      context.scale(s, s);
      context.rotate((spin * Math.PI) / 180);
      const ring = (r: number, color: string, stroke?: number) => { context.beginPath(); context.arc(0, 0, r, 0, Math.PI * 2); if (stroke) { context.lineWidth = stroke; context.strokeStyle = color; context.stroke(); } else { context.fillStyle = color; context.fill(); } };
      ring(maxR, '#2A2A2A');
      ring(maxR * 0.75, '#242424', 2 * dp);
      ring(maxR * 0.5, '#242424', 2 * dp);
      ring(maxR * 0.35, '#333333');
      context.beginPath(); context.arc(0, -maxR * 0.2, maxR * 0.06, 0, Math.PI * 2); context.fillStyle = '#555555'; context.fill();
      ring(maxR * 0.12, '#444444', 4 * dp);
      ring(maxR * 0.08, '#121212');
      context.restore();
      const baseX = left - column * 0.1;
      const baseY = height * 0.45;
      context.save();
      context.translate(baseX, baseY);
      context.rotate(((state.arm + shake) * Math.PI) / 180);
      const length = column * 0.8;
      context.lineCap = 'round'; context.lineWidth = 14 * dp; context.strokeStyle = '#444444';
      context.beginPath(); context.moveTo(0, 0); context.lineTo(length, 0); context.stroke();
      context.fillStyle = '#666666';
      const head = { w: 80 * dp, h: 28 * dp };
      context.beginPath(); context.roundRect(length - head.w / 2, -head.h / 2, head.w, head.h, 14 * dp); context.fill();
      context.restore();
      if (state.done && !finished) { finished = true; done.current(); return; }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas class="onb-welcome-disc" ref={canvas} aria-hidden="true" />;
}

const ROWS = 3;
function Grid({ covers, u, hiding, onDone }: { covers: string[]; u: number; hiding: boolean; onDone(): void }) {
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [moved, setMoved] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setMoved(true))); return () => cancelAnimationFrame(id); }, []);
  const done = useRef(onDone);
  done.current = onDone;
  const size = 170 * u;
  const gap = 14 * u;
  const cols = Math.ceil(covers.length / ROWS);
  const span = cols * (size + gap);
  useEffect(() => {
    if (covers.length === 0) return;
    const out = setTimeout(() => setPhase('out'), 6000);
    const next = setTimeout(() => done.current(), 6000 + (cols - 1) * 40 + 260 + 500);
    return () => { clearTimeout(out); clearTimeout(next); };
  }, [covers.length]);
  return (
    <div class="onb-grid" aria-hidden="true">
      <div class="onb-grid-pan" style={motionAllowed() ? `transition:transform 7s linear;transform:translateX(${moved ? -span * 0.4 : 0}px)` : undefined}>
        {covers.map((url, index) => {
          const col = Math.floor(index / ROWS);
          const row = index % ROWS;
          const x = 60 * u + col * (size + gap) + (row % 2 ? (size + gap) / 2 : 0);
          const y = -size * 0.25 + row * (size + gap);
          const style = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;animation-delay:${phase === 'in' ? col * 120 + row * 60 : col * 40}ms`;
          return <div class={`onb-tile ${phase === 'in' ? 'is-in' : 'is-out'}`} style={style} key={url + index}><img src={url} alt="" decoding="async" /></div>;
        })}
      </div>
    </div>
  );
}

/** The phone's welcome backdrop: drifting green glows, a record player and a wall of covers taking turns. */
export function WelcomeBackdrop({ covers, hiding }: { covers: string[]; hiding: boolean }) {
  const [shown, setShown] = useState<'disc' | 'grid'>('disc');
  const [round, setRound] = useState(0);
  const u = 1.5;
  return (
    <>
      <div class="onb-welcome-glow is-a" />
      <div class="onb-welcome-glow is-b" />
      {shown === 'disc'
        ? <Disc key={round} u={u} hiding={hiding} onDone={() => { if (covers.length) setShown('grid'); else setRound((n) => n + 1); }} />
        : <Grid covers={covers} u={u} hiding={hiding} onDone={() => setShown('disc')} />}
    </>
  );
}
