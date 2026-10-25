import { useCallback, useEffect, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import type { EntityRef } from '../../domain/entity';

/** Saved-to-library state of an album, artist or playlist. A failed write leaves the shown state unchanged. */
export function useSaved(ref: EntityRef, details: { title?: string; subtitle?: string; artworkUrl?: string }) {
  const { services } = useApp();
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void services.repo.listSavedEntities(ref.kind).then((all) => { if (live) setSaved(all.some((item) => item.ref.id === ref.id && item.ref.provider === ref.provider)); }).catch(() => undefined);
    return () => { live = false; };
  }, [ref.kind, ref.id, ref.provider]);
  const toggle = useCallback(async () => {
    setFailed(false);
    try {
      if (saved) await services.repo.unsaveEntity(ref);
      else await services.repo.saveEntity({ ref, title: details.title ?? ref.id, subtitle: details.subtitle, artworkUrl: details.artworkUrl });
      setSaved(!saved);
    } catch { setFailed(true); }
  }, [saved, ref.kind, ref.id, ref.provider, details.title, details.subtitle, details.artworkUrl]);
  return { saved, toggle, failed };
}
