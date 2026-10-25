// Hand-built InnerTube payloads with the renderer shapes the Android provider parses.
// They are fixtures, not captures: tests using them prove parsing and transport, not live YouTube.
type Json = Record<string, unknown>;

export const run = (textValue: string, endpoint?: Json): Json => ({ text: textValue, ...(endpoint ? { navigationEndpoint: endpoint } : {}) });
export const runs = (...items: Json[]) => ({ runs: items });
export const pageEndpoint = (browseId: string, pageType: string, params?: string): Json => ({
  browseEndpoint: { browseId, ...(params ? { params } : {}), browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } },
});
export const artistRun = (name: string, id: string) => run(name, pageEndpoint(id, 'MUSIC_PAGE_TYPE_ARTIST'));
export const albumRun = (name: string, id: string) => run(name, pageEndpoint(id, 'MUSIC_PAGE_TYPE_ALBUM'));
export const sep = () => run(' • ');
export const thumb = (url = 'https://lh3.googleusercontent.com/a=w226') => ({
  musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: url.replace('w226', 'w60'), width: 60, height: 60 }, { url, width: 226, height: 226 }] } },
});
export const watch = (videoId: string, playlistId?: string, type = 'MUSIC_VIDEO_TYPE_ATV'): Json => ({
  watchEndpoint: { videoId, ...(playlistId ? { playlistId } : {}), watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } },
});

export function twoRowAlbum(title: string, id: string, artist = 'Coldplay', artistId = 'UCartist1', year = '2021'): Json {
  return {
    musicTwoRowItemRenderer: {
      title: runs(run(title)),
      subtitle: runs(run('Album'), sep(), artistRun(artist, artistId), sep(), run(year)),
      navigationEndpoint: pageEndpoint(id, 'MUSIC_PAGE_TYPE_ALBUM'),
      thumbnailRenderer: thumb(),
      thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'OLAK5uy_' + id } } } } } },
    },
  };
}
export const twoRowArtist = (name: string, id: string): Json => ({
  musicTwoRowItemRenderer: { title: runs(run(name)), subtitle: runs(run('3.2M subscribers')), navigationEndpoint: pageEndpoint(id, 'MUSIC_PAGE_TYPE_ARTIST'), thumbnailRenderer: thumb() },
});
export const twoRowPlaylist = (title: string, id: string): Json => ({
  musicTwoRowItemRenderer: { title: runs(run(title)), subtitle: runs(run('Playlist'), sep(), run('YouTube Music')), navigationEndpoint: pageEndpoint('VL' + id, 'MUSIC_PAGE_TYPE_PLAYLIST'), thumbnailRenderer: thumb() },
});
export const twoRowSong = (title: string, videoId: string, artist = 'Coldplay'): Json => ({
  musicTwoRowItemRenderer: { title: runs(run(title)), subtitle: runs(run('Song'), sep(), artistRun(artist, 'UCartist1')), navigationEndpoint: watch(videoId), thumbnailRenderer: thumb() },
});

export function songRow(title: string, videoId: string, opts: { artist?: string; album?: string; duration?: string; typeLabel?: string; videoType?: string; fixedDuration?: string } = {}): Json {
  const subtitle: Json[] = [];
  if (opts.typeLabel) subtitle.push(run(opts.typeLabel), sep());
  subtitle.push(artistRun(opts.artist ?? 'Coldplay', 'UCartist1'));
  if (opts.album) subtitle.push(sep(), albumRun(opts.album, 'MPREb_album1'));
  if (opts.duration) subtitle.push(sep(), run(opts.duration));
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      thumbnail: thumb(),
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: runs(run(title, watch(videoId, undefined, opts.videoType ?? 'MUSIC_VIDEO_TYPE_ATV'))) } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: subtitle } } },
      ],
      ...(opts.fixedDuration ? { fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs(run(opts.fixedDuration)) } }] } : {}),
    },
  };
}
export function artistRow(name: string, id: string): Json {
  return {
    musicResponsiveListItemRenderer: {
      thumbnail: thumb(),
      navigationEndpoint: pageEndpoint(id, 'MUSIC_PAGE_TYPE_ARTIST'),
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: runs(run(name)) } },
        { musicResponsiveListItemFlexColumnRenderer: { text: runs(run('Artist'), sep(), run('3.2M subscribers')) } },
      ],
    },
  };
}
export function albumRow(title: string, id: string): Json {
  return {
    musicResponsiveListItemRenderer: {
      thumbnail: thumb(),
      navigationEndpoint: pageEndpoint(id, 'MUSIC_PAGE_TYPE_ALBUM'),
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: runs(run(title)) } },
        { musicResponsiveListItemFlexColumnRenderer: { text: runs(run('Album'), sep(), artistRun('Coldplay', 'UCartist1'), sep(), run('2021')) } },
      ],
    },
  };
}
export const continuationItem = (token: string): Json => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
export const nextContinuation = (token: string): Json => ({ continuations: [{ nextContinuationData: { continuation: token } }] });

export const carousel = (title: string, contents: Json[], more?: { browseId: string; params?: string }): Json => ({
  musicCarouselShelfRenderer: {
    header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(run(title)), ...(more ? { moreContentButton: { buttonRenderer: { navigationEndpoint: { browseEndpoint: more } } } } : {}) } },
    contents,
  },
});
export const shelf = (title: string, contents: Json[], extra: Json = {}): Json => ({ musicShelfRenderer: { title: runs(run(title)), contents, ...extra } });

export const homePayload = (sections: Json[], extra: Json = {}) => ({
  contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: sections, ...extra } } } }] } },
});
export const chips = (...titles: string[]) => ({
  header: { chipCloudRenderer: { chips: titles.map((title) => ({ chipCloudChipRenderer: { text: runs(run(title)), navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_home', params: 'chip_' + title } } } })) } },
});
export const searchPayload = (contents: Json[], extra: Json = {}) => ({
  contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents, ...extra } } } }] } },
});

export function albumPayload(trackRows: Json[], extra: Json = {}) {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{
          musicResponsiveHeaderRenderer: {
            title: runs(run('Music of the Spheres')),
            subtitle: runs(run('Album'), sep(), run('2021')),
            straplineTextOne: runs(artistRun('Coldplay', 'UCartist1')),
            secondSubtitle: runs(run('12 songs'), sep(), run('45 minutes')),
            description: { musicDescriptionShelfRenderer: { description: runs(run('The ninth studio album.')) } },
            thumbnail: thumb('https://lh3.googleusercontent.com/album=w544'),
            buttons: [{ musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { playlistId: 'OLAK5uy_album1', videoId: 'v1' } } } }],
          },
        }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [
          { musicShelfRenderer: { contents: trackRows, ...extra } },
          carousel('More by Coldplay', [twoRowAlbum('Parachutes', 'MPREb_para')]),
        ] } },
      },
    },
  };
}

export function artistPayload() {
  return {
    header: {
      musicImmersiveHeaderRenderer: {
        title: runs(run('Coldplay')),
        description: runs(run('British rock band.')),
        thumbnail: thumb('https://lh3.googleusercontent.com/artist=w544'),
        subscriptionButton: { subscribeButtonRenderer: { subscriberCountText: runs(run('3.2M subscribers')) } },
        playButton: { buttonRenderer: { navigationEndpoint: { watchEndpoint: { videoId: 'v1', playlistId: 'RDAMVM1' } } } },
        startRadioButton: { buttonRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDEMartist' } } } },
      },
    },
    contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
      shelf('Songs', [songRow('Yellow', 'v-yellow', { album: 'Parachutes', duration: '4:29' }), songRow('Fix You', 'v-fix', { album: 'X&Y', duration: '4:55' })], { bottomEndpoint: { browseEndpoint: { browseId: 'VLOLAK5uy_songs' } } }),
      carousel('Albums', [twoRowAlbum('Parachutes', 'MPREb_para'), twoRowAlbum('X&Y', 'MPREb_xy')], { browseId: 'UCartist1', params: 'albumsParams' }),
      carousel('Fans might also like', [twoRowArtist('Keane', 'UCkeane'), twoRowArtist('Travis', 'UCtravis')]),
      { musicDescriptionShelfRenderer: { header: runs(run('About')), description: runs(run('British rock band formed in 1997.')) } },
    ] } } } }] } },
  };
}

export const playlistPanel = (items: Json[], extra: Json = {}) => ({
  playlistPanelRenderer: { contents: items, ...extra },
});
export const panelItem = (videoId: string, title: string, selected = false): Json => ({
  playlistPanelVideoRenderer: {
    videoId,
    title: runs(run(title)),
    longBylineText: runs(artistRun('Coldplay', 'UCartist1'), sep(), albumRun('Parachutes', 'MPREb_para'), sep(), run('2000')),
    lengthText: runs(run('4:29')),
    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/' + videoId + '/sddefault.jpg', width: 400 }] },
    navigationEndpoint: watch(videoId, 'RDAMVM' + videoId),
    selected,
  },
});
export const nextPayload = (panel: Json, tabs: Json[] = []) => ({
  contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [
    { tabRenderer: { content: { musicQueueRenderer: { header: { musicQueueHeaderRenderer: { subtitle: runs(run('Radio')) } }, content: panel } } } },
    ...tabs,
  ] } } } },
});
