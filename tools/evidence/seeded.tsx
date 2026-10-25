// Evidence harness only (never shipped): opens the real storage in the browser, fills it through the real
// repository API with made-up sample songs, and mounts the real app. Used to photograph Library screens.
import { render } from 'preact';
import App from '../../src/App';
import { openServices } from '../../src/app/services';
import '../../src/styles.css';

const art = (i: number) => `https://img.test/${i}.svg`;
const names = ['Angin Pagi', 'Bulan Madu', 'Cahaya Kota', 'Dermaga', 'Embun', 'Fajar', 'Gerimis', 'Hujan Senja', 'Ilusi', 'Jingga', 'Kopi Sore', 'Lentera'];
const artists = ['Sapardi Band', 'Kota Kita', 'Hujan Senja', 'Reda', 'Laut Biru'];
const mk = (i: number) => ({ id: `s${i}`, title: names[i % names.length], artist: artists[i % artists.length], artists: [{ id: `UC${i % 5}`, name: artists[i % 5] }], durationMs: 180_000 + i * 9_000, artworkUrl: art(i), provider: 'youtube' as const });

(async () => {
  const result = await openServices({ audio: document.createElement('audio') });
  if (!result.ok) throw result.error;
  const { repo, prefs } = result.services;
  await prefs.set('ui.language', 'id');
  await prefs.set('onboarding.done', true);
  if (new URLSearchParams(location.search).get('empty') !== '1' && (await repo.listLibrary()).length === 0) {
    const songs = names.map((_, i) => mk(i));
    for (const song of songs) await repo.addToLibrary(song);
    for (const song of songs.slice(0, 5)) await repo.setLiked(song, true);
    const santai = await repo.createPlaylist('Santai Sore');
    await repo.addToPlaylist(santai.id, songs.slice(0, 6));
    const kerja = await repo.createPlaylist('Fokus Kerja');
    await repo.addToPlaylist(kerja.id, songs.slice(4, 9));
    await repo.createPlaylist('Kosong');
    await repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREb_laut' }, title: 'Laut Biru', subtitle: 'Album • 2024', artworkUrl: art(3) });
    await repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREb_senja' }, title: 'Senja di Kota', subtitle: 'Album • 2022', artworkUrl: art(4) });
    await repo.saveEntity({ ref: { provider: 'youtube', kind: 'artist', id: 'UCsapardi' }, title: 'Sapardi Band', artworkUrl: art(1) });
    await repo.pin({ provider: 'local', kind: 'playlist', id: santai.id });
    await repo.pin({ provider: 'youtube', kind: 'track', id: 's2' });
    await repo.pin({ provider: 'youtube', kind: 'artist', id: 'UCsapardi' });
  }
  render(<App services={result.services} />, document.getElementById('app')!);
})();
