import { useEffect, useRef, useState } from 'preact/hooks';

interface Layer { id: number; url: string }

/**
 * The cover, blurred and darkened, behind the whole player (as on the phone). A new song's cover fades in over the
 * old one, which is dropped once the fade is done.
 */
export function PlayerBackdrop({ url }: { url?: string }) {
  const [layers, setLayers] = useState<Layer[]>(() => (url ? [{ id: 1, url }] : []));
  const next = useRef(2);
  useEffect(() => {
    if (!url) { setLayers([]); return; }
    setLayers((old) => (old[old.length - 1]?.url === url ? old : [...old, { id: next.current++, url }].slice(-3)));
  }, [url]);
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = setTimeout(() => setLayers((old) => old.slice(-1)), 900);
    return () => clearTimeout(timer);
  }, [layers]);
  return (
    <div class="player-backdrop" aria-hidden="true">
      {layers.map((layer) => <span class="player-backdrop-image" key={layer.id} style={`background-image:url("${layer.url}")`} />)}
      <span class="player-backdrop-shade" />
    </div>
  );
}
