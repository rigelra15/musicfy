import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { motionAllowed } from '../app/motion';

const FLIGHT_MS = 700;

/** Covers the screen while the app loads; once ready, the logo glides into the navbar and the cover fades away. */
export function Splash({ leaving, label, alt, onDone }: { leaving: boolean; label?: string; alt: string; onDone: () => void }) {
  const logo = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    document.documentElement.classList.add('splash-on');
    return () => document.documentElement.classList.remove('splash-on');
  }, []);
  useEffect(() => {
    if (!leaving) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.nav-brand')?.getBoundingClientRect();
      const from = logo.current?.getBoundingClientRect();
      if (!target || !from || !from.width || !motionAllowed()) { onDone(); return; }
      const scale = target.width / from.width;
      const dx = target.left + target.width / 2 - (from.left + from.width / 2);
      const dy = target.top + target.height / 2 - (from.top + from.height / 2);
      logo.current!.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      root.current?.classList.add('is-flying');
      timer = setTimeout(onDone, FLIGHT_MS + 40);
    });
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [leaving]);
  return (
    <div class={`splash ${leaving ? 'is-leaving' : ''}`} ref={root} aria-hidden={leaving ? 'true' : undefined}>
      <div class="splash-bg" />
      <div class="splash-logo" ref={logo}><img src="./icon.png" alt={alt} /></div>
      {label && !leaving && <p class="splash-text" role="status">{label}</p>}
    </div>
  );
}
