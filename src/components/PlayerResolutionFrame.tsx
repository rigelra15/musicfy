import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import './PlayerResolutionFrame.css';

/** Every TV page uses the same logical canvas; 1080p is exactly 1.5× the 720p composition. */
export function PlayerResolutionFrame({ active, children }: { active: boolean; children: ComponentChildren }) {
  const readScale = () => window.innerWidth > 0 && window.innerHeight > 0 ? Math.min(window.innerWidth / 1280, window.innerHeight / 720) : 1;
  const [scale, setScale] = useState(readScale);
  useLayoutEffect(() => {
    const resize = () => setScale(readScale());
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <div class={`app-viewport is-tv-resolution ${active ? 'is-player-resolution' : ''}`} style={{ '--player-scale': scale }}>{children}</div>;
}
