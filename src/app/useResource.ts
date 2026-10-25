import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from './AppContext';
import { CatalogRequestError } from '../catalog/gateway';
import type { CatalogErrorKind } from '../catalog/types';

export type Resource<T> =
  | { status: 'loading'; data?: undefined }
  | { status: 'ready'; data: T }
  | { status: 'error'; kind: CatalogErrorKind; message: string; data?: undefined };

/**
 * Loads one page of data and remembers it in the page cache, so coming back with Back shows the
 * same content at once instead of asking again. A failed load keeps the page honest: it reports the
 * kind of failure and `reload()` tries again. Leaving the page aborts a request still in flight.
 */
export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Resource<T> & { reload(): void; set(data: T): void } {
  const { pageCache } = useApp();
  const cacheKey = `resource:${key}`;
  const [state, setState] = useState<Resource<T>>(() => {
    const cached = pageCache.get<T>(cacheKey);
    return cached !== undefined ? { status: 'ready', data: cached } : { status: 'loading' };
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const controller = useRef<AbortController>();

  const run = useCallback(() => {
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState({ status: 'loading' });
    loadRef.current(current.signal).then(
      (data) => { if (controller.current === current) { pageCache.set(cacheKey, data); setState({ status: 'ready', data }); } },
      (error) => {
        if (controller.current !== current) return;
        const kind: CatalogErrorKind = error instanceof CatalogRequestError ? error.kind : 'network';
        if (kind === 'aborted') return;
        setState({ status: 'error', kind, message: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [cacheKey]);

  useEffect(() => {
    if (pageCache.get<T>(cacheKey) === undefined) run();
    else setState({ status: 'ready', data: pageCache.get<T>(cacheKey) as T });
    return () => controller.current?.abort();
  }, [cacheKey]);

  const set = useCallback((data: T) => { pageCache.set(cacheKey, data); setState({ status: 'ready', data }); }, [cacheKey]);
  return { ...state, reload: run, set } as Resource<T> & { reload(): void; set(data: T): void };
}
