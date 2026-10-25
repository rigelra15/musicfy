import type { LocalRows } from './local';
import type { HomeRow } from './model';

export interface OnlineRows {
  /** Recommendation rows already ordered by `arrangeCategories`. */
  categories: HomeRow[];
  community?: HomeRow;
  live?: HomeRow;
  videos?: HomeRow;
  artists?: HomeRow;
  charts?: HomeRow;
  newReleases?: HomeRow;
  /** Rows from YouTube Music's own Home feed, video shelves already moved into live/videos. */
  feed: HomeRow[];
}

/**
 * Row order, as on the Android Home: own history first, with the recommendation rows dealt out
 * between them so the feed is not a wall of "because you like"; the video banners sit apart; the
 * feed's own shelves come last with charts and new releases after the first of them.
 */
export function composeRows(local: LocalRows, online: OnlineRows): HomeRow[] {
  const rows: HomeRow[] = [];
  let next = 0;
  const deal = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const category = online.categories[next];
      if (!category) return;
      rows.push(category);
      next += 1;
    }
  };
  const add = (row: HomeRow | undefined) => { if (row && row.items.length > 0) rows.push(row); };

  add(local.recent);
  add(local.mostPlayed);
  deal();
  add(online.community);
  add(local.quick);
  add(local.history);
  deal();
  add(online.live);
  deal();
  add(online.artists);
  deal();
  add(local.localPlaylists);
  deal();
  add(local.forgotten);
  deal();
  add(online.videos);
  deal(online.categories.length);
  add(local.keepListening);

  const [firstFeed, ...restFeed] = online.feed;
  add(firstFeed);
  add(online.charts);
  add(online.newReleases);
  restFeed.forEach(add);

  // one row id appears once, even if two sources produce the same shelf
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}
