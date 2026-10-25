# Musicfy webOS — Rencana Adaptasi Lengkap dari Android

> **Nama file handoff:** `docs/superpowers/plans/2026-10-24-musicfy-webos-full-adaptation.md`
>
> **Untuk Claude/pelaksana:** dokumen ini menjadi acuan utama pekerjaan berikutnya. Implementasikan bertahap berdasarkan kode Android yang ada, pertahankan pekerjaan webOS yang sudah berfungsi, dan perbarui checklist serta bukti pengujian setelah setiap tahap.
>
> **Status:** dalam eksekusi — T0–T7 selesai (24 Oktober 2026); berikutnya T8. Perubahan status per tahap dicatat pada checklist di bagian 7.
>
> **Metode:** eksekusi berurutan. Gunakan `superpowers:executing-plans` jika tersedia; bila tidak, ikuti tahapan dan gerbang pengujian dalam dokumen ini secara langsung.

## 1. Tujuan dan keputusan yang sudah dikunci

### Tujuan

Mengembangkan aplikasi Musicfy webOS menjadi adaptasi lengkap pengalaman Musicfy Android: Home, penjelajahan musik, Library, playlist, player, seluruh menu turunannya, lirik, pengaturan, impor/backup, dan integrasi yang didukung platform.

Aplikasi harus berjalan langsung dari TV melalui satu `.ipk`, tanpa komputer atau server pengembang yang harus terus menyala.

### Keputusan pengguna

- Android adalah acuan fitur, nama opsi, struktur konten, state, dan perilaku.
- Pertahankan layout player TV saat ini:
  - Cover dan kontrol di kiri.
  - Lirik langsung di kanan.
  - Navigasi utama di atas.
  - Opsi tambahan melalui titik tiga.
  - Logo Musicfy di bagian kiri navigasi.
  - Padding vertikal navbar tetap ringkas.
- Data TV mandiri, dengan impor/backup eksplisit dari HP.
- Tidak membangun server sinkronisasi cloud atau sinkronisasi otomatis dua arah HP–TV.
- HP boleh membantu setup/login jika autentikasi langsung di TV tidak memungkinkan.
- Setelah setup, pemutaran normal tetap berjalan dari TV tanpa komputer.
- Google Cast Android dan aplikasi IPK mandiri tetap menjadi dua mode terpisah.
- Pengujian saat ini hanya lokal.
- **Dilarang mengakses, memindai, memasang, meluncurkan, atau menguji TV fisik sampai ada izin baru dari pengguna.**
- Perubahan Android dibatasi pada kebutuhan pendamping setup, transfer, dan ekspor data; perilaku utama aplikasi HP dipertahankan.

### Batas klaim hasil

“Lengkap” berarti seluruh keluarga fitur dipetakan dan ditangani secara eksplisit. Fitur hanya dinyatakan berfungsi bila jalur tindakannya sudah diimplementasikan dan diuji.

Fitur yang memerlukan DRM, DSP, lifecycle, atau kemampuan perangkat khusus harus mempunyai status dukungan dan bukti tersendiri. Menu yang tampil, build yang berhasil, atau login yang sukses tidak cukup untuk membuktikan playback atau efek audio.

Tidak membuat tombol kosong, data rekomendasi palsu, status sukses buatan, maupun label kualitas yang tidak sesuai sumber audio sebenarnya.

---

## 2. Kondisi awal dan sumber acuan

### Implementasi webOS yang dipertahankan

- Proyek: `/Users/rigelra/Devs/musicfy`.
- Aplikasi webOS berada dalam `webos-tv`.
- Baseline versi: `0.3.0`.
- Preact, TypeScript, Vite, Vitest.
- UI dibangun untuk paket dengan `base: './'`.
- Service native: `com.musicfy.webos.service`.
- App ID: `com.musicfy.webos`.
- Service menggunakan Node.js 16 dan modul inti Node, tanpa ketergantungan desktop `fetch` atau native addon.
- Komputer pengembang menggunakan Node.js minimal 22.12.
- Bootstrap melalui Luna subscription.
- Relay pemutaran normal hanya mendengarkan loopback.
- Sudah ada pencarian lagu, playback, antrean sederhana, delapan model cover/disc, dan dua belas adapter lirik.
- Baseline pengujian yang diverifikasi saat perencanaan: **110 tes dalam 18 file lulus; typecheck lulus**.
- Bukti TV versi sebelumnya bersifat historis dan tidak membuktikan fitur baru dalam plan ini.

### Sumber yang wajib dibaca

1. `design-plans/2026-10-23-android-tv-parity-audit.md`.
2. `design-plans/2026-10-24-player-menu-applemusic-audit.md`.
3. Source Android:
   - Navigasi, Home, Search, Library, artist/album/playlist.
   - Player, Player Studio, menu, lirik, dan antrean.
   - Settings, Audio Lab, Modules, importer, scrobble, dan onboarding.
4. Source provider:
   - InnerTube.
   - Apple Music dan Monochrome.
   - Lirik, canvas, dan integrasi yang dipakai Android.

APK yang diaudit pada HP adalah `8.1.0 build#1160`; source Android lokal menunjukkan `build#1161`. Perbedaan ini harus dicatat saat membandingkan perilaku source dengan APK.

### Aturan workspace

- Gunakan checkout yang ada.
- Jangan membuat worktree baru.
- Jangan reset, clean, atau menimpa perubahan pengguna.
- `webos-tv` dan sejumlah dokumen masih untracked; jangan menganggap semuanya sudah tercakup oleh commit Git.
- Jangan commit, push, deploy, atau memasang APK/IPK tanpa permintaan terpisah.
- Ikuti instruksi repo dan `/Users/rigelra/.codex/RTK.md`; perintah shell menggunakan awalan `rtk`.
- Jangan menyalin screenshot, profil, data akun, atau koleksi pribadi pengguna sebagai data bawaan produk.

---

## 3. Arsitektur yang dipilih

### Pendekatan

Lanjutkan aplikasi Preact/Vite dan service Node yang sudah ada. Port kontrak perilaku Android ke modul webOS secara bertahap.

Tidak melakukan rewrite aplikasi, tidak membuat backend cloud baru, dan tidak menggantungkan runtime TV pada HP atau komputer.

### Pembagian tanggung jawab

| Lapisan | Tanggung jawab |
|---|---|
| App shell | Navigasi, route, focus remote, mini-player, overlay, lifecycle UI |
| Domain | Entitas katalog, Library, playlist, queue, playback session, history |
| Catalog | Home, search, suggestions, browse, detail, continuation, related/radio |
| Repository | Library dan preferensi persisten, transaksi, migrasi, backup |
| Playback | Satu sumber waktu playback, mode ulang/acak, resolusi provider |
| Lyrics | Lookup, pemilihan sumber, timing, editor, translation, readings |
| Service native | Transport jaringan, media, credential akun, file media, pekerjaan transfer |
| Android companion | Setup akun dan transfer eksplisit yang tidak dapat dilakukan langsung di TV |
| Capability layer | Dukungan per fitur, sumber bukti, dan alasan keterbatasan |

### Struktur implementasi

Pertahankan modul yang sudah bekerja. Pecah `App.tsx` saat fitur baru ditambahkan agar tidak menjadi pusat seluruh logika.

Gunakan kelompok berikut di bawah `webos-tv/src`:

- `app`: shell, router, overlay, lifecycle.
- `domain`: tipe bersama dan aturan identitas.
- `catalog`: client dan normalisasi katalog.
- `library`: repository dan layar koleksi.
- `playback`: engine, queue, session, listening clock.
- `lyrics`: kontrak dan logika lirik yang sudah ada.
- `features`: Home, search, detail, settings, import, modules, integrations.
- `platform`: bridge native dan capabilities.

Pisahkan service berdasarkan katalog, akun/provider, media/download, transfer, dan penyimpanan. Jalur dev Vite tetap memakai handler service yang sama dengan IPK.

### Aturan dependency

- Pertahankan Preact dan toolchain saat ini.
- Gunakan Iconify lokal yang sudah tersedia.
- Tambahkan dependency hanya untuk kebutuhan nyata, seperti QR dan playback MSE/EME.
- Untuk adaptive/protected playback, gunakan **Shaka Player tanpa UI bawaannya**, dimuat hanya saat diperlukan.
- Pertahankan adapter media sederhana untuk sumber langsung yang sudah berfungsi.
- Pin dependency baru dalam lockfile.
- Semua kode service harus tetap kompatibel dengan Node.js 16.
- Tidak menambahkan library audio yang hanya terbukti bekerja di browser desktop.

---

## 4. Kontrak data, state, dan persistensi

### Identitas entitas

Ganti asumsi bahwa semua item adalah video YouTube dengan model entitas ber-provider.

```ts
type ProviderId = 'youtube' | 'applemusic' | 'monochrome' | 'local';

interface EntityRef {
  provider: ProviderId;
  kind: 'track' | 'album' | 'artist' | 'playlist';
  id: string;
}

interface QueueEntry {
  entryId: string;
  trackKey: string;
  origin: 'manual' | 'album' | 'playlist' | 'radio' | 'autoplay';
}
```

Ketentuan:

- Key entitas dibentuk dari provider, jenis, dan ID.
- Queue dan playlist mempunyai ID entri sendiri.
- Lagu yang sama boleh muncul beberapa kali dalam antrean atau playlist.
- Identitas media lokal menggunakan asset ID milik TV, bukan path Android.
- Hubungan rekaman lintas provider disimpan sebagai mapping tambahan.
- Jangan menggabungkan cover, live, acoustic, remix, dan rekaman asli hanya karena judulnya mirip.
- Stream URL sementara, media token, dan credential bukan identitas lagu.

### Kontrak utama

Tetapkan interface berikut sebelum membangun layar-layar baru:

- `CatalogGateway`: `home`, `search`, `suggest`, `browse`, `next`, `related`.
- `LibraryRepository`: entitas, membership, likes, pins, playlist, history, profile.
- `PlaybackEngine`: load/play/pause/seek, snapshot, queue, repeat/shuffle, source.
- `ProviderDriver`: status akun, kemampuan, resolve, verify, sign-out.
- `TransferManager`: pairing, preview, import/export, progress, cancel.
- `CapabilityRegistry`: dukungan fitur dan lingkungan tempat dukungan itu dibuktikan.

Semua operasi async menerima cancellation atau generation ID untuk menolak hasil yang sudah kedaluwarsa.

### Penyimpanan

- IndexedDB menjadi penyimpanan metadata, Library, playlist, history, lyrics edit, preferensi, dan session.
- Jangan menyimpan koleksi besar sebagai satu nilai `localStorage`.
- Migrasikan preferensi tampilan/lirik dari key yang sudah ada secara idempoten.
- Simpan credential provider dan file media melalui service native pada storage milik aplikasi.
- Gunakan filesystem async dan direktori service di bawah `/media/internal` sesuai panduan LG.
- Jangan menyimpan data persisten di direktori hasil build atau direktori paket aplikasi.
- Jika penyimpanan gagal atau quota habis, rollback transaksi dan tampilkan kegagalan sebenarnya; jangan beralih diam-diam ke penyimpanan sementara.

### Konsistensi metadata dan file

- File media mempunyai state `staging`, `ready`, `failed`, atau `missing`.
- Unduhan disimpan sebagai file sementara, diverifikasi, lalu diubah menjadi `ready`.
- Rekonsiliasi saat startup menangani metadata tanpa file, file sementara, dan pekerjaan yang terputus.
- Metadata Library tetap ada ketika file unduhan dihapus.
- Pemulihan backup tanpa file media menandai asset sebagai perlu ditransfer ulang.

### Restore dan merge

- Import default adalah **merge**.
- Pertahankan urutan serta duplikasi entri playlist.
- Import backup yang sama berulang kali tidak menggandakan history atau entitas.
- Gunakan source/export ID dan entry ID untuk identitas impor.
- Pengaturan TV yang sudah ada tidak ditimpa oleh import koleksi biasa.
- Mode replace/restore penuh harus menampilkan ringkasan perubahan dan meminta konfirmasi di UI.
- Queue yang dipulihkan selalu dalam keadaan paused; tidak autoplay setelah import atau relaunch.

---

## 5. Navigasi dan UI produk

### Navigasi utama

Gunakan navigasi atas dengan urutan:

1. Beranda.
2. Cari.
3. Koleksi.
4. Sedang Diputar.
5. Antrean.
6. Pengaturan.

Logo berada di sisi kiri navigasi. Gunakan resource bahasa yang konsisten; default mengikuti bahasa TV saat ini, dengan English dan Bahasa Indonesia sebagai pilihan awal.

### Route yang wajib tersedia

- Home dan detail setiap section.
- Search browse, search aktif, hasil dan filter.
- Genre/mood.
- Album detail.
- Artist detail, songs, albums, similar, dan section items.
- Playlist online dan lokal.
- Library root, songs, playlists, albums, artists, recently added, liked.
- Kategori Local, Cached/Downloaded, Imported, dan sumber impor.
- History dan stats/recap.
- Player, queue, settings dan subhalamannya.
- Import progress, akun/module setup, serta diagnostics.

Route detail memakai ID entitas, bukan metadata judul sebagai identifier.

### Remote dan mini-player

- D-pad, Enter/OK, Back, pointer Magic Remote, dan keyboard lokal harus dapat dipakai.
- Back menutup submenu paling atas terlebih dahulu.
- Setelah overlay ditutup, fokus kembali ke tombol pembukanya.
- Setelah kembali dari detail, posisi scroll dan item fokus sebelumnya dipulihkan.
- Pilihan hidden/disabled tidak masuk navigasi focus.
- Mini-player tampil di luar halaman player ketika ada queue aktif.
- Mini-player menyediakan metadata, play/pause, next, dan akses player.
- Navigasi halaman tidak memulai ulang playback.

### Identitas visual

- Pertahankan logo, Inter, warna dan pola komponen Musicfy.
- Gunakan konten dan artwork nyata.
- Tidak menambah hero promosi, help footer permanen, teks developer, atau instruksi teknis pada alur normal.
- Status loading/error/empty hanya muncul saat relevan.
- Layout preset player diadaptasi ke komposisi TV yang sudah diterima, bukan mengganti seluruh layar dengan desain HP portrait.

---

## 6. API, autentikasi, dan kemampuan platform

### API katalog

Pertahankan API lama selama migrasi. Tambahkan operasi terkontrol untuk:

- Home dan continuation.
- Search lintas jenis.
- Suggestions.
- Browse album/artis/playlist/genre.
- Next/radio dan related.
- Import sumber publik yang didukung.

Gunakan endpoint beroperasi spesifik, misalnya `POST /api/catalog/{operation}`. Validasi operasi dan parameter. Jangan membuat endpoint yang menerima URL upstream sembarang.

Response katalog membawa item ter-normalisasi dan continuation opaque. Data optional tidak menggagalkan seluruh halaman.

### API service tambahan

Tambahkan kontrak untuk:

- Status, verifikasi, dan sign-out akun/module.
- Resolusi sumber playback.
- Manifest, segment, dan license melalui token opaque.
- Asset lokal dan download jobs.
- Pairing serta transfer jobs sementara.
- Diagnostics/capabilities.

Credential provider tidak dikembalikan ke renderer melalui endpoint status.

Pertahankan perlindungan relay yang sudah ada: session token, Origin, host/path allowlist, validasi redirect, expiry, byte range, batas body, timeout, dan cancellation.

### Apple Music

Pisahkan tiga kemampuan:

1. Sumber lirik BetterLyrics berlabel Apple Music.
2. Impor Library akun Apple Music.
3. Pemutaran audio melalui modul Apple Music.

Urutan implementasi:

- Port model akun, region, quality, provider order, matching, dan diagnostics dari Android.
- Gunakan companion Android untuk autentikasi jika kemampuan WebView Android diperlukan.
- Jangan mencoba membaca storage akun APK melalui ADB atau memindahkan database akun secara paksa.
- Transfer sesi hanya melalui mekanisme pairing eksplisit.
- Verifikasi akun TV sendiri.
- Jalankan resolusi, permintaan lisensi, dan decoding menggunakan CDM runtime TV.
- Jangan menganggap token valid atau license response sukses berarti audio sudah dapat diputar.

Jalur utama mengikuti modul Android yang ada. MusicKit Web bukan pengganti otomatis karena membutuhkan developer token dan alur otorisasi sendiri. Jangan menambahkan akun developer, layanan penerbit token, atau biaya baru tanpa keputusan pengguna.

Dukung pilihan modul Android yang benar-benar tersedia: AAC 256, HE-AAC 64, dan Region. Jangan melabeli sumber ini lossless/Atmos/offline bila jalur tersebut tidak mendukungnya.

### Pairing dan transfer HP

Transport ini juga membawa CSV, backup, dan file lokal; tidak hanya credential login.

- Relay playback normal tetap loopback.
- Service transfer LAN terpisah hanya hidup setelah pengguna membuka “Hubungkan HP”.
- Sesi berlaku lima menit dan dapat dibatalkan dari kedua perangkat.
- TV menampilkan QR berisi alamat sesi lokal, ID sesi, material pairing acak, dan public key ephemeral.
- Companion Android memindai QR, menampilkan identitas TV dan kategori data yang akan dikirim, lalu meminta konfirmasi pengguna.
- Gunakan ECDH P-256, HKDF-SHA256, dan AES-GCM untuk payload terautentikasi; crypto melalui API platform, tanpa algoritme buatan sendiri.
- Kredensial, shared secret, dan isi backup tidak masuk log atau URL request.
- Validasi sequence/nonce untuk menolak replay.
- Tutup listener, batalkan job, dan hapus material sesi pada cancel, expiry, suspend, atau close.
- Server transfer tidak boleh menjadi proxy ke API/media normal.
- Batas awal: CSV 10 MiB, portable metadata 64 MiB; media ditransfer streaming dan dibatasi quota.
- Dev/local tests memakai transport loopback dan data sintetis.
- Tidak menjalankan listener LAN pada perangkat pengguna secara otomatis dari agent.

### Capability gate

Setiap kemampuan mempunyai:

- `supported`, `unsupported`, atau `unverified`.
- Lingkungan bukti: local browser, simulator, atau native webOS.
- Alasan dan hasil pengujian terakhir.

Kemampuan berikut memerlukan gate khusus:

- Apple Music authorization dan DRM.
- Playback codec/format tertentu.
- EQ, reverb, spatial, normalization, visualizer berbasis audio.
- Crossfade/CrossMix dan playback bersamaan.
- Skip silence.
- Canvas/video bersamaan dengan audio.
- Output perangkat/system volume.
- Background playback setelah app ditutup.
- Persistensi offline license.

Dokumentasi LG menyatakan `createMediaElementSource()` tidak didukung dan membatasi penggunaan elemen audio. Karena itu, jangan memakai keberhasilan Web Audio pada Chrome sebagai bukti DSP webOS.

Referensi:

- [LG streaming protocol dan DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG Web Audio dan multi-sound](https://webostv.developer.lge.com/develop/guides/multi-sound-playback)
- [Keterbatasan Simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
- [Penyimpanan JS service](https://webostv.developer.lge.com/develop/guides/js-service-usage)
- [MusicKit Web](https://js-cdn.music.apple.com/musickit/v3/docs?path=%2Fdocs%2Fuser-authorization--page)
- [Shaka DRM configuration](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/drm-config.md)

---

## 7. Tahapan implementasi

Setiap tahap harus menghasilkan perubahan yang dapat diuji sendiri. Tulis regression test untuk perilaku state/data, jalankan sebelum dan sesudah implementasi, kemudian lakukan pemeriksaan visual atau runtime yang sesuai.

### T0 — Baseline, inventarisasi, dan matriks parity

- [x] Simpan plan ini dan baca kedua audit.
- [x] Catat Git status, versi, dependency, serta file untracked yang harus dipertahankan.
- [x] Buat matriks `Android owner → TV owner → status → test → limitation`.
- [x] Inventarisasi seluruh route serta menu dari source, termasuk kondisi feature flag dan data kosong.
- [x] Jalankan baseline test/typecheck/build.
- [x] Tandai rencana lama sebagai historis; jangan membawa pembatasan “search/player saja” ke scope baru.

**Bukti T0:** baseline 110 tes/18 file, typecheck, build lulus (salinan scratch; `node_modules` pengguna berisi binary macOS). Matriks: `2026-10-24-parity-matrix.md`.

**Lulus:** seluruh keluarga fitur dalam bagian 8 mempunyai owner dan tahap implementasi; baseline tetap bekerja.

### T1 — Domain, repository, dan migrasi

- [x] Implementasikan identitas provider-qualified, entri queue/playlist, dan kontrak repository.
- [x] Buat IndexedDB schema versioned beserta migrasi preferensi lama.
- [x] Tambahkan transaksi untuk likes, playlist, history, lyrics edit, dan restore.
- [x] Tambahkan media-asset registry dan rekonsiliasi dengan service.
- [x] Uji migrasi berulang, transaksi gagal, quota, duplicate entries, dan file hilang.

**Bukti T1:** `webos-tv/src/domain/entity.ts`, `src/library/{db,repository,migrations,preferences,types}.ts`; `repository.test.ts` menjalankan kontrak yang sama pada MemoryDb dan fake-indexeddb (35 tes: rollback transaksi, quota, abort, DB tertutup, migrasi berulang tanpa menimpa nilai baru/menghapus key lama, duplikat entri, rekonsiliasi aset hilang/orphan).

**Lulus:** data pulih setelah reload, duplikasi queue sah tetap ada, dan migrasi tidak menghapus preferensi lama.

### T2 — App shell, router, focus, mini-player

- [x] Pisahkan shell dari halaman dan logika playback.
- [x] Tambahkan seluruh tab utama dan route detail.
- [x] Implementasikan overlay stack serta pemulihan fokus/scroll.
- [x] Tambahkan mini-player global.
- [x] Uji D-pad, Back bertingkat, select/input, pointer, dan perpindahan halaman saat playback.

**Bukti T2:** `src/app/{store,Shell,MiniPlayer,OverlayHost,ChunkedList,engine,remote,services,i18n}.ts(x)` dan `src/pages/*`; `App.tsx` kini hanya re-export. `remote.test.ts` (10 tes: D-pad, tombol disabled, slider/teks/select, panel scrollable, Back overlay-dulu, perangkap fokus overlay, tombol media, ingatan fokus) dan `Shell.test.tsx` (12 tes jsdom: enam tab urutan Android dengan logo di kiri, Back di root Beranda diserahkan ke sistem, audio dimuat sekali walau berpindah halaman, lagu yang sama diputar ulang lewat play token, mini-player pause/next/buka pemutar, fokus kembali ke pembuka overlay, antrean hapus/pindah tanpa memuat ulang audio, `inert` di balik overlay). Memuat ulang lagu hanya saat `playToken` berubah. Penyimpanan gagal → layar kesalahan dengan Coba lagi, tanpa fallback memori.

**Batas:** halaman Beranda, Koleksi, Pengaturan, dan route detail masih berupa halaman jujur "belum tersedia" (tanpa tombol palsu) sampai tahap masing-masing (T4–T7, T17); Search masih jalur 0.3.0 sampai T5. Tampilan visual TV belum diambil (menunggu halaman nyata, T4).

**Lulus:** seluruh route dapat dioperasikan dengan remote tanpa focus trap atau restart audio.

### T3 — Katalog dan transport service

- [x] Port normalisasi InnerTube berdasarkan Android, bukan scraping UI baru.
- [x] Implementasikan gateway Home/search/suggest/browse/next/related dan pagination.
- [x] Pertahankan kompatibilitas pencarian/player lama selama transisi.
- [x] Tambahkan fixture dan Postman simulation untuk transport sebenarnya.
- [x] Uji response parsial, continuation, timeout, 429, invalid body, redirect, serta hasil lama.

**Bukti T3:** `service/innertube.cjs` (port normalisasi Android), `service/catalog.cjs`, rute `POST /api/catalog/{operation}` di `service/runtime.cjs` (dipakai IPK dan adapter Vite), `src/catalog/{types,gateway}.ts` (+ `createLatestGuard` untuk hasil usang), `server/catalog.test.ts` (51 tes: parser home/search/album/playlist/artis/genre/next, continuation, validasi, 429/403/500/body rusak/timeout/jaringan/redirect, automix, rute runtime), `src/catalog/gateway.test.ts` (13 tes), mock `postman/mocks/youtube-music-catalog` + simulasi, kontrak di `server/API.md`. Rute lama `/api/youtube/*` tidak berubah (tes runtime lama tetap lulus).

**Batas yang jujur:** fixture dibangun dari bentuk renderer yang di-parse Android; ini membuktikan parsing dan transport, **bukan** respons YouTube Music langsung. Sandbox ini tidak punya jalur jaringan ke music.youtube.com (percobaan langsung gagal `network`), jadi verifikasi data nyata berstatus **unverified** sampai dijalankan lewat `npm run dev` di komputer Anda.

**Lulus:** data katalog nyata dapat dimuat dan kegagalan upstream tidak berubah menjadi success kosong palsu.

### T4 — Onboarding dan Home nyata

- [x] Adaptasikan onboarding Android: welcome, impor opsional, profil, seed artis opsional, selesai.
- [x] Sediakan skip; pengguna tetap dapat langsung memakai mode tamu.
- [x] Implementasikan hero/Continue, Recently Played, Most Played, History, Jump Back In, dan rekomendasi.
- [x] Tambahkan section komunitas, artis, hits, live/video, kategori dan feed ketika ada datanya.
- [x] Port prioritas serta aturan pemilihan sumber data dari HomeViewModel/HomeRecommender.
- [x] Tambahkan detail section dan continuation.
- [x] Uji cold start tanpa history, offline cache, kosong, refresh, dan data akun yang belum diimpor.


**Bukti T4:** logika (`src/features/home/`): `model`, `genres`, `signals` (ambang skip Android: <300 ms diabaikan, lagu <40 d diabaikan, skip bila <30 d dan < setengah lagu; 200 skip terakhir disimpan), `profile` (taste profile: heard/avoid, seed lagu dan artis), `recommend` (because-you-like, more-like, new-from-artists, new genre, daily discover, community playlist, starter songs, `arrangeCategories`), `artistVideos` (shelf video/live artis, klasifikasi shelf feed, `cleanTitle`), `local` (recent, quick picks 30 hari, most played, history, forgotten favorites, keep listening/Jump Back In, playlist lokal), `compose` (urutan `homeSections` Android), `feed` (`HomeFeed`: fase lokal dulu, lalu sumber jaringan independen lewat gateway yang menghitung sukses/gagal, cache terakhir di store `meta`, kebijakan refresh <1 mnt tidak, >30 mnt semua, ≥2 skip/≥4 putar baris dengar, chips, `loadMore`, guard hasil usang). UI: `pages/HomePage`, `pages/SectionPage` (Lihat semua + continuation), `features/home/ui/{HomeCard,Onboarding,useHome}`, `features/onboarding/registry` (langkah impor otomatis dilewati selama belum ada opsi terdaftar; T13/T15 mendaftar). Bahasa awal kini mengikuti bahasa TV (`detectLanguage`: `webOSSystem.locale` lalu `navigator.language`; `id` → Indonesia, lainnya Inggris; pilihan di Pengaturan menang). `LibraryRepository.getMeta/setMeta` untuk cache.

**Tes T4:** 327 lulus / 34 file (naik dari 281/30), `tsc --noEmit` bersih, `vite build` bersih. Baru: `recommend.test.ts` (17), `signals.test.ts` (2), `feed.test.ts` (15: refreshAction, baris lokal, filter explicit/video, cold start tanpa history, offline penuh = failed + baris lokal tetap, cache terakhir ditampilkan saat gagal, sumber gagal tidak membatalkan yang lain, preferensi hide-explicit, discover/community/video artis, starter songs, chip + loadMore, kebijakan refresh, hasil usang tidak menimpa, tidak ada baris akun/data karangan), `HomePage.test.tsx` (10 jsdom: skip = mode tamu + kosong jujur + CTA ke Cari, onboarding penuh menyimpan nama dan artis berurutan, artis gagal dimuat tetap bisa selesai, baris lokal tanpa jaringan + Lanjutkan + kartu memutar antrean mulai dari indeks kartu, cache + catatan, kartu album membuka route detail, render progresif, chips, Lihat semua + halaman berikutnya, kartu video diputar sebagai lagu video), `i18n.test.ts` (deteksi bahasa TV, string Inggris).

**Bukti visual (lokal, katalog dimock, bukan TV):** `webos-tv/artifacts/t4-evidence/` (`1-onboarding-welcome.png`, `2-onboarding-artists.png`, `3-home-guest-online.png`, `4-home-guest-offline.png`; Chromium 1920×1080, bahasa id-ID).

**Batas yang jujur:** (1) Data YouTube Music langsung tetap **unverified** (sandbox tanpa jaringan ke music.youtube.com); pemilihan shelf Charts (`FEmusic_charts`) dan rilis baru (`FEmusic_new_releases_albums`) berdasarkan judul/isi shelf belum dibuktikan pada respons nyata. (2) Baris "Your genre" Android (lookup iTunes) tidak di-port karena host iTunes tidak terjangkau dari service TV; baris genre baru dari `FEmusic_moods_and_genres` tetap ada. (3) `ListeningSignals` belum dihubungkan ke player (T9), sehingga refresh karena skip/putar belum terpicu dari pemakaian nyata; kebijakan sudah teruji pada controller. (4) Halaman detail album/artis/playlist/genre masih halaman jujur "belum tersedia" sampai T6/T7; kartu sudah membuka route yang benar. (5) Tampilan hero/baris dengan riwayat nyata belum difoto (hanya tampilan tamu); diuji lewat jsdom. (6) Langkah impor onboarding dan "ulangi onboarding dari Pengaturan" menunggu T13/T15/T17.

**Lulus:** Beranda menjadi halaman awal dan tidak berisi data demo yang disamarkan sebagai rekomendasi.

### T5 — Search lengkap

- [x] Tambahkan browse mood/genre, search history, dan suggestions.
- [x] Dukung All, Music, Artist, Video, Album, serta Playlist sesuai response Android.
- [x] Pisahkan jenis hasil dan tindakan saat dipilih.
- [x] Pertahankan query, tab, pagination, dan fokus saat kembali dari detail.
- [x] Uji debounce/cancel, filter kosong, data campuran, serta query cepat berturut-turut.


**Bukti T5:** `src/features/search/{url,session}.ts` (`SearchSession`: draft + debounce 250 ms, request lama di-abort dan jawaban usang diabaikan, riwayat dari repository dengan hapus satu/semua dan maksimal tiga cocok saat mengetik, saran + item rekomendasi, tautan YouTube yang ditempel menampilkan lagu/artisnya (video dan artis seperti `YouTubeUrlParser` Android), hasil per filter di-cache dengan continuation, filter konten explicit/video-song, mood & genre dari `FEmusic_moods_and_genres`), `src/pages/SearchPage.tsx` (idle: riwayat + grid mood/genre; mengetik: riwayat, saran, rekomendasi; hasil: chip Semua/Musik/Artis/Video/Album/Playlist/Pilihan seperti Android, Hasil teratas, daftar per jenis, Muat lebih banyak), `SearchPage` mendorong route hasil sehingga Back kembali ke query yang diketik, dan mengedit query di dalam hasil kembali ke mode mengetik dengan draft utuh. Memilih lagu memutar langsung lalu radio lagu itu masuk antrean (`playSong`, perilaku Android `YouTubeQueue.radio`), dibatalkan bila pengguna sudah pindah. Artis/album/playlist membuka route detail (isi halaman: T6); tile genre membuka route genre (T6).

**Tes T5:** 15 tes baru di `search.test.ts` (parser tautan, debounce, abort + jawaban usang, filter konten, tautan, riwayat, submit/top result, cache per filter, loadMore tanpa duplikat, gagal + retry, hasil kosong, query baru vs buka ulang, jawaban lambat query lama, mood/genre) dan 12 tes jsdom `SearchPage.test.tsx` (riwayat + genre + hapus riwayat, genre gagal + retry, saran setelah debounce, hasil + chip + album membuka route dan Back mempertahankan query/filter/hasil/fokus tanpa fetch ulang, artis/playlist membuka detail dan tidak memutar, lagu diputar langsung + radio bergabung tanpa memuat ulang audio, radio dibuang bila pengguna sudah pindah, edit query dalam hasil, error + Coba lagi + hasil kosong, tautan lagu, pagination). Total 354 tes lulus / 36 file (+27 sejak T4), `tsc` dan `vite build` bersih.

**Bukti visual (lokal, katalog dimock):** `webos-tv/artifacts/t5-evidence/*.png` (idle riwayat + mood/genre, saran saat mengetik, hasil Semua, hasil Album).

**Batas yang jujur:** (1) respons pencarian nyata unverified (sama seperti T3). (2) Menu ⋮ per hasil (putar berikutnya, tambah ke antrean/playlist, dst.) menunggu T10/T7. (3) Pencarian pustaka lokal Android (`LocalSearchScreen`) masuk T7. (4) Aturan `SongVersions.preferSongs` belum di-port. (5) Mode offline Android (hasil dari pustaka saat offline) menunggu T7/T16.

**Lulus:** memilih artis/album/playlist membuka detailnya, bukan selalu langsung memainkan lagu.

### T6 — Album, artis, playlist, genre, dan section detail

- [x] Implementasikan album tracklist, metadata, Play all dan Shuffle.
- [x] Implementasikan artist overview, bio, top songs, albums, similar dan section items.
- [x] Implementasikan playlist online/lokal, continuation dan metadata sumber.
- [x] Tambahkan buka artis/album dari metadata player.
- [x] Uji metadata optional, track tanpa durasi, daftar besar, recording berbeda, dan Back.

**Lulus:** seluruh jenis entitas utama bisa dijelajahi melalui alur yang sama dengan Android.

**Bukti T6:** `src/pages/{AlbumPage,PlaylistPage,ArtistPage,GenrePage}.tsx` dan `src/features/detail/{ui.tsx,convert.ts,browse.ts,useSaved.ts}` + `src/app/useResource.ts`. Album: sampul, judul, artis yang bisa dibuka, tahun/subjudul/ringkasan jumlah-durasi bila ada, deskripsi (Selengkapnya), Putar / Acak / Simpan (ke Koleksi), daftar lagu bernomor (durasi kosong tampil "—:—", bukan angka karangan), lagu tanpa artis/album/sampul diisi dari header album, shelf terkait sebagai baris kartu (+ Lihat semua). Playlist online: sama, plus Muat lebih banyak (continuation) dan simpan dengan id tanpa prefiks `VL`. Playlist lokal (dari repository): Putar/Acak, sumber impor ("Diimpor dari …") dan catatan "N dari M lagu berhasil diimpor" bila `reportedTrackCount` lebih besar, entri tanpa data lagu dilewati dan dilaporkan. Artis: avatar bulat, pendengar bulanan/pelanggan, bio, Putar (lagu teratas; bila kosong → radio), Acak, Radio (`next` dengan `radioPlaylistId`/`radioVideoId`, gagal → pesan, antrean tidak berubah), Ikuti/Diikuti, Lagu teratas, shelf Album/Video/Artis serupa/dll., "Lihat semua" lagu → halaman daftar penuh (`browse` + continuation) dan "Lihat semua" shelf → halaman grid. Genre: shelf per genre/suasana dengan Lihat semua (halaman section) dan Muat lebih banyak. Semua halaman: loading, error + Coba lagi (kecuali not-found), cache sehingga Back tidak memuat ulang, dan fokus pindah ke kontrol pertama begitu konten yang terlambat tiba (tidak merebut fokus bila pengguna sudah pindah ke menu lain). Shuffle memakai mode shuffle antrean yang sama dengan tombol Acak di Antrean (`playTracks(..., {shuffle:true})`: mulai dari lagu acak, urutan asli dapat dipulihkan). Player: nama artis dan album lagu yang sedang diputar menjadi tautan fokus ke halaman artis/album (hanya bila semua artis punya id; selain itu teks biasa). Baris fokus Player digeser satu (tautan = baris 1, seek 2, kontrol 3, volume 4; lirik/tampilan +1) agar urutan D-pad mengikuti tata letak.

**Tes T6:** `src/pages/DetailPages.test.tsx` — 31 tes jsdom: album (header + daftar, putar dari indeks dengan album/artis/sampul terisi dari header, Putar/Acak, Simpan toggle + tersimpan di repository, tautan artis lalu Back tanpa fetch ulang, header kosong/tanpa lagu, gagal → Coba lagi, not-found tanpa retry, judul sama tetapi id berbeda tetap terpisah dan id ganda digabung, sembunyikan explicit, 600 lagu hanya memasang irisan pertama, shelf terkait), playlist (online, prefiks VL, continuation + gagal tetap menyimpan lagu lama, `skipped` dilaporkan, lokal dengan sumber impor parsial, lokal tidak ada, otomatis), artis (lagu teratas, Putar/Acak, Radio sukses + gagal, tanpa lagu → radio, tanpa apa pun → tombol nonaktif, Ikuti, Lihat semua lagu/shelf + muat lebih banyak + putar, gagal + retry), genre (shelf + Lihat semua + muat lebih banyak, kosong), tautan player (dengan/tanpa id), fokus pada konten terlambat (+ tidak merebut fokus). Total **385 tes lulus / 37 file** (+31 sejak T5), `tsc --noEmit` dan `vite build` bersih. Bukti visual (browser lokal, katalog dipalsukan di level jaringan; bukan TV): `webos-tv/artifacts/t6-evidence/{1-album,2-artist,3-artist-shelves,4-playlist,5-genre,6-artist-all-songs,7-player-links}.png`.

**Batas yang jujur:** (1) Respons YouTube Music langsung untuk album/artis/playlist **unverified** (sandbox tanpa jaringan ke music.youtube.com); bentuk mengikuti normalisasi `service/innertube.cjs`. (2) Tab artis `albums` dan `similar` tidak punya halaman sendiri: isinya muncul sebagai shelf di overview dan "Lihat semua" membuka halaman `items`; route lama `artist/{id}/albums|similar` jatuh ke overview. (3) Route generik `browse/{browseId}` Android (BrowseScreen) hanya tercakup lewat genre/section/daftar artis; tidak ada pintu masuk lain yang menghasilkan browse generik. (4) Playlist lokal masih hanya-baca (edit, urutkan, hapus = T7); playlist otomatis (`auto`) menampilkan pesan jujur sampai T7. (5) Detail lagu / About (`SongDetailsSheet`) = T10. (6) Menu ⋮ per baris lagu dan tambah ke playlist = T10/T7. (7) Aturan sembunyikan explicit/video diterapkan juga pada daftar lagu album/playlist online sesuai preferensi; playlist lokal pengguna tidak disaring. (8) Alur "Lihat semua" memakai route `section`/`artist items` dan hanya diverifikasi dengan katalog palsu, tidak dengan respons nyata. (9) Mode shuffle yang sudah aktif tetap mengikuti seed bawaan reducer saat antrean diganti (perilaku T8 akan ditinjau).

### T7 — Library, likes, pins, dan playlist lokal

- [x] Implementasikan Songs, Playlists, Albums, Artists, Recently Added, Liked.
- [x] Tambahkan All, Local, Cached/Downloaded, Imported dan sumber impor.
- [x] Implementasikan sort/filter/search, alfabet, pin/speed dial, add/remove Library.
- [x] Implementasikan create/rename/delete playlist, add/remove/reorder entry.
- [x] Adaptasikan Add to playlist: pencarian, recents, create, dan duplicate dialog.
- [x] Uji lagu ganda, playlist bernama sama, playlist kosong, repeated import, dan transaksi gagal.

**Lulus:** koleksi merupakan data persisten yang dapat dikelola; bukan hanya daftar hasil pencarian.

**Bukti T7:** `src/features/library/{index,sort,search,data,actions,overlays,useSort,ui}` dan `src/pages/LibraryPage.tsx`, `src/pages/PlaylistPage.tsx` (playlist lokal), `src/app/{longPress,ChunkedList}`, `LibraryRepository.subscribe()` (halaman daftar menyegarkan diri bila data berubah dari mana pun; perubahan yang gagal melempar sebelum notifikasi sehingga tidak tampak berhasil) dan `listPlaylistPreviews`. Koleksi: pencarian koleksi (lagu, artis, album, playlist; abaikan huruf besar/aksen), chip Semua/Lokal/Cache/Impor (pilihan tab diingat saat pindah halaman), Disematkan (grid 3×3, maksimal 9; pilih = buka/putar, tahan OK atau ⋮ = menu lepas sematan), kartu Lagu/Playlist/Album/Artis dengan jumlah dan kolase sampul nyata, "Baru ditambahkan", "Disukai", dan keadaan kosong yang jujur dengan satu tombol "Cari musik" (tanpa tombol impor palsu). Daftar Lagu: urut abjad dengan header huruf (Latin tanpa aksen, `#`, kana, hangul, pinyin bila `Intl.Collator` mendukung, Sirilik/Yunani/Arab/Ibrani/Thai), "Lompat ke huruf", cari, Putar semua/Acak. Sort seperti Android, disimpan di preferensi (`library.sort.*`) dengan arah naik/turun: Lagu & Disukai (tanggal, nama, artis, waktu putar), Playlist (tanggal, nama, jumlah lagu, terakhir diubah), Album (tanggal, nama, artis, tahun, jumlah lagu, durasi, waktu putar), Artis (tanggal, nama, jumlah lagu, waktu putar), isi playlist (urutan playlist, tanggal, nama, artis, waktu putar); pilihan yang gagal disimpan dibatalkan dan diberi tahu. Tab Impor mengelompokkan lagu dan playlist per sumber dan membuka daftar tersaring. Menu lagu (⋮ atau tahan OK): putar berikutnya, tambah ke antrean, tambah ke playlist, sukai/batal, simpan/hapus dari koleksi, sematkan/lepas, buka artis/album; setiap aksi memberi toast dan kegagalan penulisan ditampilkan sebagai gagal (bukan berhasil). Playlist: buat (dari halaman Playlist atau langsung dari "Tambah ke playlist", nama kosong ditolak, nama sama diperbolehkan dan tetap terpisah), ganti nama, hapus (dengan konfirmasi; lagu tetap di koleksi), hapus entri, pindah naik/turun/awal/akhir (hanya pada urutan playlist; urutan lain hanya untuk melihat), hapus entri tanpa data. "Tambah ke playlist": cari, terbaru (bila lebih dari 4), buat baru, dan dialog duplikat Lewati/Tambahkan tetap/Batal; kegagalan menahan dialog dan menampilkan alasan.

**Tes T7:** `src/pages/LibraryPage.test.tsx` (35 tes jsdom: landing kosong/berisi, tab Lokal/Cache/Impor dengan aset siap vs staging/gagal dan sumber impor, pencarian, daftar A–Z + lompat huruf + filter, Baru ditambahkan/Disukai, tahan OK vs tekan singkat, gagal menyukai/gagal menambah, buat/ganti nama/hapus playlist, playlist bernama sama, playlist kosong, tambah + duplikat (lewati/tetap/batal), buat dari picker, hapus/pindah entri dengan posisi tetap berurutan, sematan + batas 9 + lepas lewat tahan OK, album/artis, sort lagu/Disukai/playlist/album/isi playlist + penyimpanan + pembatalan saat gagal simpan), `src/features/library/{index,search,data,sort}.test.ts`. Impor ulang dan transaksi gagal pada level repository tetap ditutup `repository.test.ts` (`importKeys` idempoten, rollback saat penulisan ke-N gagal). Total **442 tes lulus / 42 file** (+57 sejak T6), `tsc --noEmit` dan `vite build` bersih. Bukti visual (browser lokal; data contoh dimasukkan lewat API repository asli oleh `tools/evidence/`, sampul palsu; bukan TV): `webos-tv/artifacts/t7-evidence/{1-library-empty,2-library-all,3-library-local-empty,4-songs-az,5-song-menu,6-jump-letter,7-add-to-playlist,8-playlists,9-create-playlist,10-playlist-entry-menu,11-playlist-detail,12-liked,13-sort-picker}.png`.

**Batas yang jujur:** (1) Sort "Import order" untuk Disukai (Android `LikedSongSortType.IMPORT_ORDER`) belum ada karena urutan impor baru disimpan oleh importer (T15); pilihan lain tersedia. (2) Tab Lokal/Cache hanya terisi bila ada aset siap: berkas dari ponsel (T13/T16) dan unduhan/cache (T16) belum ada, jadi tab diuji dengan catatan aset yang di-seed dan tampil jujur kosong di pemakaian nyata; tab Impor baru terisi setelah importer (T15). (3) Sort "Waktu putar" memakai riwayat yang direkam repository; `ListeningSignals`/recordPlay dari player baru dihubungkan di T9, sehingga pada pemakaian nyata nilainya nol sampai saat itu. (4) Urutan entri playlist diubah lewat menu (Naikkan/Turunkan/awal/akhir) menggantikan drag Android karena TV tanpa sentuhan. (5) "Lompat ke huruf" memakai menu pilihan, bukan bilah huruf samping. (6) Sort pada dialog Tambah ke playlist (`AddToPlaylistSortType`) belum dipindah; pencarian dan "terbaru" tersedia. (7) Playlist otomatis (`auto_playlist`: paling sering diputar, dst.) tetap menampilkan pesan jujur sampai T9. (8) Menu ⋮ per hasil pencarian = T10 (aksi lagu sudah siap dipakai ulang). (9) Sematan dibatasi 9 item (keputusan layout TV 3×3), mencakup lagu, album, artis, dan playlist lokal/online. (10) Tahan OK diuji dengan event keyboard di jsdom; perilaku remote fisik tidak diuji (TV tidak diakses). (11) Dengan nama yang sama, playlist dibedakan lewat id, bukan nama; belum ada indikator tambahan selain jumlah lagu.

### T8 — Playback, queue, dan sesi

- [ ] Generalisasikan engine tanpa merusak `HtmlAudioPlayer` yang sudah berfungsi.
- [ ] Implementasikan Repeat off/all/one, Shuffle dan pemulihan urutan aslinya.
- [ ] Implementasikan Play next, Add to queue, remove, reorder, clear dan duplicate entries.
- [ ] Implementasikan bagian history/now playing/continue/autoplay sesuai model Android.
- [ ] Tambahkan radio/related serta autoplay dengan deduplikasi rekomendasi yang sesuai.
- [ ] Simpan session/queue/posisi secara berkala dan pada pause/visibility change.
- [ ] Uji stale resolve, expired URL, track error, ended ganda, remove current, reorder current, dan restore.

**Lulus:** mengganti urutan atau memilih lagu yang sama tidak menyebabkan loading terkunci atau salah lagu.

### T9 — Listening clock, history, stats, recap

- [ ] Hitung waktu dengar dari elapsed time ketika benar-benar `playing`.
- [ ] Jangan menghitung seek, buffering, pause, atau waktu aplikasi tidak berjalan.
- [ ] Terapkan threshold history Android, default 30 detik, dan Pause listening history.
- [ ] Gunakan ID sesi untuk mencegah event ganda setelah crash/restore.
- [ ] Hubungkan event ke Recently Played, Most Played, Home recommendation dan stats.
- [ ] Implementasikan history detail, total listening time, periode stats dan recap.
- [ ] Uji sesi pendek, seek ke akhir, pause/resume, crash checkpoint, dan history dinonaktifkan.

**Lulus:** statistik tidak bertambah hanya karena pengguna menggeser seekbar.

### T10 — Seluruh menu player dan submenu

- [ ] Port semua 14 aksi: Like, Other menu, Sleep timer, See video, Repeat, Shuffle, Lyrics, Queue, Speed, Output, Keep awake, Translate, Download, Add to playlist.
- [ ] Port empat slot menu dan tombol samping beserta swap/persistensi.
- [ ] Isi Other menu dengan tindakan yang benar-benar terhubung.
- [ ] Implementasikan sleep timer durasi/akhir lagu/cancel.
- [ ] Implementasikan speed/pitch/reset sesuai dukungan engine.
- [ ] Implementasikan Song details → artist/album/About song.
- [ ] Tambahkan konteks menu lirik: editor, provider dan translation.
- [ ] Terapkan capability gate untuk output/system volume, keep-awake, video, dan pitch.
- [ ] Jangan menganggap Share atau daftar output Android yang handler-nya kosong sebagai fungsi yang sudah selesai.

**Lulus:** setiap item mempunyai handler, state, Back dan pengujian; item unsupported mempunyai alasan yang benar.

### T11 — Player Studio dan adaptasi preset

- [ ] Implementasikan lima preset: Flagship, Turntable, Poster, Timeline, Lyrics stage.
- [ ] Pertahankan area kiri-player/kanan-lirik di semua preset TV.
- [ ] Pertahankan delapan ID cover, lima gaya tombol, empat seekbar.
- [ ] Tambahkan timestamp total/sisa, bottom bar, menu slots dan disc label.
- [ ] Port canvas/video/timestamp-matching serta visualizer hanya jika capability mendukung.
- [ ] Adaptasikan editor posisi/ukuran ke kontrol remote dengan preview dan reset.
- [ ] Terapkan reduced motion, pause/visibility, dan pengaturan visual tersimpan.
- [ ] Uji kombinasi preset/cover, label panjang, judul panjang, dan viewport 720p/1080p.

**Lulus:** pilihan cover tidak keliru dianggap sudah mencakup seluruh preset player.

### T12 — Lirik lengkap dan performa

- [ ] Pertahankan 12 provider serta parser word/syllable yang sudah berfungsi.
- [ ] Pertahankan auto selection dan pilihan manual yang tidak ditimpa response lambat.
- [ ] Simpan pilihan provider per lagu, dengan preferensi default global terpisah.
- [ ] Port status sumber, duet/background voice, readings dan translation.
- [ ] Implementasikan editor draft/Save/UserEdited serta perlindungan terhadap overwrite otomatis.
- [ ] Catat bahwa editor per baris menghasilkan LRC; jangan mengaku mempertahankan timing kata jika edit menghilangkannya.
- [ ] Port motion rise/swell/cascade secara terukur; gunakan transform/opacity dan hindari layout measurement per frame.
- [ ] Translation menyediakan bahasa asal/tujuan, whole session, stop, show original, cache dan error.
- [ ] Pertahankan lirik terintegrasi di kanan; alat editing/translation muncul sebagai overlay.

**Lulus:** highlight mengikuti clock audio sebenarnya, berhenti saat pause, sinkron setelah seek, dan tidak merender ulang seluruh halaman setiap frame.

### T13 — Pairing, portable backup, dan transfer

- [ ] Implementasikan protokol pairing/transfer bagian 6.
- [ ] Tambahkan pendamping Android dalam aplikasi yang sama, tanpa mengubah alur player HP.
- [ ] Implementasikan ekspor/impor `.musicfy.json` version 1.
- [ ] Isi portable backup: metadata, membership, likes, pins, playlist entries, history, profile, preferensi, edited lyrics, pilihan sumber dan optional paused queue.
- [ ] Exclude credential, cookies, API keys, signed URLs dan file media.
- [ ] Dukung CSV Android/TuneMyMusic dengan header yang sudah ada: Type, Playlist name, Track name, Artist name, Album, Duration (ms), Video ID, Thumbnail.
- [ ] CSV mempertahankan kemampuan aktualnya: likes dan playlist; jangan mengklaim CSV membawa seluruh history/settings.
- [ ] Android ZIP berisi Room/DataStore tidak direstore langsung ke TV. Gunakan ekspor portable dari Android.
- [ ] Tambahkan preview, merge/replace, progress, cancel, retry, dan validasi versi.
- [ ] Uji salah pasangan, replay, expiry, cancel, transfer terputus dan repeated restore.

**Lulus:** koleksi dapat dipindah tanpa komputer dan tanpa mengekspos relay playback normal ke LAN.

### T14 — Modules dan sumber audio

- [ ] Port kontrak module/provider dan urutannya.
- [ ] Default: YouTube aktif; Apple Music dan Monochrome tidak aktif sampai siap.
- [ ] Pertahankan urutan preferensi Android: Monochrome, Apple Music, YouTube.
- [ ] Implementasikan Monochrome sesuai adapter Android serta kemampuan codec aktual.
- [ ] Implementasikan Apple account setup, verify, quality, region, sign-out dan diagnostics.
- [ ] Tambahkan adapter MSE/EME untuk protected/adaptive playback.
- [ ] Bedakan kegagalan auth, matching, stream, license dan decode.
- [ ] Jika YouTube dimatikan, jangan diam-diam memakainya sebagai fallback.
- [ ] Jangan memindahkan offline license atau material dekripsi CDM dari HP.
- [ ] Tandai native Apple playback `unverified` sampai ada bukti perangkat yang diizinkan.

**Lulus lokal:** contract/parser/matching/license-adapter test lulus; tidak membuat klaim playback TV dari hasil mock.

### T15 — Import sumber, account import, dan resync

- [ ] Port public-link import: Spotify, Apple Music, Deezer, YouTube playlist/album.
- [ ] Pertahankan batas sumber Android, termasuk Spotify public import first 100 jika adapter sumber memang demikian.
- [ ] Port account import Spotify/Apple Music/YouTube Music/Tidal melalui driver yang tersedia.
- [ ] Gunakan companion setup bila browser auth TV tidak mendukung.
- [ ] Implementasikan pemilihan likes/playlist, progress, unresolved tracks, cancel/resume dan history impor.
- [ ] Tambahkan refresh/resync salinan playlist sumber secara eksplisit.
- [ ] Default import read-only; write-back ke provider harus opt-in dan sesuai aksi pengguna.
- [ ] Sinkronisasi provider tidak menjadi layanan sinkronisasi otomatis HP–TV.
- [ ] Jangan menambahkan konektor akun baru untuk Amazon/Pandora/SoundCloud bila Android menggunakan TuneMyMusic CSV.

**Lulus:** sumber, jumlah yang berhasil/gagal, batas provider dan recording match terlihat benar.

### T16 — Dicoret: download, cache, offline, dan media lokal

Keputusan pengguna (2026-10-24): fitur ini **tidak diadaptasi** ke versi TV.

- Penyimpanan aplikasi webOS kecil dan tidak bisa diandalkan; kuota 256 MiB Android pun tidak cocok.
- Mengunduh berarti menyimpan salinan stream YouTube dan Apple Music (DRM); tidak dibangun.
- File lokal lebih cocok diputar lewat pemutar bawaan TV dari USB.
- TV selalu online, jadi streaming sudah cukup. Tab Lokal/Cache di Library tetap kosong dan menjelaskan alasannya; tombol DOWNLOAD tidak ditawarkan.

**Lulus:** tidak ada jalur unduh/offline di UI, dan matriks mencatat alasannya.

### T17 — Settings, profil, dan integrasi (Audio Lab dan Discord dicoret)

- [x] Port General, Playback, Modules, Import, Integrations (Appearance = Player Studio, T11). Pencarian setting **tidak** dibawa: halaman pendek, semua baris terlihat.
- [x] Nama profil, onboarding ulang, bahasa, hapus riwayat/pencarian, dan diagnostics punya tindakan nyata. Avatar, backup ekspor dan cache dicoret/tidak ada.
- [ ] Port preferensi Android yang relevan, termasuk save-last-state, failure policy, offline mode, content filters dan pause history.
- [ ] Audio Lab (Equalizer/AutoEQ, FX, reverb, spatial, loudness, pilih perangkat output) **dicoret**: output TV tetap dan EQ lewat Web Audio di TV tidak terbukti. Yang tetap: urutan sumber audio, normalization/speed bila backend terbukti, crossfade/skip silence hanya sebagai capability gate (unsupported/unverified bila tidak terbukti, tanpa indikator efek palsu).
- [x] Port Last.fm/Libre.fm: auth (QR), now playing, scrobble, likes opt-in, queue retry (di service). Kunci API belum dipasang di paket.
- [ ] Scrobble default: lagu lebih dari 30 detik; hitung setelah setengah durasi atau 240 detik, yang lebih dulu; hanya elapsed playing.
- Discord Rich Presence **dicoret**: tidak ada Discord di TV.
- [x] Secret di service (file 0600), tidak masuk backup, tidak dikirim ke layar; keluar/jeda tersedia.

**Lulus:** setiap pengaturan mengubah perilaku nyata atau menyatakan keterbatasannya dengan benar.

### T18 — Lifecycle, performa, regresi, dan paket final

- [x] Tetapkan perilaku close/suspend sesuai bagian 9 (pause + simpan + hentikan impor; tidak resume sendiri).
- [~] Audit visual di browser (1280x720, 1920x1080) untuk route utama dan dialog baru; bukan audit di TV.
- [x] Test/typecheck/build lulus; service dijalankan di Node 16.20.2 desktop (skrip pemeriksaan + runtime-smoke langsung). Suite vitest hanya di Node 22; Node milik TV belum.
- [x] Kandidat 0.4.0 dibangun; versi disinkronkan.
- [x] Paket diperiksa: app + service, asset relatif, `ares-package --check` bersih.
- [x] Review: satu bug ditemukan dan diperbaiki (sumber playlist impor menampilkan nama playlist, bukan layanan).
- [x] Matriks dan `webos-tv/VALIDATION.md` diperbarui.
- [x] IPK diserahkan sebagai file; tidak dipasang. APK companion tidak dibangun di sini (hanya kompilasi foss).

**Lulus:** hasil lokal dan status kemampuan platform terpisah jelas; tidak ada klaim hardware baru tanpa pengujian yang diizinkan.

---

## 8. Matriks cakupan yang wajib dipertahankan

Tidak boleh menghapus baris scope karena implementasinya sulit.

| Keluarga fitur | Tahap |
|---|---|
| Onboarding/profile/build-home | T4, T17 |
| Home, rekomendasi, section expansion | T4, T9 |
| Mood/genre/search/suggestions/history/filter | T3, T5 |
| Artist songs/albums/similar/items | T6 |
| Album dan playlist online | T6 |
| Library seluruh kategori | T7 |
| Likes/pins/speed dial | T7 |
| Playlist create/duplicates/reorder | T7, T10 |
| Mini-player dan navigasi | T2 |
| Queue/repeat/shuffle/radio/autoplay | T8 |
| Session restore/lifecycle | T8, T18 |
| History/stats/recap | T9 |
| Seluruh 14 menu cepat | T10 |
| Other menu dan submenu lirik | T10, T12 |
| Song details/artist/album/About | T6, T10 |
| Lima preset, delapan cover, controls/seekbar | T11 |
| Canvas/video/visualizer | T11, capability gate |
| Dua belas provider lirik/rich timing | T12 |
| UserEdited/readings/translation | T12 |
| Portable backup/CSV/media transfer | T13 |
| Apple login/import/audio sebagai jalur terpisah | T13–T15 |
| Monochrome/provider order/quality | T14 |
| Public-link dan account import | T15 |
| Local/cache/download/offline | T16 (dicoret) |
| General/Appearance/Playback/settings search | T17 |
| EQ/AutoEQ/FX/spatial/normalization | Dicoret (kecuali normalization bila terbukti) |
| Crossfade/CrossMix/skip silence | T17, capability gate |
| Last.fm/Libre.fm | T17 (Discord dicoret) |
| Diagnostics/cipher/experimental yang relevan | T3, T17 |
| Packaging dan dokumentasi bukti | T18 |

Fitur khusus Android seperti haptics, Android foreground-service notification, APK module discovery, dan orientasi portrait tidak dipindahkan secara literal. Catat padanan atau alasan platform pada matriks. Jangan menambahkan root, native extension tidak resmi, atau kebutuhan komputer sebagai jalan pintas.

---

## 9. Lifecycle yang ditetapkan

### Navigasi dalam aplikasi

Playback terus berjalan saat berpindah Home, Search, Library atau Settings. Mini-player tetap tersedia.

### Pause/suspend/close

- Simpan queue, posisi, preferensi, dan checkpoint waktu dengar.
- Pause audio/video dan hentikan animasi.
- Tutup pairing session.
- Checkpoint unduhan, lalu hentikan transfer dengan aman.
- Batalkan request UI yang tidak lagi relevan.
- Service berhenti ketika subscription terakhir berakhir, sesuai fondasi saat ini.

### Relaunch

- Pulihkan data dan posisi.
- Playback serta unduhan kembali dalam keadaan paused.
- Jangan autoplay atau meneruskan pekerjaan jaringan tanpa aksi pengguna.
- Sleep timer yang waktunya sudah lewat tidak memulai playback.
- Deadline timer yang masih berlaku dipertahankan; waktu suspend tidak dihitung sebagai waktu mendengarkan.

### Background playback

“Keep playing even when closed” tidak diaktifkan hanya dengan menyimpan preferensi. Tetap unsupported/unverified sampai lifecycle background resmi webOS dan pengujian perangkat membuktikannya.

---

## 10. Pengujian dan acceptance

### Unit dan contract tests

Wajib mencakup:

- Identitas provider dan recording mismatch.
- Duplikasi queue/playlist.
- Migrasi data lama dan restore berulang.
- Quota/transaksi gagal dan metadata–file reconciliation.
- Continuation, response parsial, 429 dan timeout.
- Request lama setelah perubahan track/query/source.
- Repeat/shuffle/ended/remove/reorder current.
- History threshold dan scrobble tanpa inflasi seek.
- Parser TTML bare seconds, LRC, words, syllables dan whitespace.
- Manual lyrics source tidak ditimpa auto.
- UserEdited serta translation cancellation.
- Pairing replay/expiry/cancel dan transfer terputus.
- Provider disabled serta fallback yang dilarang.
- Auth sukses tetapi license/decode gagal.
- Credential tidak masuk log/backup/renderer status.
- Range/HEAD, token expiry, host/path/redirect restrictions.
- Suspend/close/relaunch.

### API simulation

Gunakan kontrak Postman lokal yang sudah ada dan perluas untuk:

- Katalog sukses/kosong/parsial.
- Timeout, 429, 401/403 dan server failure.
- Resolve media kedaluwarsa.
- Auth expired.
- License gagal.
- Import sebagian berhasil.
- Transfer terputus.

Simulation menjalankan handler sebenarnya dengan upstream stand-in; bedakan hasil mock dari provider live.

### UI lokal

Uji minimal:

- 1280×720 dan 1920×1080.
- Seluruh tab serta route detail.
- Semua menu dan submenu.
- D-pad tanpa mouse.
- Magic Remote/pointer melalui padanan lokal.
- Judul/artis panjang.
- Lirik panjang, plain, missing, duet, translation.
- Koleksi dan playlist besar.
- Artwork rusak/fallback.
- Empty/loading/error/offline.
- Back dan focus restoration.
- Tidak ada overflow, clipping kontrol, atau menu di luar viewport.

Simpan screenshot serta catatan interaksi. Jangan hanya mengandalkan build untuk menyatakan UI benar.

### Perintah verifikasi

Dari direktori `webos-tv`:

```sh
rtk npm test
rtk npm run typecheck
rtk npm run build
rtk npm run package:ipk
rtk proxy ares-package --check dist service
```

Tambahkan script yang terdokumentasi untuk:

- Node.js 16 compatibility.
- API simulation.
- Repository contract tests.
- UI smoke.
- Transfer/security contract.
- Migration/backup round-trip.

Jika Android companion berubah, dari root:

```sh
rtk proxy ./gradlew :modules:applemusic:test :modules:monochrome:test
rtk proxy ./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Sesuaikan targeted Android tests dengan perubahan companion. Jangan memodifikasi signing atau memasang build ke HP secara otomatis.

### Pengujian native yang tertunda

Tetap menunggu izin baru:

- Playback nyata dan suara.
- Protected Apple Music playback.
- DRM/session persistence.
- Audio Lab/DSP.
- Concurrent canvas/video.
- Background lifecycle.
- File storage/quota pada TV.
- Native remote dan performa.
- Upgrade IPK tanpa kehilangan data.

Simulator LG tidak membuktikan DRM maupun kesetaraan audio perangkat.

---

## 11. Kriteria selesai dan keluaran handoff

### Kriteria selesai implementasi lokal

- Semua tahap sudah dikerjakan atau mempunyai blocker spesifik yang terverifikasi.
- Semua baris matriks parity mempunyai status dan bukti.
- Home, Library, penjelajahan, player/menu, lirik dan settings berfungsi pada jalur lokal yang didukung.
- Tidak ada dummy actions yang dianggap selesai.
- Semua regresi baseline tetap lulus.
- IPK tidak mengandung URL komputer, secret, atau data pribadi.
- Tidak ada backend pengembang yang diperlukan saat penggunaan normal.
- Tidak mengklaim parity native penuh ketika pengujian perangkat masih tertunda.

### Artefak yang diserahkan

1. Source TV yang sudah diadaptasi.
2. Source Android companion yang berubah, bila diperlukan.
3. `.ipk` kandidat `0.4.0`.
4. APK companion bila berubah, tanpa auto-install.
5. Matriks parity lengkap.
6. Dokumentasi kontrak API dan portable backup.
7. Fixture serta Postman simulation.
8. Laporan tests/build/package.
9. Bukti UI lokal.
10. Daftar fitur supported/unsupported/unverified.
11. Panduan penggunaan impor, setup akun, offline dan recovery.
12. Daftar pengujian native yang masih menunggu izin.

### Instruksi terakhir untuk Claude

- Kerjakan berdasarkan Android owner yang tercatat pada audit.
- Pertahankan layout TV yang sudah disukai.
- Jangan menyederhanakan seluruh scope menjadi halaman Home dekoratif atau tambahan tab.
- Jangan berhenti pada scaffold, mock UI, atau menu tanpa state dan tindakan.
- Jika jalur tertentu terblokir platform, catat sebab, bukti, dampak dan statusnya; lanjutkan tahap lain yang tidak bergantung padanya.
- Jangan mengganti autentikasi atau dukungan DRM dengan klaim yang belum dibuktikan.
- Jangan meminta pengguna mengulang keputusan yang sudah ditetapkan dalam plan ini.
- Laporkan kemajuan per tahap beserta hasil pengujiannya.
- Jangan mengakses TV fisik sampai pengguna memberikan izin baru.
