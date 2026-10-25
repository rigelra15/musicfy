// Regenerates postman/mocks/youtube-music-catalog/fixtures.json from server/fixtures/innertube.ts.
// Run: node scripts/build-catalog-mock-fixtures.mjs
import { writeFileSync } from 'node:fs';

// Node >=22.18 strips TypeScript types natively; the fixture file only uses erasable syntax.
const fx = await import('../server/fixtures/innertube.ts');
const next = fx.nextPayload(fx.playlistPanel([fx.panelItem('simulated-a', 'Malam di Kota', true), fx.panelItem('simulated-b', 'Pagi Lagi')], fx.nextContinuation('SIMNEXT1')), [
  { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_simulated' } } } },
  { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPTRt_simulated' } } } },
]);
const fixtures = {
  home: fx.homePayload([
    fx.carousel('Quick picks', [fx.twoRowSong('Malam di Kota', 'simulated-a'), fx.twoRowAlbum('Ruang Sore', 'MPREsimulated'), fx.twoRowArtist('Senja', 'UCsimulated'), fx.twoRowPlaylist('Santai', 'PLsimulated')]),
  ], { ...fx.chips('Santai', 'Fokus'), continuations: [{ nextContinuationData: { continuation: 'SIMHOME1' } }] }),
  search: fx.searchPayload([fx.shelf('Songs', [fx.songRow('Malam di Kota', 'simulated-a', { typeLabel: 'Song', artist: 'Senja', album: 'Ruang Sore', duration: '3:42' }), fx.continuationItem('SIMSEARCH1')])]),
  suggest: { contents: [{ searchSuggestionsSectionRenderer: { contents: [{ searchSuggestionRenderer: { suggestion: fx.runs(fx.run('malam di kota')) } }] } }] },
  album: fx.albumPayload([fx.songRow('Malam di Kota', 'simulated-a', { duration: '3:42' })]),
  artist: fx.artistPayload(),
  next,
  continuation: { continuationContents: { musicShelfContinuation: { contents: [fx.songRow('Lagu Lanjutan', 'simulated-c')] } } },
};
writeFileSync('postman/mocks/youtube-music-catalog/fixtures.json', JSON.stringify(fixtures, null, 1) + '\n');
console.log('wrote', Object.keys(fixtures).join(', '));
