import { useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import type { ActionSpec } from '../detail/ui';
import { readSort, SORT_OPTIONS, sortPrefKey, type SortScope, type SortSettings } from './sort';

/**
 * The saved sort choice for one list, plus the two buttons that change it (the "Urutkan" picker and the
 * ascending/descending switch). The choice is written to preferences; if that write fails the list keeps
 * the order it had and a toast says so.
 */
export function useSort(scope: SortScope, openerId = 'detail-sort') {
  const { t, services, openOverlay, toast } = useApp();
  const [sort, setSortState] = useState<SortSettings>(() => readSort(scope, services.prefs.get(sortPrefKey(scope), undefined)));
  const save = (next: SortSettings) => {
    setSortState(next);
    services.prefs.set(sortPrefKey(scope), next).catch(() => {
      setSortState(sort);
      toast(t('sort.saveFailed'));
    });
  };
  const label = (key: SortSettings['key']) => t(`sort.${key}` as 'sort.name');
  const buttons: ActionSpec[] = [
    {
      id: 'sort',
      label: `${t('sort.by')}: ${label(sort.key)}`,
      icon: 'sliders-horizontal',
      onClick: () => openOverlay('actions', { openerFocusId: openerId, props: {
        title: t('sort.title'),
        actions: SORT_OPTIONS[scope].map((key) => ({ id: `sort-${key}`, label: label(key), selected: key === sort.key, onSelect: () => save({ key, descending: key === 'custom' ? false : sort.descending }) })),
      } }),
    },
    ...(sort.key === 'custom' ? [] : [{
      id: 'sort-dir',
      label: sort.descending ? t('sort.desc') : t('sort.asc'),
      icon: sort.descending ? 'arrow-down' as const : 'arrow-up' as const,
      onClick: () => save({ ...sort, descending: !sort.descending }),
    }]),
  ];
  return { sort, buttons };
}
