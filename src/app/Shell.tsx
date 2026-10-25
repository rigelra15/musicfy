import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { Track } from '../model';
import type { QueueOrigin } from '../domain/entity';
import { createCatalogGateway, type CatalogGateway } from '../catalog/gateway';
import { HomeFeed } from '../features/home/feed';
import { LibraryData } from '../features/library/data';
import '../features/library/overlays';
import '../features/playerMenu/overlays';
import '../features/studio/overlay';
import '../lyrics/overlays';
import { ImportFlow } from '../backup/flow';
import '../backup/overlays';
import '../importers/overlays';
import '../features/settings/overlays';
import { PlayerPanelStore } from '../features/player/panel';
import { rememberCover } from '../features/player/sharedCover';
import { trackKeyOf } from '../domain/entity';
import { ScrobbleClient } from '../scrobble/client';
import { PREF_SCROBBLE_LIKES, PREF_SCROBBLE_NOW_PLAYING, ScrobbleTimer } from '../scrobble/timer';
import { ImportRunner } from '../importers/runner';
import '../backup/register';
import { LyricsStore } from '../lyrics/store';
import { requestTranslation, type TranslateFn } from '../lyrics/translation';
import { requestServiceLyrics } from '../components/LyricsView';
import { PREF_SPEED } from '../features/playerMenu/prefs';
import { PREF_SLEEP_DEADLINE, SleepTimer } from '../features/playerMenu/sleepTimer';
import { SearchSession } from '../features/search/session';
import { ListeningSignals } from '../features/home/signals';
import { HomePage } from '../pages/HomePage';
import { AlbumPage } from '../pages/AlbumPage';
import { LibraryPage } from '../pages/LibraryPage';
import { PlaylistPage } from '../pages/PlaylistPage';
import { ArtistPage, BrowseListPage } from '../pages/ArtistPage';
import { GenrePage } from '../pages/GenrePage';
import { SectionPage } from '../pages/SectionPage';
import { HistoryPage } from '../pages/HistoryPage';
import { ModulesPage } from '../pages/ModulesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ImportPage } from '../pages/ImportPage';
import { ProfilePage } from '../pages/ProfilePage';
import { NAV_IDLE_MS, navInUse, useIdle } from './idle';
import { Onboarding, onboardingActive } from '../features/home/ui/Onboarding';
import { StatsPage } from '../pages/StatsPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { PlayerPage } from '../pages/PlayerPage';
import { SearchPage } from '../pages/SearchPage';
import { currentIndex, currentTrack, hasNext, queueReducer } from '../playback/queueModel';
import { FAILURE_RETRY_MS, PREF_BLUR, PREF_DONT_SKIP_ON_FAILURE, PREF_FAILURE_TIMEOUT, PREF_SAVE_QUEUE, PREF_SHOW_SOURCE, failureTimeoutSeconds } from '../features/settings/prefs';
import { DEFAULT_HISTORY_SECONDS, ListeningTracker, PREF_HISTORY_PAUSED, PREF_HISTORY_SECONDS } from '../playback/listening';
import { PREF_AUTOPLAY, radioFor } from '../playback/radio';
import { SessionPersister } from '../playback/session';
import { AppContext, type AppContextValue, type PageCache } from './AppContext';
import { usePlaybackEngine, type PlayerFactory } from './engine';
import { HtmlAudioPlayer } from '../playback/htmlAudioPlayer';
import { resolveAudioStream } from '../data/youtubePlayback';
import { readSettings } from '../sources/config';
import { serviceSources, type SourcesClient } from '../sources/client';
import { SourceStatusStore } from '../sources/status';
import { createStreamResolver } from '../sources/resolver';
import { focusProps } from './format';
import { detectLanguage, setActiveLanguage, detectRegion, isLanguage, translator, type Language } from './i18n';
import { MiniPlayer } from './MiniPlayer';
import { PlayerResolutionFrame } from '../components/PlayerResolutionFrame';
import { OverlayHost } from './OverlayHost';
import type { OverlayKind } from './overlay';
import { captureFocus, focusById, focusFirstContent, handleRemoteKey, restoreFocus, revealOnFocus, pageScroller, type MediaKeyAction } from './remote';
import { TABS, canGoBack, currentEntry, currentRoute, routeKey, type Route, type Tab } from './router';
import type { RequestLyrics } from '../lyrics/types';
import type { Services } from './services';
import { appReducer, initialAppStore } from './store';
import { topOverlay } from './overlay';

type FocusIntent = 'nav' | 'forward' | 'back';

export const PREF_LANGUAGE = 'ui.language';

/** What makes a page a new page (and so eases in): another kind of page or another item, not a new query or filter on the same one. */
function pageKey(route: Route): string {
  const r = route as Record<string, unknown>;
  return [route.name, r.id, r.browseId, r.sectionId, r.moduleId, r.section, r.origin].filter((part) => part !== undefined).join(':');
}

function renderRoute(route: Route, t: ReturnType<typeof translator>) {
  switch (route.name) {
    case 'search': return <SearchPage />;
    case 'player': return <PlayerPage />;
    case 'home': return <HomePage />;
    case 'section': return <SectionPage sectionId={route.sectionId} title={route.title} />;
    case 'album': return <AlbumPage key={route.id} id={route.id} />;
    case 'playlist': return <PlaylistPage key={`${route.origin}:${route.id}`} id={route.id} origin={route.origin} />;
    case 'artist':
      return (route.tab === 'songs' || route.tab === 'items') && route.browseId
        ? <BrowseListPage key={`${route.browseId}:${route.params ?? ''}`} browseId={route.browseId} params={route.params} title={route.title ?? route.id} />
        : <ArtistPage key={route.id} id={route.id} title={route.title} />;
    case 'genre': return <GenrePage key={`${route.browseId}:${route.params ?? ''}`} browseId={route.browseId} params={route.params} title={route.title} />;
    case 'library': return <LibraryPage key={`${route.section ?? 'root'}:${route.source ?? ''}`} section={route.section} shelf={route.shelf} source={route.source} />;
    case 'history': return <HistoryPage />;
    case 'stats': return <StatsPage />;
    case 'import': return <ImportPage />;
    case 'settings': return <SettingsPage />;
    case 'profile': return <ProfilePage />;
    case 'modules': return <ModulesPage key={route.moduleId ?? 'list'} moduleId={route.moduleId} />;
    default: return <PlaceholderPage title={route.name} />;
  }
}

export interface AppProps {
  services: Services;
  playerFactory?: PlayerFactory;
  /** Test seam: the catalog client. Defaults to the service on this TV. */
  catalog?: CatalogGateway;
  /** Test seam: clock for the Home refresh policy. */
  now?: () => number;
  /** Test seam: where lyrics come from. Defaults to the service on this TV. */
  lyricsRequest?: RequestLyrics;
  /** Test seam: the source API. Defaults to the service on this TV. */
  sourcesClient?: SourcesClient;
  /** Test seam: the scrobbling service client. Defaults to the service on this TV. */
  scrobbleClient?: ScrobbleClient;
  /** Test seam: the translator. Defaults to the service on this TV. */
  translate?: TranslateFn;
  /** Called once with the live app API after the first render (deep links, session restore, tests). */
  onReady?: (api: () => AppContextValue) => void;
}

export default function App({ services, playerFactory, catalog: catalogProp, now, lyricsRequest, translate, sourcesClient, scrobbleClient, onReady }: AppProps) {
  const [store, dispatch] = useReducer(appReducer, initialAppStore);
  // The song's audio comes from the sources the person turned on, in their order (read when each song starts).
  const servicePlayerFactory = useMemo<PlayerFactory>(() => (audio) => new HtmlAudioPlayer(audio, createStreamResolver({
    settings: () => readSettings(services.prefs),
    youtube: (track) => resolveAudioStream(track.id),
    service: sourcesClient ?? serviceSources,
  })), [services, sourcesClient]);
  const sourceStatus = useMemo(() => new SourceStatusStore(sourcesClient ?? serviceSources), [sourcesClient]);
  const storeRef = useRef(store);
  storeRef.current = store;
  const intent = useRef<FocusIntent>('nav');
  const cache = useRef(new Map<string, unknown>());
  const [, bump] = useState(0);
  const { audioRef, controls } = usePlaybackEngine(store.root, dispatch, playerFactory ?? servicePlayerFactory);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => services.prefs.subscribe(() => bump((value) => value + 1)), [services]);
  const stored = services.prefs.get<unknown>(PREF_LANGUAGE, undefined);
  const language: Language = isLanguage(stored) ? stored : detectLanguage();
  setActiveLanguage(language);
  const t = useMemo(() => translator(language), [language]);

  const catalog = useMemo(() => catalogProp ?? createCatalogGateway({ locale: { hl: language, ...(detectRegion() ? { gl: detectRegion() } : {}) } }), [catalogProp, language]);
  const signals = useMemo(() => new ListeningSignals(services.prefs, now), [services, now]);
  const homeFeed = useMemo(() => new HomeFeed({ repo: services.repo, prefs: services.prefs, gateway: catalog, signals, now }), [services, catalog, signals, now]);
  useEffect(() => { void homeFeed.start(); return () => homeFeed.dispose(); }, [homeFeed]);

  // Listening history: time actually spent playing becomes history events and taste signals.
  const clockRef = useRef(now ?? (() => Date.now()));
  clockRef.current = now ?? (() => Date.now());
  const tracker = useMemo(() => new ListeningTracker({
    sink: { record: (play) => services.repo.recordPlay(play), extend: (id, listenedMs) => services.repo.extendPlay(id, listenedMs) },
    sessionId: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    now: () => clockRef.current(),
    thresholdMs: () => Math.max(0, Number(services.prefs.get(PREF_HISTORY_SECONDS, DEFAULT_HISTORY_SECONDS))) * 1000,
    historyPaused: () => services.prefs.get<boolean>(PREF_HISTORY_PAUSED, false) === true,
    onLeft: (left, listenedMs) => { signals.onTrackLeft(left, listenedMs); },
  }), [services, signals]);
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') tracker.flush(); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', () => tracker.flush());
    return () => document.removeEventListener('visibilitychange', flush);
  }, [tracker]);

  // Scrobbling: plays that count go to the service (which holds the accounts and the retry queue); never blocks playback.
  const scrobble = useMemo(() => scrobbleClient ?? new ScrobbleClient(), [scrobbleClient]);
  const scrobbleTimer = useMemo(() => new ScrobbleTimer({
    sink: { nowPlaying: (track) => { void scrobble.nowPlaying(track).catch(() => undefined); }, scrobble: (track, startedAt) => { void scrobble.scrobble(track, startedAt).catch(() => undefined); } },
    now: () => clockRef.current(),
    wantsNowPlaying: () => services.prefs.get<boolean>(PREF_SCROBBLE_NOW_PLAYING, true) !== false,
  }), [scrobble, services]);
  useEffect(() => services.repo.onLikeChanged((track, liked) => {
    if (services.prefs.get<boolean>(PREF_SCROBBLE_LIKES, false) === true) void scrobble.love(track, liked).catch(() => undefined);
  }), [services, scrobble]);

  // Sleep timer: pauses after a set time, or holds the next song when this one ends.
  const sleep = useMemo(() => new SleepTimer({
    onElapsed: () => controlsRef.current.pause(),
    onSongEndChanged: (armed) => dispatch({ type: 'sleep/songEnd', armed }),
    persist: (deadlineAt) => { void (deadlineAt === undefined ? services.prefs.remove(PREF_SLEEP_DEADLINE) : services.prefs.set(PREF_SLEEP_DEADLINE, deadlineAt)).catch(() => undefined); },
    now: () => clockRef.current(),
  }), [services]);
  useEffect(() => {
    sleep.restore(services.prefs.get<number | undefined>(PREF_SLEEP_DEADLINE, undefined));
    return () => sleep.dispose();
  }, [sleep]);
  const stopAfterTrack = store.root.stopAfterTrack;
  useEffect(() => { if (!stopAfterTrack) sleep.songEndHandled(); }, [stopAfterTrack, sleep]);

  const speed = Number(services.prefs.get(PREF_SPEED, 1));
  useEffect(() => { controlsRef.current.setSpeed(Number.isFinite(speed) ? speed : 1); }, [speed]);

  const lyrics = useMemo(() => new LyricsStore({ repo: services.repo, prefs: services.prefs, request: lyricsRequest ?? requestServiceLyrics, translate: translate ?? requestTranslation, language: () => languageRef.current }), [services, lyricsRequest, translate]);
  const languageRef = useRef(language);
  languageRef.current = language;
  useEffect(() => () => lyrics.dispose(), [lyrics]);

  const importFlow = useMemo(() => new ImportFlow(services.repo, services.prefs), [services]);
  const playerPanel = useMemo(() => new PlayerPanelStore(), []);
  const importRunner = useMemo(() => new ImportRunner(services.repo, catalog), [services, catalog]);

  // Suspend/close (webOS hides the app): playback pauses (background playback is not proven on webOS, so it is not
  // promised), and import matching stops; the queue and position are saved by the pause itself. Coming back never resumes by itself.
  useEffect(() => {
    const suspend = () => {
      if (document.visibilityState !== 'hidden') return;
      const status = storeRef.current.root.playback.status;
      if (status === 'playing' || status === 'buffering' || status === 'loading') controlsRef.current.pause();
      importRunner.cancel();
    };
    document.addEventListener('visibilitychange', suspend);
    return () => document.removeEventListener('visibilitychange', suspend);
  }, [importRunner]);

  const search = useMemo(() => new SearchSession({ gateway: catalog, repo: services.repo, prefs: services.prefs }), [catalog, services]);
  useEffect(() => { void search.loadHistory(); return () => search.dispose(); }, [search]);

  const library = useMemo(() => new LibraryData(services.repo), [services]);
  useEffect(() => { library.start(); return () => library.dispose(); }, [library]);

  const pageCache = useMemo<PageCache>(() => ({
    get: <T,>(key: string) => cache.current.get(key) as T | undefined,
    set: <T,>(key: string, value: T) => { cache.current.set(key, value); },
  }), []);

  const remember = () => { const memory = captureFocus(); dispatch({ type: 'nav/remember', ...memory }); };
  const navigate = useCallback((route: Route) => { remember(); intent.current = 'forward'; dispatch({ type: 'nav/go', route }); }, []);
  const goTab = useCallback((tab: Tab) => {
    if (tab === 'player') rememberCover(document.querySelector('.mini-player .artwork'), 'toPlayer');
    remember(); intent.current = 'nav'; dispatch({ type: 'nav/tab', tab });
  }, []);
  const closeOverlay = useCallback((id?: number) => dispatch({ type: 'overlay/close', id }), []);
  const goBack = useCallback(() => {
    if (storeRef.current.overlays.stack.length > 0) { dispatch({ type: 'overlay/close' }); return; }
    intent.current = 'back';
    dispatch({ type: 'nav/back' });
  }, []);
  const openOverlay = useCallback((kind: OverlayKind, options: { props?: Record<string, unknown>; openerFocusId?: string } = {}) => {
    const opener = options.openerFocusId ?? (document.activeElement as HTMLElement | null)?.dataset?.focusId;
    dispatch({ type: 'overlay/open', kind, props: options.props, openerFocusId: opener });
  }, []);
  // Choosing a song opens the player once it is really playing: armed here, settled by the effect further down.
  const enter = useRef<{ armed: boolean; token?: number; loadId?: number; routeKey?: string }>({ armed: false });
  const arm = () => { enter.current = { armed: true }; setTimeout(() => { if (enter.current.token === undefined) enter.current = { armed: false }; }, 600); };
  const playTracks = useCallback((tracks: Track[], startIndex: number, origin: QueueOrigin, options?: { shuffle?: boolean }) => {
    arm();
    if (options?.shuffle && tracks.length > 0) {
      dispatch({ type: 'queue/replace', tracks, startIndex: Math.floor(Math.random() * tracks.length), origin, shuffleSeed: 1 + Math.floor(Math.random() * 2147483646) });
      return;
    }
    dispatch({ type: 'queue/replace', tracks, startIndex, origin });
  }, []);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const playSong = useCallback((song: Track) => {
    arm();
    dispatch({ type: 'queue/replace', tracks: [song], startIndex: 0, origin: 'manual' });
    // Playback starts at once. With auto-play on the queue refills itself (see below); with it off,
    // tapping a song still brings its radio, unless the user has moved on by the time it arrives.
    if (services.prefs.get(PREF_AUTOPLAY, true)) return;
    void (async () => {
      try {
        const following = await radioFor(catalogRef.current, services.prefs, song);
        const queue = storeRef.current.root.queue;
        if (currentTrack(queue)?.id !== song.id || queue.entries.length !== 1) return;
        if (following.length > 0) dispatch({ type: 'queue/enqueue', tracks: following, position: 'end', origin: 'radio' });
      } catch { /* the song keeps playing without a radio */ }
    })();
  }, [services]);

  // Auto-play: when the last song of the queue is current (repeat off), fetch its radio and append
  // what is not already queued. If that song already ended while the radio was on its way, move on.
  const queueNow = store.root.queue;
  const autoplayOn = services.prefs.get(PREF_AUTOPLAY, true);
  const atLast = currentIndex(queueNow) >= 0 && currentIndex(queueNow) === queueNow.entries.length - 1;
  useEffect(() => {
    const queue = storeRef.current.root.queue;
    const last = currentTrack(queue);
    if (!autoplayOn || !last || queue.repeat !== 'off' || !atLast) return;
    const entryId = queue.currentEntryId;
    const controller = new AbortController();
    void radioFor(catalogRef.current, services.prefs, last, controller.signal).then((tracks) => {
      const live = storeRef.current.root;
      if (live.queue.currentEntryId !== entryId || currentIndex(live.queue) !== live.queue.entries.length - 1) return;
      const action = { type: 'queue/autoplay', tracks } as const;
      if (queueReducer(live.queue, action) === live.queue) return;
      dispatch(action);
      if (live.playback.status === 'ended') dispatch({ type: 'queue/next', reason: 'user' });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [queueNow.currentEntryId, queueNow.entries.length, queueNow.repeat, autoplayOn, atLast, services]);

  // A song whose list did not say how long it is gets its length once the player knows it, so it shows everywhere.
  const learnedFor = useRef<string>('');
  useEffect(() => {
    const track = currentTrack(store.root.queue);
    const length = store.root.playback.durationMs;
    if (!track || track.durationMs > 0 || !(length > 0)) return;
    const key = trackKeyOf(track);
    if (learnedFor.current === key) return;
    learnedFor.current = key;
    dispatch({ type: 'queue/learnDuration', trackKey: key, durationMs: length });
    void services.repo.learnDuration(key, length).catch(() => undefined);
  }, [store.root.playback.durationMs, store.root.playback.loadId, store.root.queue.currentEntryId]);

  useEffect(() => {
    const input = { track: currentTrack(store.root.queue), playToken: store.root.playToken, status: store.root.playback.status };
    tracker.observe(input);
    scrobbleTimer.observe(input);
  }, [tracker, scrobbleTimer, store.root.playback, store.root.playToken]);

  // Session: restore the queue (paused) once at launch, then keep it saved.
  const persister = useMemo(() => new SessionPersister(services.repo, () => {
    const root = storeRef.current.root;
    const loading = root.playback.status === 'loading';
    return {
      queue: root.queue,
      // While a restored song is still loading its reported position is 0; keep the saved one.
      positionMs: loading ? (root.autoplay ? 0 : root.resumeAtMs) : root.playback.positionMs,
      playing: root.playback.status === 'playing',
    };
  }), [services]);
  useEffect(() => {
    let cancelled = false;
    const keep = services.prefs.get<boolean>(PREF_SAVE_QUEUE, true) !== false;
    void (keep ? persister.restore() : Promise.resolve(undefined)).then((session) => {
      if (cancelled) return;
      if (session && storeRef.current.root.queue.entries.length === 0) dispatch({ type: 'session/restored', queue: session.queue, positionMs: session.positionMs });
      persister.start();
    });
    return () => { cancelled = true; persister.dispose(); };
  }, [persister]);
  const playStatus = store.root.playback.status;
  useEffect(() => {
    if (services.prefs.get<boolean>(PREF_SAVE_QUEUE, true) === false) return;
    if (playStatus === 'paused' || playStatus === 'ended' || playStatus === 'error') void persister.flush();
    else persister.notifyChange();
  }, [queueNow, playStatus, persister]);

  // A stream that gave up: the next song starts after the timeout, or the same one is tried again every few seconds (as on the phone).
  useEffect(() => {
    if (playStatus !== 'error') return;
    const stay = services.prefs.get<boolean>(PREF_DONT_SKIP_ON_FAILURE, false) === true;
    if (stay) {
      const timer = setTimeout(() => controlsRef.current.toggle(), FAILURE_RETRY_MS);
      return () => clearTimeout(timer);
    }
    if (!hasNext(storeRef.current.root.queue)) return;
    const timer = setTimeout(() => dispatch({ type: 'queue/next', reason: 'user' }), failureTimeoutSeconds(services.prefs.get(PREF_FAILURE_TIMEOUT, undefined)) * 1000);
    return () => clearTimeout(timer);
  }, [playStatus, store.root.playToken]);

  // "Show where songs play from": which source answered, once per song.
  const announcedSource = useRef<string | undefined>(undefined);
  const playingSource = store.root.playback.source;
  useEffect(() => {
    const entry = store.root.queue.currentEntryId;
    if (!playingSource || !entry || announcedSource.current === `${entry}:${store.root.playback.loadId}`) return;
    announcedSource.current = `${entry}:${store.root.playback.loadId}`;
    if (services.prefs.get<boolean>(PREF_SHOW_SOURCE, false) === true) toast(t('set.sourceToast', { source: playingSource.label }));
  }, [playingSource, store.root.playback.loadId]);

  // "Blur" off: glass surfaces turn solid and the cover backdrop is not softened.
  const blurOn = services.prefs.get<boolean>(PREF_BLUR, true) !== false;
  useEffect(() => { document.documentElement.classList.toggle('no-blur', !blurOn); }, [blurOn]);

  // The play request has been taken (the queue's play token moved): from here, wait for the song to start. Only a load newer
  // than the one running now counts, so the previous song's "playing" never opens the player early; an error or a page change
  // cancels it, and a song that is already on the player screen needs no move.
  const routeNow = routeKey(currentRoute(store.nav));
  useEffect(() => {
    const pending = enter.current;
    if (pending.armed && pending.token === undefined) { enter.current = { armed: false, token: store.root.playToken, loadId: store.root.playback.loadId, routeKey: routeNow }; return; }
    if (pending.token === undefined) return;
    if (pending.token !== store.root.playToken || pending.routeKey !== routeNow) { enter.current = { armed: false }; return; }
    const { status, loadId } = store.root.playback;
    if (status === 'playing' && (loadId ?? 0) > (pending.loadId ?? 0)) { enter.current = { armed: false }; goTab('player'); }
    else if (status === 'error') enter.current = { armed: false };
  }, [store.root.playToken, store.root.playback.status, store.root.playback.loadId, routeNow]);

  const [toastState, setToastState] = useState<{ id: number; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState((current) => ({ id: (current?.id ?? 0) + 1, message }));
    toastTimer.current = setTimeout(() => setToastState(null), 4200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const enqueue = useCallback((tracks: Track[], position: 'end' | 'next') => dispatch({ type: 'queue/enqueue', tracks, position }), []);

  const route = currentRoute(store.nav);
  const entry = currentEntry(store.nav);
  const topOverlayId = topOverlay(store.overlays)?.id;
  const track = currentTrack(store.root.queue);
  const lyricsTrackId = track ? `${track.provider ?? 'youtube'}:${track.id}` : null;
  useEffect(() => { lyrics.load(track); }, [lyrics, lyricsTrackId]);

  // Where focus goes after the page changes: remembered element on Back, first content on a new
  // page, the tab itself when the user picked a tab.
  useEffect(() => {
    if (storeRef.current.overlays.stack.length > 0) return;
    const mode = intent.current;
    intent.current = 'nav';
    if (mode === 'back' && entry.focusId !== undefined && restoreFocus(entry)) return;
    if (mode === 'back') { if (focusFirstContent()) return; }
    if (mode === 'forward' && focusFirstContent()) return;
    pageScroller().scrollTop = 0;
    if (store.nav.tab === 'player') focusFirstContent();
    else focusById(`nav-${store.nav.tab}`);
  }, [store.nav.tab, routeKey(route), store.nav.stacks[store.nav.tab].length]);

  useEffect(() => {
    const media = (action: MediaKeyAction) => {
      const c = controlsRef.current;
      if (action === 'toggle') c.toggle();
      else if (action === 'play') c.play();
      else if (action === 'pause') c.pause();
      else if (action === 'seekForward') c.seekBy(10_000);
      else if (action === 'seekBack') c.seekBy(-10_000);
      else if (action === 'next') dispatch({ type: 'queue/next', reason: 'user' });
      else dispatch({ type: 'queue/previous' });
    };
    const onKey = (event: KeyboardEvent) => {
      const current = storeRef.current;
      handleRemoteKey(event, {
        overlayId: topOverlay(current.overlays)?.id,
        canGoBack: () => canGoBack(current.nav),
        back: goBack,
        activeNavId: `nav-${current.nav.tab === 'player' ? current.nav.cameFrom === 'player' ? 'home' : current.nav.cameFrom : current.nav.tab}`,
        media,
      });
    };
    const closeMenuOutside = (event: PointerEvent) => {
      const menu = document.querySelector<HTMLDetailsElement>('.player-menu[open]');
      if (menu && !menu.contains(event.target as Node)) menu.open = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', closeMenuOutside);
    document.addEventListener('focusin', revealOnFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', closeMenuOutside);
      document.removeEventListener('focusin', revealOnFocus);
    };
  }, [goBack]);

  const context: AppContextValue = {
    store, dispatch, services, t, language, controls, audio: audioRef.current, pageCache, catalog, signals, sleep, lyrics, importFlow, importRunner, scrobble, playerPanel, sources: sourcesClient ?? serviceSources, sourceStatus, homeFeed, search, library,
    navigate, goTab, goBack, openOverlay, closeOverlay, playTracks, enqueue, playSong, toast,
  };
  // First-run onboarding owns the whole screen: no navbar, no mini player, no page behind it.
  const onboarding = route.name === 'home' && onboardingActive(services.prefs);
  const showMini = track !== null && route.name !== 'player' && !onboarding;
  // On the player screen the navbar slides away when nobody has used the remote or pointer for a while, and the page below moves up with it.
  const navIdle = useIdle(NAV_IDLE_MS, route.name === 'player' && !onboarding, navInUse);
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => { onReady?.(() => contextRef.current); }, []);

  // The pill behind the active tab slides from one tab to the next.
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const place = () => {
      const active = navRef.current?.querySelector<HTMLElement>('.nav-link.is-active');
      setPill(active && active.offsetWidth > 0 ? { left: active.offsetLeft, width: active.offsetWidth } : undefined);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [store.nav.tab, language, Boolean(track), onboarding]);

  return (
    <AppContext.Provider value={context}>
      <PlayerResolutionFrame active={route.name === 'player'}>
      <div class={`tv-shell ${showMini ? 'has-mini' : ''} ${onboarding ? 'is-onboarding' : ''} ${navIdle ? 'nav-hidden' : ''}`} inert={topOverlayId !== undefined ? true : undefined}>
        {onboarding ? <Onboarding /> : (<>
        <header class="app-topbar" aria-hidden={navIdle ? 'true' : undefined} inert={navIdle ? true : undefined}>
          <nav class="primary-nav" aria-label={t('nav.main')} ref={navRef}>
            <img class="nav-brand" src="./icon.png" alt={t('app.name')} />
            <span class={`nav-pill ${pill ? 'is-ready' : ''}`} style={pill ? `width:${pill.width}px;transform:translateX(${pill.left}px)` : undefined} aria-hidden="true" />
            {TABS.filter((tab) => tab !== 'player').map((tab, index) => {
              const active = store.nav.tab === tab;
              return (
                <button {...focusProps(`nav-${tab}`, 0, index)} class={`nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => goTab(tab)} key={tab}>
                  {t(`nav.${tab}` as 'nav.home')}
                </button>
              );
            })}
          </nav>
        </header>
        <main class="app-stage" aria-label={t(`nav.${store.nav.tab}` as 'nav.home')}><div class={`page-enter ${route.name === 'player' ? 'is-player' : ''}`} key={pageKey(route)}>{renderRoute(route, t)}</div></main>
        </>)}
        {!onboarding && <MiniPlayer />}
        <div class={`toast ${toastState ? 'is-visible' : ''}`} role="status" aria-live="polite">{toastState?.message ?? ''}</div>
      </div>
      <audio ref={audioRef} preload="metadata" hidden />
      <OverlayHost />
      </PlayerResolutionFrame>
    </AppContext.Provider>
  );
}
