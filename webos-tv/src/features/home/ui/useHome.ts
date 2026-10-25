import { useSnapshot } from '../../../app/useSnapshot';
import type { HomeFeed, HomeSnapshot } from '../feed';

export const useHomeSnapshot = (feed: HomeFeed): HomeSnapshot => useSnapshot(feed);
