# Audit Musicfy Android vs webOS TV — 23 Oktober 2026

## Kesimpulan

Versi TV 0.3.0 saat ini adalah pemutar mandiri dengan pencarian lagu, antrean
sederhana, cover/disc dan lirik. Ini belum merupakan port lengkap aplikasi
Musicfy Android. Perbedaan yang dirasakan pengguna memang didukung bukti:
Home, Library, penjelajahan konten, profil dan sistem pengaturan belum ada.
Mengubah tiga tab atau menambah kartu dekoratif saja tidak menutup kesenjangan.

## Lingkup dan bukti

- HP fisik Samsung SM-A566B / Android16, melalui USB yang diizinkan pengguna.
- APK terpasang: com.example.musicfy, versionCode71, 8.1.0 build#1160.
- Kode Android lokal: 8.1.0 build#1161. Karena berbeda satu build, fitur yang
  hanya ada di kode tidak otomatis dinyatakan terbukti di APK terpasang.
- TV: webos-tv0.3.0 di http://127.0.0.1:4177, ditinjau melalui browser lokal.
- Basis Git saat audit: 37a0dea52aa7ed8d56babe9ca991b437c915e45c.
  webos-tv dan pekerjaan sebelumnya masih berupa perubahan lokal.
- Tidak mengakses TV fisik, memasang APK/IPK, mengubah preferensi atau Library,
  login/logout, mengunduh lagu, atau menguji pembelian/langganan.
- Audit menggunakan navigasi UI. Pencarian Coldplay dijalankan di HP; aplikasi
  dapat menyimpannya ke riwayat pencarian. Lagu semula tetap dijeda pada3:24.
- Screenshot dan UI hierarchy disimpan di evidence/. Screenshot membuktikan
  tampilan, bukan keberhasilan semua tindakan yang ditawarkan tombol.

## Design language

- Audited surface: alur aplikasi musik Android yang terpasang dibandingkan
  seluruh permukaan webOS TV yang tersedia di localhost.
- Design sources: APK di HP, source Android ui/screens dan ui/player, serta
  webos-tv/src/App.tsx, styles, komponen player dan state aktif.
- Documented decisions: logo/palet/identitas Musicfy dipertahankan; navigasi TV
  di atas; cover dan kontrol di kiri, lirik di kanan; opsi di titik tiga.
- Governing owners: Android Screens/NavigationBuilder/HomeScreen dan layar
  turunannya; TV App/appState, Artwork, LyricsView dan runtime.cjs.
- Explicit exceptions: Google Cast HP dan aplikasi IPK mandiri merupakan mode
  terpisah sesuai keputusan pengguna; layout player TV mengikuti referensi
  Apple Music TV. Gestur sentuh tidak harus disalin secara literal ke remote.

## Tiga kesenjangan utama

| # | Problem | Evidence | Proposed change | Scope | Confidence |
|---|---|---|---|---|---|
|1|TV dibuka langsung ke Cari, tanpa Home/discovery|APK Home menampilkan hero, Recently Played, Most Played, More like, Jump Back In, History; TV initialAppState.view=search dan nav hanya3tab|Jadikan Home dengan rak konten nyata sebagai titik masuk|Navigasi, halaman Home, model konten dan data feed|Tinggi: APK+browser+kode|
|2|Tidak ada Library dan jalur menjelajah album/artis/playlist|APK Library memiliki385lagu,5playlist,211artis; daftar My Fav64lagu dan artist Coldplay terbuka. TV hanya Track[] hasil pencarian dan antrean|Port struktur Library dan halaman detail yang menyimpan serta membuka entitas yang sama|Library, penyimpanan, detail konten dan mini-player|Tinggi: APK+browser+kode|
|3|TV hanya membawa sebagian kemampuan player dan layanan aplikasi|APK memiliki profil/statistik, pengaturan, Audio Lab, modul Apple Music; TV dropdown hanya tampilan dan lirik, runtime audio YouTube tamu|Lengkapi kemampuan inti player dan pengaturan dengan status dukungan platform yang jelas|Player, antrean, settings dan sumber audio|Tinggi untuk selisih cakupan; tiap kemampuan baru memerlukan pengujian sendiri|

## Matriks perbandingan

Legenda: **HP** = terlihat langsung pada APK; **Kode** = ditelusuri pada source
Android lokal, belum diuji tindakannya pada APK; **Parsial** = subset di TV.

| Area | Android / bukti | TV0.3.0 | Selisih yang perlu ditutup |
|---|---|---|---|
|Navigasi utama|HP: Home, Search, Your Library, Settings|Cari, Sedang Diputar, Antrean|Hierarki aplikasi berbeda; player/antrean mengambil tempat tab produk utama|
|Halaman awal|HP: Home dengan hero rekomendasi/Continue|Cari|Home belum diimplementasikan, bukan sedang tersembunyi|
|Recently/Most Played|HP: rak cover dan daftar peringkat|Tidak ada|Butuh event mendengarkan tersimpan dan rak yang membuka konten nyata|
|Personalisasi Home|HP: More like, Because you listen to, Jump Back In, History|Tidak ada|Butuh sinyal mendengarkan dan feed; data tidak otomatis ikut dari HP|
|Kategori/feed tambahan|Kode HomeSection: komunitas, artist list, hits, live, music videos, kategori dan feed YouTube; sebagian kondisional|Tidak ada|Jangan menganggap semua rak selalu muncul pada akun/rekaman yang sama|
|Search browse|HP: Moods & moments, Genres|Form pencarian lagu|Belum ada penjelajahan sebelum mengetik|
|Search aktif|HP: Search History dan hasil|Query + hasil lagu|Belum ada riwayat, saran dan hasil lintas jenis|
|Filter hasil|HP: All, Music, Artist, Video, Album terlihat; kode punya hasil Playlist|Songs saja, SONG_FILTER|Butuh jenis entitas dan endpoint browse/continuation|
|Halaman artis|HP: Coldplay, bio/audience, latest release, top songs; Kode album/similar/items|Nama artis sebagai teks|Belum ada route artist atau tindakan buka artis|
|Album|Kode route album dan AlbumScreen; kartu latest-release terlihat di HP, pembukaan album belum terkonfirmasi pada audit ini|Album opsional berupa teks metadata Track|Belum ada album detail, daftar track, play-all|
|Library root|HP: All/Local/Cached/Imported, Songs/Playlist/Albums/Artist/Recently added/Liked|Tidak ada|Butuh data Library persisten dan kategorinya|
|Library songs/artists|HP: daftar lagu alfabetis;211artis terhitung di root|Tidak ada|Belum ada koleksi pengguna, sortir/filter dan daftar entitas|
|Playlist|HP:5playlist, My Fav64lagu, play/shuffle/custom order|Tidak ada|Belum ada create/add/remove/browse playlist|
|Likes/pins|HP: Liked dan tombol heart; Kode pin/speed dial dan toggleLike|Tidak ada|Butuh state dan penyimpanan, bukan sekadar ikon|
|Mini-player|HP: tetap terlihat di Home/Search/Library/Settings|Hanya player page memiliki kontrol|Audio bisa terus berjalan ketika berpindah tab, tetapi kontrol global tidak ada|
|Playback dasar|HP dan TV: putar/jeda, previous/next, seek|Sudah ada|Kemampuan dasar tersedia; tidak membuktikan parity seluruh player|
|Repeat/shuffle/autoplay/radio|HP: Repeat di menu dan Shuffle playlist; Kode shuffle/autoplay/radio|Tidak ada kontrol; hanya maju ke lagu berikut dalam queue|Belum ada mode ulang/acak dan penambahan rekomendasi otomatis|
|Queue|Kode: history/now playing/continue/autoplay, reorder/remove|Daftar datar; pilih lagu saja|Belum ada remove/reorder/play-next dan bagian queue kontekstual|
|Simpan sesi|HP: Save Player's last state di Settings; tab mempertahankan halaman turunannya|Queue/query/posisi di useReducer memori; hanya preferensi tampilan/lirik disimpan|Library dan sesi tidak pulih setelah app diinisialisasi ulang|
|Cover/disc|HP: Customize player; kode8style; TV8style+rotation+label|Parsial|Port fitur pilihan ada; bukan jaminan grafis identik dengan Compose|
|Background player|HP: latar warna album, opsi Youtube background/canvas|Hitam tetap|Warna/komposisi visual player berbeda dari HP; adaptasi TV perlu disepakati per mode|
|Lirik dasar/rich|HP: layar lirik kata; TV12sumber, baris/kata/suku kata|Parsial|Subset yang sudah dipindahkan, tidak seluruh sistem lirik Android|
|Lirik lanjutan|HP: label customization/Shader/bloom; Kode editor, translation, romanization, stagger/swell. Handler label typography belum merupakan editor lengkap|Sumber/detail/Style1-2 saja|Label Style1-2 sama tidak berarti efek/cascade/terjemahan/editor sama|
|Menu player|HP: playlist,download,output,sleep,speed,liked,library,edit player|Tampilan dan pilihan lirik|Belum ada sebagian besar tindakan lagu|
|Sumber audio|HP Audio Quality: Apple Music/AAC; Modules: Apple Music On/Signed in, Monochrome Off|YouTube guest|Apple Music di opsi lirik TV adalah sumber lirik BetterLyrics, bukan audio/modul Apple Music|
|Audio Lab|HP: Equalizer, Audio Effect, Audio Quality, CrossMix; EQ/FX menunjukkanOff saat audit|Tidak ada|Keberhasilan DSP belum diuji; tiap kemampuan harus dinilai terhadap runtime webOS|
|Download/offline/local|HP: kategori Local/Cached/Imported dan tombol Download; Kode DownloadService/local import|Streaming saja|Belum ada penyimpanan media, pengelolaan kuota, recovery dan playback offline|
|Profile/stats|HP: profil, listening time, Version dan View Stats|Tidak ada|Belum ada identitas/profil dan statistik mendengarkan|
|Pengaturan umum|HP: kategori General/Appearance/Playback/Audio Lab/Modules|Opsi player terbatas|Belum ada layar pengaturan aplikasi|
|Import/sync/integrations|HP: kartu imporSpotify/Apple Music/Tidal/YTM; Kode routes import/sync,Discord,Last.fm/Libre.fm|Tidak ada|Tidak diuji proses import/login/sinkronisasinya; belum dapat diklaim tersedia di TV|
|Cast vs mandiri|Kode Android output/device picker; TV IPK mode mandiri|IPK mandiri terpisah dari Google Cast|Perbedaan mode yang sudah disepakati, tidak harus digabung|

## Bukti layar utama

- [Home HP](evidence/android-current.png),
  [Most Played dan rekomendasi](evidence/android-home-lower.png),
  [Jump Back In dan History](evidence/android-home-recommendations.png).
- [Library](evidence/android-library-root.png), [Songs](evidence/android-library-songs.png),
  [Playlists](evidence/android-playlists.png), [Playlist detail](evidence/android-playlist-detail.png).
- [Browse pencarian](evidence/android-search-browse.png),
  [Search history](evidence/android-search-active.png),
  [hasil/filter](evidence/android-search-results.png), [artist](evidence/android-artist.png).
- [Player](evidence/android-player.png), [menu](evidence/android-player-menu.png),
  [tindakan](evidence/android-player-actions-lower.png), [lirik](evidence/android-lyrics.png).
- [Settings](evidence/android-settings-categories.png),
  [Appearance](evidence/android-appearance.png), [Playback](evidence/android-playback-settings.png),
  [Audio Lab](evidence/android-audio-lab.png), [Audio Quality](evidence/android-audio-quality.png),
  [Modules](evidence/android-modules.png).
- [TV Cari — localhost](evidence/tv-search-local.png).
  Player TV terbaru: ../webos-tv/artifacts/ui-unified-player.png.

## Pemilik implementasi yang terkonfirmasi

- Android ui/screens/Screens.kt:17 — empat tab utama.
- Android ui/screens/NavigationBuilder.kt:182 — Home, search, library, settings,
  halaman detail album/artis/playlist, import, modules, Audio Lab dan subhalaman.
- Android ui/screens/HomeScreen.kt:192,1141,1176,1230 — bagian Home dan rak nyata.
- Android viewmodels/HomeViewModel.kt:546,919 — data lokal dan jaringan Home.
- Android ui/screens/search/SearchScreen.kt:329,407 — browse dan pencarian aktif.
- Android ui/screens/library/LibraryHomeScreen.kt:69,336,363 — koleksi dan kategori.
- Android ui/player/QueueScreen.kt:407,464 — hapus, urut dan bagian antrean.
- Android ui/player/menu/PlayerActionMenu.kt:187,281,290 — alat lirik dan tindakan.
- Android ui/player/menu/LyricsToolSheets.kt:83,227,387 — editor/provider/translation.
- TV src/App.tsx:18,276,353,427,457 — nav3tab dan seluruh halaman aktif.
- TV src/appState.ts:27 — halaman awalsearch dan state sesi in-memory.
- TV src/data/youtubeMusic.ts:146,175 — pencarian dibatasi lagu.
- TV service/runtime.cjs:102 — allowlist hanya bootstrap/player/search YouTube,
  audio dan route lirik terpisah. Route browse/home/album/artist belum dilayani.
- TV src/components/LyricsView.tsx:82 — opsi lirik aktual yang diekspos.

## Counterevidence dan batas klaim

- Android sendiri memiliki fitur yang belum aktif: share song pada menu player
  disabled, kartu Ai translation pada menu tersebut juga disabled di source.
  Keduanya bukan fungsi sukses yang bisa diasumsikan wajib disalin begitu saja.
- Modules UI menyebut built-in saat ini dan installable later; runtime source
  sudah mempunyai discover modul bertanda tangan sama/API cocok, tetapi proses
  pemasangan modul eksternal belum diuji. Status UI tidak merangkum seluruh kodenya.
- Library account HP tidak otomatis ada di TV; warna/cover yang sama tidak
  membawa database, riwayat, akun atau session Android.
- Detail antrean, editor/translation, integrasi, download/offline dan DSP ditelusuri
  di kode, bukan diuji end-to-end pada audit ini. Album detail belum dibuka.
- Tidak ada pengukuran FPS atau audio/DSP baru, maupun pengujian TV fisik.
- Audit ini tidak mengubah source produk. Tidak ada commit/push/release baru.

## Improve first

Prioritas pertama adalah **Home sebagai halaman awal dengan konten nyata**.
Ini menjawab perbedaan paling langsung saat aplikasi dibuka, tetapi harus
berjalan bersama model entitas dan penyimpanan dasar; Home dummy tidak cukup.

Urutan pekerjaan berikutnya yang disarankan: Home+model konten → Library+likes+
playlist+history → search lintas jenis dan detail konten → mini-player+queue/
repeat/shuffle/session → settings dan penyempurnaan player/lirik → evaluasi
kelayakan modul audio, offline dan integrasi khusus webOS. Ini urutan prioritas
audit, belum merupakan implementasi atau rencana teknis yang disetujui.


## Pendalaman24 Oktober2026

[Audit Apple Music dan seluruh jalur menu player](2026-10-24-player-menu-applemusic-audit.md)
melengkapi laporan ini:14aksi menu cepat, seluruh kelompok Other menu dan
submenu,5preset player terpisah dari8cover, login Modules vs import Library,
serta koreksi handler typography/output yang belum sepenuhnya berfungsi.
Acuan adaptasi tetap Android dengan layout player TV saat ini dipertahankan.
