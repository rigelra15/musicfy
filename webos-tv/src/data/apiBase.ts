import { isPackagedTV, serviceBaseUrl } from '../platform/runtime';
export function apiBaseUrl(): string {
  if (isPackagedTV()) return `${serviceBaseUrl()}/api/youtube`;
  return import.meta.env.VITE_YOUTUBE_API_BASE_URL?.trim()
    || (typeof window !== 'undefined' ? '/api/youtube' : 'https://music.youtube.com');
}
