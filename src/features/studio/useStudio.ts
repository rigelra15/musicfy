import { useMemo } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { DEFAULT_STUDIO, PREF_STUDIO, parseStudio, type StudioSettings } from './studio';

/** The saved studio settings (IndexedDB, via preferences) with a way to change one or several fields. */
export function useStudio() {
  const { services, toast, t } = useApp();
  const raw = services.prefs.get<unknown>(PREF_STUDIO, undefined);
  const settings = useMemo(() => parseStudio(raw), [raw]);
  const write = (next: StudioSettings) => {
    services.prefs.set(PREF_STUDIO, next).catch((error: unknown) => toast(t('toast.failed', { message: error instanceof Error ? error.message : String(error) })));
  };
  return {
    settings,
    /** Merges into what is stored right now, so two quick changes do not undo each other. */
    update: (patch: Partial<StudioSettings>) => write(parseStudio({ ...parseStudio(services.prefs.get(PREF_STUDIO, undefined)), ...patch })),
    reset: () => write({ ...DEFAULT_STUDIO }),
  };
}
