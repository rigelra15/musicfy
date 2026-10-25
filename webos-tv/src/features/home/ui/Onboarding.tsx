import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../../../app/AppContext';
import { focusProps } from '../../../app/format';
import { focusById } from '../../../app/remote';
import { createLatestGuard } from '../../../catalog/gateway';
import type { CatalogItem } from '../../../catalog/types';
import { listImportOptions } from '../../onboarding/registry';
import { Confetti } from '../../onboarding/Confetti';
import { IdCard, OnbButton, OnbChoiceCard, OnbPage, joinedText, newCardNumber } from '../../onboarding/kit';
import { WELCOME_COVERS, WelcomeBackdrop } from '../../onboarding/Welcome';
import { isBackKey } from '../../../app/remote';
import { Icon } from '../../../components/Icon';
import '../../onboarding/onboarding.css';

export const PREF_ONBOARDING_DONE = 'onboarding.done';
export const PREF_PROFILE_NAME = 'profile.name';
export const PREF_PROFILE_CARD = 'profile.cardNumber';
export const PREF_PROFILE_JOINED = 'profile.joinedAt';
/** Set while a phone transfer or backup import is under way: coming back to Home carries on at the profile page (the phone does the same after an import). */
export const PREF_ONBOARDING_RESUME = 'onboarding.resume';
/** The phone: "you need to pick 3 artists". */
export const MIN_ARTISTS = 3;
const CARD_MOMENT_MS = 3000;

interface Pick { id: string; name: string; artworkUrl?: string }
type Step = 'welcome' | 'importAsk' | 'importMode' | 'profile' | 'hello' | 'buildHome' | 'done';
const AUTO: Step[] = ['hello', 'done'];
const isChannel = (id: string | undefined): id is string => !!id && (id.startsWith('UC') || id.startsWith('MPLA'));

/** Artists that appear on the charts, as a first set to pick from when the TV has no history. */
export function artistsFromSongs(items: readonly CatalogItem[]): Pick[] {
  const seen = new Map<string, Pick>();
  for (const item of items) {
    for (const artist of item.artists ?? []) {
      if (isChannel(artist.id) && !seen.has(artist.id)) seen.set(artist.id, { id: artist.id, name: artist.name });
    }
  }
  return [...seen.values()];
}

/**
 * First-run setup, in the phone's order (ui/screens/setup): Welcome, "Importing music", what to
 * import, the profile, Hello, "Let's build your home", Done. Left out because they cannot work on a
 * TV: signing in to Spotify/Apple/Tidal/YouTube in a web view and syncing, picking a profile photo,
 * the blur benchmark and the last page's crossfade / AI filter toggles (the TV has neither).
 */
export function onboardingActive(prefs: { get<T>(key: string, fallback: T): T; isHydrated: boolean }): boolean {
  return prefs.isHydrated && !prefs.get<boolean>(PREF_ONBOARDING_DONE, false);
}

function translateKey(t: (key: never) => string, key: string | undefined, fallback: string): string {
  const text = key ? t(key as never) : fallback;
  return text && text !== key ? text : fallback;
}

const ARTIST_QUERIES = ['popular pop artists', 'rock bands', 'hip hop artists', 'r&b singers', 'indie artists', 'k-pop groups', 'latin artists'];
const COVER_QUERIES = ['top hits', 'classic rock', 'j-pop', 'pop hits 2020s'];
const bigger = (url: string) => url.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544');

export function Onboarding() {
  const { t, services, catalog, homeFeed, navigate, language } = useApp();
  const [history, setHistory] = useState<Step[]>(() => [services.prefs.get<string>(PREF_ONBOARDING_RESUME, '') === 'profile' ? 'profile' : 'welcome']);
  const [forward, setForward] = useState(true);
  const step = history[history.length - 1];
  const [name, setName] = useState(() => services.prefs.get<string>(PREF_PROFILE_NAME, ''));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Pick[] | 'loading' | 'failed'>('loading');
  const [results, setResults] = useState<Pick[] | undefined>(undefined);
  const [picked, setPicked] = useState<Pick[]>([]);
  const [saveError, setSaveError] = useState(false);
  const [leavingWelcome, setLeavingWelcome] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const guard = useRef(createLatestGuard());
  const imports = listImportOptions();
  // After an import from the phone the music is already in: the artists page is for a TV that starts empty.
  const [brought] = useState(() => services.prefs.get<string>(PREF_ONBOARDING_RESUME, '') === 'profile');
  const card = useMemo(() => ({ number: newCardNumber(), joined: joinedText(language) }), [language]);

  const go = (next: Step, replaceCurrent = false) => { setForward(true); setHistory((h) => [...(replaceCurrent ? h.slice(0, -1) : h), next]); };
  const back = () => {
    if (history.length <= 1 || AUTO.includes(step)) return false;
    setForward(false);
    setHistory((h) => h.slice(0, -1));
    return true;
  };

  // Back on the remote steps back through the pages, as the phone's back does; on the first page it leaves the app as usual.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const editable = (event.target as HTMLElement | null)?.tagName === 'INPUT';
      if (!isBackKey(event, editable) || editable && event.key === 'Backspace') return;
      if (back()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [history]);

  useEffect(() => { if (!AUTO.includes(step) && step !== 'buildHome') focusById('onb-primary'); }, [step]);

  // The welcome page's wall of covers: the phone searches four queries, and falls back on a fixed list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found: string[] = [];
      try {
        for (const text of COVER_QUERIES) {
          const page = await catalog.search(text, 'songs');
          for (const item of page.items) if (item.artworkUrl) found.push(bigger(item.artworkUrl));
        }
      } catch { /* the fixed list below */ }
      const unique = [...new Set(found)];
      const list = unique.length >= 12 ? unique.sort(() => Math.random() - 0.5).slice(0, 21) : [...WELCOME_COVERS].sort(() => Math.random() - 0.5);
      if (!cancelled) setCovers(list);
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadSuggestions() {
    setSuggestions('loading');
    try {
      const result = await guard.current.run('suggest', async () => {
        const found = new Map<string, Pick>();
        for (const text of ARTIST_QUERIES) {
          const page = await catalog.search(text, 'artists');
          for (const item of page.items) {
            const id = item.browseId ?? item.id;
            if (item.kind === 'artist' && isChannel(id) && !found.has(id)) found.set(id, { id, name: item.title, artworkUrl: item.artworkUrl });
          }
          if (found.size >= 24) break;
        }
        if (found.size >= 6) return [...found.values()];
        const charts = await catalog.page('FEmusic_charts');
        return artistsFromSongs(charts.sections.flatMap((section) => section.items));
      });
      setSuggestions(result.slice(0, 24));
    } catch (error) {
      if ((error as { kind?: string }).kind !== 'stale') setSuggestions('failed');
    }
  }
  useEffect(() => { if (step === 'buildHome' && suggestions === 'loading') void loadSuggestions(); }, [step]);
  useEffect(() => {
    if (step !== 'buildHome') return;
    const text = query.trim();
    if (!text) { setResults(undefined); return; }
    const timer = setTimeout(() => {
      void guard.current.run('artists', async () => {
        const page = await catalog.search(text, 'artists');
        return page.items.filter((item) => item.kind === 'artist').map((item): Pick => ({ id: item.browseId ?? item.id, name: item.title, artworkUrl: item.artworkUrl })).filter((item) => isChannel(item.id));
      }).then(setResults, (error) => { if ((error as { kind?: string }).kind !== 'stale') setResults([]); });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, step]);

  const toggle = (artist: Pick) =>
    setPicked((current) => current.some((item) => item.id === artist.id) ? current.filter((item) => item.id !== artist.id) : [...current, artist]);

  async function finish() {
    setSaveError(false);
    try {
      const trimmed = name.trim();
      if (trimmed) await services.prefs.set(PREF_PROFILE_NAME, trimmed);
      for (const artist of picked) {
        await services.repo.saveEntity({ ref: { provider: 'youtube', kind: 'artist', id: artist.id }, title: artist.name, artworkUrl: artist.artworkUrl });
        await new Promise((resolve) => setTimeout(resolve, 2)); // saved in the order picked: the first pick is the strongest
      }
      await services.prefs.set(PREF_PROFILE_CARD, card.number);
      await services.prefs.set(PREF_PROFILE_JOINED, Date.now());
      await services.prefs.remove(PREF_ONBOARDING_RESUME);
      await services.prefs.set(PREF_ONBOARDING_DONE, true);
      void homeFeed.refresh();
    } catch {
      setSaveError(true);
    }
  }

  useEffect(() => {
    if (!AUTO.includes(step)) return;
    const timer = setTimeout(() => {
      if (step === 'hello') go(brought ? 'done' : 'buildHome', true);
      else void finish();
    }, CARD_MOMENT_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const shown = results ?? (suggestions === 'loading' || suggestions === 'failed' ? [] : suggestions);
  const artists = [...picked.filter((item) => !shown.some((other) => other.id === item.id)), ...shown];
  const left = Math.max(0, MIN_ARTISTS - picked.length);
  const stepClass = `onb-step ${forward ? '' : 'is-back'} ${AUTO.includes(step) ? 'is-auto' : ''}`;

  return (
    <section class={`onb-root ${step === 'welcome' ? 'is-welcome' : ''}`} aria-labelledby="onb-heading" style="--u:1.4px">
      <div class={stepClass} key={step}>
        {step === 'welcome' && (
          <div class={`onb-welcome ${leavingWelcome ? 'is-hiding' : ''}`}>
            <WelcomeBackdrop covers={covers} hiding={leavingWelcome} />
            <div class="onb-welcome-fade" />
            <div class="onb-welcome-copy">
              <h1 id="onb-heading">{t('onb.welcome.title')}</h1>
              <p>{t('onb.welcome.body')}</p>
            </div>
            <div class="onb-welcome-next">
              <OnbButton {...focusProps('onb-primary', 1, 0)} onClick={() => { setLeavingWelcome(true); setTimeout(() => { go('importAsk'); setLeavingWelcome(false); }, 400); }}>{t('onb.next')}</OnbButton>
            </div>
          </div>
        )}
        {step === 'importAsk' && (
          <OnbPage icon="onb-download" title={t('onb.import.title')} subtitle={t('onb.import.ask')}
            footer={<>
              <OnbButton {...focusProps('onb-primary', 1, 0)} onClick={() => go(imports.length > 0 ? 'importMode' : 'profile')}>{t('onb.import.yes')}</OnbButton>
              <OnbButton {...focusProps('onb-skip', 2, 0)} secondary onClick={() => go('profile')}>{t('onb.import.skip')}</OnbButton>
            </>} />
        )}
        {step === 'importMode' && (
          <OnbPage icon="onb-download" title={t('onb.import.title')} subtitle={t('onb.import.what')}
            footer={<OnbButton {...focusProps('onb-back', 9, 0)} secondary onClick={() => back()}>{t('onb.goBack')}</OnbButton>}>
            {imports.map((option, index) => (
              <OnbChoiceCard {...focusProps(index === 0 ? 'onb-primary' : `onb-import-${index}`, 1 + index, 0)} key={option.id} icon="onb-backup"
                title={translateKey(t, option.titleKey, option.title)} description={translateKey(t, option.descriptionKey, option.description)}
                onClick={() => { void services.prefs.set(PREF_ONBOARDING_RESUME, 'profile').then(() => navigate(option.route)).catch(() => setSaveError(true)); }} />
            ))}
          </OnbPage>
        )}
        {step === 'profile' && (
          <OnbPage icon="onb-person" title={t('onb.profile.title')}
            footer={<>
              <p class="onb-note">{t('onb.profile.note')}</p>
              <OnbButton {...focusProps('onb-next', 3, 0)} disabled={!name.trim()} onClick={() => name.trim() && go('hello')}>{t('onb.next')}</OnbButton>
            </>}>
            <p class="onb-label">{t('onb.profile.ask')}</p>
            <input {...focusProps('onb-primary', 1, 0)} class="onb-field" type="text" value={name} maxLength={32} placeholder={t('onb.profile.placeholder')} aria-label={t('onb.name.label')} onInput={(event) => setName(event.currentTarget.value.slice(0, 32))} />
            <IdCard name={name} number={card.number} joined={card.joined} width={340} />
          </OnbPage>
        )}
        {step === 'hello' && (
          <div class="onb-moment">
            <span class="onb-ring is-sweep" /><span class="onb-ring is-ring" />
            <Confetti seed={Number(card.number.slice(-6))} />
            <div class="onb-moment-card"><IdCard name={name} number={card.number} joined={card.joined} silver width={420 * 1.2} /></div>
            <div class="onb-moment-copy"><h1 id="onb-heading">{t('onb.hello.title')}</h1><p>{t('onb.hello.body')}</p></div>
          </div>
        )}
        {step === 'buildHome' && (
          <OnbPage className="onb-artists-page" icon="onb-home" title={t('onb.build.title')} subtitle={t('onb.build.subtitle')}
            footer={<OnbButton {...focusProps('onb-next', 20, 0)} disabled={left > 0} onClick={() => { if (left === 0) go('done'); }}>
              {left === 3 ? t('onb.build.need') : left === 2 ? t('onb.build.two') : left === 1 ? t('onb.build.one') : t('onb.next')}
            </OnbButton>}>
            <input {...focusProps('onb-primary', 1, 0)} class="onb-field" type="search" value={query} placeholder={t('onb.build.search')} aria-label={t('onb.artists.label')} onInput={(event) => setQuery(event.currentTarget.value)} />
            {suggestions === 'loading' && !results ? <p class="onb-label" role="status">{t('common.loading')}</p>
              : suggestions === 'failed' && !results ? <p class="onb-error" role="status">{t('onb.artists.offline')}</p>
              : artists.length === 0 ? <p class="onb-label" role="status">{t('onb.artists.none')}</p> : null}
            <div class="onb-artist-grid">
              {artists.map((artist, index) => {
                const on = picked.some((item) => item.id === artist.id);
                return (
                  <button {...focusProps(`onb-artist-${index}`, 2 + Math.floor(index / 4), index % 4)} class={`onb-artist ${on ? 'is-on' : ''}`} aria-pressed={on} key={artist.id} onClick={() => toggle(artist)}>
                    <span class="onb-artist-pic">
                      {artist.artworkUrl && <img src={artist.artworkUrl} alt="" loading="lazy" decoding="async" />}
                      {on && <span class="onb-artist-check" aria-hidden="true"><Icon name="onb-check" /></span>}
                    </span>
                    <span class="onb-artist-name">{artist.name}</span>
                  </button>
                );
              })}
            </div>
          </OnbPage>
        )}
        {step === 'done' && (
          <div class="onb-done">
            <Confetti seed={Number(card.number.slice(-6)) + 7} originY={0.6} />
            <span class="onb-done-badge" aria-hidden="true"><Icon name="onb-check" /></span>
            <p class="onb-done-text" id="onb-heading">{t('onb.done.title')}</p>
            <div class="onb-done-card"><IdCard name={name} number={card.number} joined={card.joined} silver width={420 * 1.1} /></div>
          </div>
        )}
      </div>
      {saveError && <p class="message-state error-state" role="alert" style="position:absolute;left:0;right:0;bottom:8px;text-align:center">{t('storage.failed.title')}</p>}
    </section>
  );
}
