import type { Track } from '../model';

export interface TimedPiece {
  text: string;
  startMs: number;
  /** Equal to startMs when the source supplies an onset without an end. */
  endMs: number;
}
export interface TimedLyricsLine {
  timeMs: number;
  text: string;
  words?: TimedPiece[];
  syllables?: TimedPiece[];
  agent?: string;
  isBackground?: boolean;
}
export type SourceLyricsDocument =
  | { type: 'synced'; lines: TimedLyricsLine[]; source: string }
  | { type: 'plain'; text: string; source: string }
  | { type: 'missing'; source: string };
export type RequestLyrics = (sourceId: string, track: Track) => Promise<SourceLyricsDocument>;
export type LyricsDetail = 'auto' | 'line' | 'word' | 'syllable';
export interface ProviderDefinition { id: string; name: string; note?: string }
export const lyricsProviders: ProviderDefinition[] = [
  { id: 'BetterLyrics', name: 'Apple Music', note: 'Via the third-party Better Lyrics service' },
  { id: 'YouLyPlus', name: 'YouLyPlus' },
  { id: 'Paxsenix', name: 'PaxSenix' },
  { id: 'SimpMusic', name: 'SimpMusic' },
  { id: 'LrcLib', name: 'LrcLib' },
  { id: 'Deezer', name: 'Deezer' },
  { id: 'YouTubeSubtitle', name: 'YouTube Subtitle' },
  { id: 'YouTubeMusic', name: 'YouTube Music' },
  { id: 'NetEase', name: 'NetEase' },
  { id: 'QQMusic', name: 'QQ Music' },
  { id: 'Kugou', name: 'KuGou' },
  { id: 'YouTubeCaptions', name: 'YouTube Auto Captions', note: 'Speech recognition fallback' },
];
export interface SourceResult {
  id: string;
  status: 'waiting' | 'loading' | 'synced' | 'plain' | 'missing' | 'error';
  document?: SourceLyricsDocument;
  error?: string;
}
