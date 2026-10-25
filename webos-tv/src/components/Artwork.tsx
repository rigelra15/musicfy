import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { advanceArtworkFallback, createArtworkState, type ArtworkSize, type ArtworkState } from '../data/artwork';
import type { CoverStyle } from '../data/playerPreferences';
import './Artwork.css';

export interface ArtworkProps {
  track: { id: string; artworkUrl?: string; title: string; artist: string; album?: string };
  size: ArtworkSize;
  style?: CoverStyle;
  playing?: boolean;
  rotating?: boolean;
  realistic?: boolean;
  label?: string;
}

function ArtworkImage({ initial }: { initial: ArtworkState }) {
  const [state, setState] = useState(initial);
  const source = state.candidates[state.index];
  const fallback = source === './icon.png';
  return (
    <span class={`artwork-image ${fallback ? 'artwork-image-fallback' : ''}`}>
      <img src={source} alt="" loading="eager" decoding="async"
        onError={() => setState((current) => advanceArtworkFallback(current, source))} />
    </span>
  );
}

/** CSS-only label rotation keeps the vinyl's grooves and light stationary, as on mobile. */
export function Artwork({ track, size, style = 'SQUARED', playing = false,
  rotating = true, realistic = true, label = '' }: ArtworkProps) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );
  const initial = useMemo(() => createArtworkState(track, size), [track.id, track.artworkUrl, size]);
  const isDisc = style !== 'SQUARED' && style !== 'EDGE_TO_EDGE';
  const printedLabel = useMemo(() => {
    const unit = `${label.trim().toUpperCase()} · `;
    if (!label.trim()) return [];
    // Repeat the name around the full rim; cap glyph count for long custom names.
    return Array.from(unit.repeat(Math.max(1, Math.floor(84 / unit.length)))).slice(0, 120);
  }, [label]);

  useEffect(() => {
    const onVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
    );
    if (root.current) observer?.observe(root.current);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, []);

  const image = (suffix: string) => <ArtworkImage key={`${initial.key}-${suffix}`} initial={initial} />;
  const running = isDisc && playing && rotating && visible && documentVisible;
  return (
    <span ref={root} class={`cover cover-${size} artwork artwork-${style.toLowerCase().replace(/_/g, '-')} ${isDisc ? 'artwork-disc' : ''} ${realistic ? 'artwork-realistic' : ''}`}
      aria-hidden="true" data-cover-style={style} data-spinning={running ? 'true' : 'false'}>
      {isDisc ? (
        <>
          {style === 'TURNTABLE' && <span class="artwork-deck" />}
          <span class="artwork-record">
            <span class="artwork-vinyl" />
            <span class="artwork-rotor">
              <span class="artwork-label">{image('disc')}</span>
              {printedLabel.length > 0 && <span class="artwork-lettering">
                {printedLabel.map((letter, index) => <span key={index}
                  style={{ transform: `rotate(${index * 360 / printedLabel.length}deg)` }}>{letter}</span>)}
              </span>}
            </span>
            <span class="artwork-spindle" />
          </span>
          {style === 'DISC_ALBUM' && <span class="artwork-album-card">{image('album')}</span>}
          {(style === 'TURNTABLE' || style === 'DISC_BIG_LABEL') && <span class="artwork-tonearm"><span /></span>}
        </>
      ) : image('square')}
    </span>
  );
}
