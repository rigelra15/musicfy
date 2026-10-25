import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';

/** Honest stand-in for a section whose stage has not landed yet: no fake data, no fake actions. */
export function PlaceholderPage({ title }: { title: string }) {
  const { t, goTab } = useApp();
  return (
    <section class="placeholder-view" aria-labelledby="placeholder-heading">
      <h1 id="placeholder-heading">{title}</h1>
      <p class="message-state">{t('page.soon')}</p>
      <button {...focusProps('placeholder-search', 1, 0)} class="text-action" onClick={() => goTab('search')}>{t('nav.search')}</button>
    </section>
  );
}
