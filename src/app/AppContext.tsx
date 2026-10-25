import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { PlayerPanelStore } from '../features/player/panel';
import type { ScrobbleClient } from '../scrobble/client';
import type { ImportRunner } from '../importers/runner';
import type { CatalogGateway } from '../catalog/gateway';
import type { SearchSession } from '../features/search/session';
import type { HomeFeed } from '../features/home/feed';
import type { LibraryData } from '../features/library/data';
import type { ListeningSignals } from '../features/home/signals';
import type { SourcesClient } from '../sources/client';
import type { SourceStatusStore } from '../sources/status';
import type { ImportFlow } from '../backup/flow';
import type { LyricsStore } from '../lyrics/store';
import type { SleepTimer } from '../features/playerMenu/sleepTimer';
import type { Track } from '../model';
import type { QueueOrigin } from '../domain/entity';
import type { PlaybackControls } from './engine';
import type { Language, Translate } from './i18n';
import type { OverlayKind } from './overlay';
import type { Route, Tab } from './router';
import type { Services } from './services';
import type { AppAction, AppStore } from './store';

/** Page state that must survive leaving and re-entering a page (kept in memory, not persisted). */
export interface PageCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface AppContextValue {
  store: AppStore;
  dispatch(action: AppAction): void;
  services: Services;
  t: Translate;
  language: Language;
  controls: PlaybackControls;
  /** The single audio element; lyrics read its clock. Null until the shell has mounted. */
  audio: HTMLAudioElement | null;
  pageCache: PageCache;
  catalog: CatalogGateway;
  signals: ListeningSignals;
  sleep: SleepTimer;
  /** Lyrics of the song that is playing: provider choice, own edit, translation. */
  lyrics: LyricsStore;
  /** Something that arrived from the phone or a file, waiting to be previewed and imported. */
  importFlow: ImportFlow;
  importRunner: ImportRunner;
  scrobble: ScrobbleClient;
  playerPanel: PlayerPanelStore;
  /** The TV service's source API (Monochrome, Apple Music) and what it says about each account. */
  sources: SourcesClient;
  sourceStatus: SourceStatusStore;
  homeFeed: HomeFeed;
  search: SearchSession;
  /** The collection as the Library pages list it; refreshes when the repository changes. */
  library: LibraryData;
  /** Opens a detail page or another tab's route, remembering where focus was. */
  navigate(route: Route): void;
  goTab(tab: Tab): void;
  goBack(): void;
  openOverlay(kind: OverlayKind, options?: { props?: Record<string, unknown>; openerFocusId?: string }): void;
  closeOverlay(id?: number): void;
  /** Replace the queue and start playing `tracks[startIndex]`. */
  /** `shuffle` turns the queue's shuffle mode on and starts from a random song (the Shuffle buttons of albums, playlists and artists). */
  playTracks(tracks: Track[], startIndex: number, origin: QueueOrigin, options?: { shuffle?: boolean }): void;
  enqueue(tracks: Track[], position: 'end' | 'next'): void;
  /** Play one song now and let its radio follow it into the queue (what tapping a song in search does on Android). */
  playSong(track: Track): void;
  /** A short message that fades by itself (what an action just did). It never carries a button the remote would have to reach. */
  toast(message: string): void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
