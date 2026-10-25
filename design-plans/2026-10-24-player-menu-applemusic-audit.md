# Audit lanjutan: Apple Music dan seluruh jalur menu player

Tanggal:24 Oktober2026. Repo:/Users/rigelra/Devs/musicfy.
Lanjutan dari [audit Android/TV](2026-10-23-android-tv-parity-audit.md).

## Status bukti

Audit kali ini menelusuri kode Android lokal8.1.0 build#1161: deklarasi aksi,
pemanggil, state, handler, submenu, dan penyimpanan yang digunakannya. APK yang
sebelumnya diperiksa langsung di HP adalah build#1160. Bukti runtime sebelumnya
berlaku untuk halaman yang benar-benar dibuka, bukan setiap handler dalam kode.

Tidak menjalankan login baru, membaca token akun HP, logout, membeli langganan,
mengubah preferensi, menjalankan tombol diagnostik, atau mengakses TV fisik.
Source produk tidak berubah. Laporan ini tidak menyatakan port webOS sudah lengkap
atau bahwa semua fungsi Android sudah diuji end-to-end.

## Acuan adaptasi yang ditegaskan pengguna

- Musicfy Android menjadi acuan struktur fitur, model konten, nama opsi, keadaan,
  penyimpanan, serta perilaku menu dan navigasi turunannya.
- Pertahankan player TV saat ini yang disukai pengguna: cover/kontrol di kiri,
  lirik di kanan, navigasi atas dan opsi titik tiga; bukan alasan membatasi fungsi.
- Terjemahkan interaksi sentuh menjadi operasi remote yang sesuai. Tidak perlu
  menciptakan konsep produk atau menu pengganti untuk fungsi yang sudah ada.
- Setiap item yang diport harus menunjuk pemilik Android dan mencatat hasilnya:
  tersedia, parsial, belum diport, atau perlu dukungan platform.
- Pilihan yang disabled/no-op di Android bukan bukti implementasi yang selesai.
  Pertahankan batas kemampuan dengan jujur; jangan membuat tombol sukses palsu.

## 1. Apple Music: dua alur berbeda

### Pemutaran melalui Modules

1. Settings → Modules → Apple Music membuka ModuleScreen.
2. Jika SignedOut/Expired, tombol Sign in/Sign in again membuka module_signin/applemusic.
3. ModuleSignInScreen menggunakan CaptureWebView dan SignInSpec milik modul.
   Halaman awalnya https://music.apple.com/us/library/playlists. Origin login
   yang dideklarasikan termasuk music.apple.com, idmsa.apple.com,
   authorize.music.apple.com dan www.apple.com.
4. Modul menerima sesi web player melalui header Authorization dan
   Media-User-Token. Nama header ini adalah kontrak kode; nilai akun tidak dibaca
   pada audit ini. Data sesi disimpan oleh host modul, bukan form password Musicfy.
5. verifyAccount meminta storefront akun. State yang digunakan SignedOut,
   SignedIn dan Expired;401/403 mencoba refresh developer token sekali sebelum
   meminta sign in lagi. Storefront menentukan negara katalog default.
6. ModulesViewModel mengaktifkan modul setelah verifikasi SignedIn. Tersedia
   Check account, Sign out, toggle Play from Apple Music, Stream dan Region.
7. SourceModules memilih provider menurut urutan yang disimpan. Modul harus
   enabled dan usable. Katalog dicocokkan dengan ISRC bila ada, atau judul/artis/
   durasi; salinan rekaman berdekatan juga dicoba.
8. Hasil modul diteruskan oleh MusicService → DynamicResolvingMediaSource →
   ExoPlayer dengan WidevineDrm. Pemutaran bukan sekadar URL MP3 tanpa lisensi.
9. Run the test memiliki langkah Account, Find the song, Stream, License dan
   decoding awal lagu secara muted. Verifikasi akun saja tidak membuktikan
   lisensi, kecocokan rekaman, atau decoding pemutaran berhasil.

Opsi aktual modul adalah AAC256 dan HE-AAC64 serta Region otomatis/negara.
Kode dan layar modul menyatakan batas lossless/Atmos/Spatial Apple serta offline
download pada jalur web tersebut. Pernyataan ini menjelaskan implementasi repo,
bukan penilaian terhadap seluruh kemampuan layanan Apple Music.

Label Apple Music pada pilihan lirik TV masih merupakan BetterLyrics; jalur
Modules/login/audio di atas belum ada di TV0.3.0. Login Apple juga tidak membuktikan
afiliasi resmi: README proyek sendiri menyatakan independen dan tidak berafiliasi.

Pemilik:
- [ModuleScreen dan ModuleSignInScreen](../app/src/main/kotlin/com/example/musicfy/ui/screens/settings/modules/ModulesScreens.kt)
- [AppleMusicModule](../modules/applemusic/src/main/kotlin/com/example/musicfy/module/applemusic/AppleMusicModule.kt)
- [ModulesViewModel](../app/src/main/kotlin/com/example/musicfy/viewmodels/ModulesViewModel.kt)
- [SourceModules](../app/src/main/kotlin/com/example/musicfy/modules/SourceModules.kt)
- [MusicService](../app/src/main/kotlin/com/example/musicfy/playback/MusicService.kt)
- [DynamicResolvingMediaSource](../app/src/main/kotlin/com/example/musicfy/playback/custom/DynamicResolvingMediaSource.kt)
- [WidevineDrm](../app/src/main/kotlin/com/example/musicfy/playback/custom/WidevineDrm.kt)
- [Disclaimer proyek](../README.md)

### Impor Library Apple Music

AccountImportScreen/CaptureWebView juga digunakan untuk impor akun. AppleMusicConnector
memvalidasi sesi/storefront lalu AppleMusicLibrary membaca playlist dan lagu Library,
termasuk pemetaan playlist favorit. Ini pekerjaan berbeda dari modul streaming.
Jangan menganggap login impor otomatis menyelesaikan modul audio atau sebaliknya.

Pemilik: [AppleMusicAccount.kt](../app/src/main/kotlin/com/example/musicfy/importer/account/AppleMusicAccount.kt),
[AccountImportScreen.kt](../app/src/main/kotlin/com/example/musicfy/ui/screens/settings/importsync/AccountImportScreen.kt),
[CaptureWebView.kt](../app/src/main/kotlin/com/example/musicfy/ui/screens/settings/importsync/CaptureWebView.kt).

### Batas adaptasi webOS

Pemilihan provider, model state akun, pencocokan lagu, region, kualitas dan tahapan
verifikasi dapat menjadi kontrak adaptasi. Android WebView/MediaDrm/ExoPlayer dan
SharedPreferences bukan API yang bisa langsung dipanggil Preact/webOS. Login dan
pemutaran berlisensi pada runtime webOS memerlukan implementasi serta pembuktian
platform tersendiri; hasil Android tidak menjadi bukti bahwa jalur itu sudah bisa
berjalan di TV. Audit ini belum menguji kelayakan DRM webOS.

## 2. Menu cepat player:14 aksi

Empat slot menu dan satu tombol samping dapat diubah. Default slotnya Other menu,
Sleep timer, See video, Repeat; tombol samping Like. Memindahkan aksi yang sudah
ada menukar posisinya agar tidak terduplikasi. Pilihan disimpan dalam preferensi.

|ID / label Android|Handler aktual|Status TV0.3.0|
|---|---|---|
|LIKE / Like|Toggle like dan animasi heart|Belum ada|
|OTHER_MENU / Other menu|Buka PlayerActionMenu; konteks lirik ikut diteruskan|Dropdown TV baru subset tampilan/lirik|
|SLEEP_TIMER / Sleep timer|Buka SleepTimerSheet|Belum ada|
|SEE_VIDEO / See video|Toggle state seeVideo|Belum ada|
|REPEAT / Repeat|toggleRepeatMode pada player|Belum ada|
|SHUFFLE / Shuffle|Toggle shuffleModeEnabled|Belum ada|
|LYRICS / Lyrics|Buka halaman lirik Android|Lirik TV terintegrasi kanan sesuai permintaan pengguna|
|QUEUE / Queue|Buka QueueScreen|Ada daftar antrean sederhana|
|SPEED / Playback speed|Buka PlaybackSpeedSheet|Belum ada|
|OUTPUT / Device output|Buka DeviceOutputSheet|Volume app ada; pilihan output belum ada|
|KEEP_AWAKE / Keep screen on|Toggle preferensi KeepScreenOn|Belum ada|
|TRANSLATE_LYRICS / Translate lyrics|Hapus/trigger terjemahan; buka lirik|Belum ada|
|DOWNLOAD / Download|Tambah/hapus/stop DownloadService dan database|Belum ada|
|ADD_TO_PLAYLIST / Add to playlist|Buka pemilih playlist|Belum ada|

Pemilik: [PlayerMenuActions.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/studio/PlayerMenuActions.kt),
[PlayerMenuExtras.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/studio/PlayerMenuExtras.kt),
[BottomSheetPlayer.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/BottomSheetPlayer.kt).

## 3. Isi Other menu dan submenu turunannya

|Item|Isi/efek yang ditelusuri|
|---|---|
|Add to playlist|Daftar playlist, pencarian, recents, Create playlist; deteksi duplikat dengan Skip duplicates/Add anyway/Cancel; database dan sinkronisasi playlist bila browseId ada|
|Download|Menyimpan metadata ke database dan mengirim download request; state selesai/berjalan memberi tindakan remove/cancel. Dukungan tiap sumber harus diperhatikan|
|Volume perangkat|AudioManager STREAM_MUSIC; berbeda dari volume app|
|Change device output|Volume perangkat, Music volume, daftar output, shortcut Bluetooth settings|
|Sleep timer|Durasi jam/menit, Set timer, akhir lagu, Cancel timer dan label sisa waktu|
|Keep screen on|Preferensi layar tetap menyala|
|Playback speed and tempo|Speed dan Pitch0.25–3×, reset ke1×; menggunakan AudioLabStore yang sama dengan Audio FX|
|Add/remove liked|Toggle like tersimpan|
|Add/remove library|Toggle status Library, memerlukan metadata lagu|
|share song|Disabled, handler kosong pada source saat audit|
|edit player|Buka selector Player Studio yang sama dengan long press, bukan langsung ganti cover|

Jika dibuka dari lirik, empat item tambahan muncul di atas:

|Item lirik|Isi/efek yang ditelusuri|
|---|---|
|Ai translation|Kartu disabled dengan handler kosong; berbeda dari sheet terjemahan di bawah|
|Edit lyrics|Draft teks per baris dengan timestamp tetap; Save membentuk LRC dan menyimpan provider UserEdited. Bukan editor timing kata/suku kata|
|Lyrics provider|Memeriksa sumber, urutan available lebih dulu, status In use/Word synced/Line synced/Plain/Not found/Off/Checking dan duet; memilih hasil yang sudah diambil; pilihan disimpan per lagu|
|lyrics translation|Bahasa asal otomatis/manual, bahasa tujuan, Translate this whole session; Translate/Show original/stop; pemilih bahasa dengan pencarian dan status error|

Tombol Switch pada footer lirik membuka LyricsProviderSheet yang sama.
Terjemahan mempunyai jalur Google dan jalur provider/API konfigurabel di helper;
keberadaan kartu Ai translation disabled tidak berarti seluruh terjemahan mati.
Tidak menjalankan request terjemahan pada audit ini.

Batas yang ditemukan pada implementasi Android:
- DeviceOutputSheet menampilkan daftar perangkat dengan onClick kosong. Slider
  volume dan shortcut Bluetooth mempunyai handler; daftar bukan bukti routing
  output langsung sudah bekerja. Ini juga bukan bukti receiver Google Cast.
- Label Appearance “Customize lyrics tab” menjanjikan style/typography, tetapi
  handler saat ini hanya toggle lyricsWaveAnimation, sama dengan Lyrics Shader.
  Audit awal yang menyebutnya sebagai editor typography lengkap perlu dikoreksi.
- UI translation/sumber/editor dibedakan dari fungsi yang sudah diuji runtime;
  editor menyimpan LRC per baris, tidak mempertahankan seluruh rich word timing.

Pemilik:
- [PlayerActionMenu.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/PlayerActionMenu.kt)
- [AddToPlaylistDialog.kt](../app/src/main/kotlin/com/example/musicfy/ui/menu/AddToPlaylistDialog.kt)
- [SleepTimerSheet.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/SleepTimerSheet.kt)
- [DeviceOutputSheet.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/DeviceOutputSheet.kt)
- [PlaybackSpeedSheet.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/PlaybackSpeedSheet.kt)
- [LyricsToolSheets.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/LyricsToolSheets.kt)
- [LyricsMenuViewModel.kt](../app/src/main/kotlin/com/example/musicfy/viewmodels/LyricsMenuViewModel.kt)
- [LyricsTranslationHelper.kt](../app/src/main/kotlin/com/example/musicfy/lyrics/LyricsTranslationHelper.kt)
- [AppearanceSettingsScreen.kt](../app/src/main/kotlin/com/example/musicfy/ui/screens/settings/AppearanceSettingsScreen.kt)

## 4. Detail lagu dan menu style alternatif

SongDetailsSheet memiliki baris View artist untuk setiap artis yang punya id,
View album bila metadata tersedia, dan About song yang memuat deskripsi. About
song adalah sheet bertingkat; Done kembali ke sheet detail. Membuka artis/album
menutup player ke mini-player dan bernavigasi ke halaman konten.

Poster/Timeline/Lyrics-stage menggunakan StyleMenu: Lyrics (bila tersedia),
Other menu, Rotate/Turn upright dan Edit player. Other menu menunjuk handler
bersama, tidak membentuk implementasi pengaturan lagu yang terpisah.

Pemilik: [SongDetailsSheet.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/menu/SongDetailsSheet.kt),
[StyleKit.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/styles/StyleKit.kt),
[AlternatePlayerStyles.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/styles/AlternatePlayerStyles.kt).

## 5. Edit player bukan hanya cover

|Kelompok|Pilihan yang ditelusuri|
|---|---|
|Seluruh preset player|5:Default/Flagship, Turntable, Poster, Timeline, Lyrics stage|
|Model cover|8:Edge to edge, Squared, Disc small full/label, Disc big full/label, Disc album, Turntable; Turntable khusus player terkait|
|Controls|5:Default, M3 Expressive, M3 Expressive tanpa label, M3 tonal, Android legacy|
|Seekbar|4:Default, M3 Expressive1, M3 Expressive slider2, plain|
|End timestamp|End/total duration atau Time left|
|Bottom bar|Stack kartu Lyrics/Queue atau Volume|
|Posisi/ukuran|Preferensi perpindahan kontrol dan pertumbuhan kartu; bukan nilai posisi wajib disalin ke TV|
|Menu slots|4slot dan1tombol samping; memilih dari14aksi dan menukar posisi aksi yang sudah dipakai|
|Cover options|Animated canvas; Yt video background dan Timestamp matching bergantung mode; disc rotation, realistic, Disc name|
|Disc label|Custom name, Music name, Artist, Album, Music+artist, Nothing|
|Poster|Toggle visualizer di sekeliling cover|
|Style alternatif|Rotasi orientasi per style; interaksi sentuh playback pada style tertentu|

TV saat ini membawa8ID cover dan sebagian opsi disc, bukan5preset seluruh player,
5gaya tombol,4gaya seekbar atau Player Studio lengkap. Ini koreksi penting terhadap
pemahaman bahwa semua fitur customization sudah dipindahkan.

Di luar menu, tombol next/previous yang ditahan memberi kecepatan sementara2×/
0.5× relatif ke setelan pengguna, lalu dipulihkan saat dilepas. Gestur carousel,
lyrics/queue immersion dan long press ke studio juga ada; kontrak perilakunya
perlu dipetakan ke remote, bukan menyalin gestur sentuh secara literal.

Pemilik:
- [PreferenceKeys.kt](../app/src/main/kotlin/com/example/musicfy/constants/PreferenceKeys.kt)
- [StudioSheets.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/studio/StudioSheets.kt)
- [PlayerStudioState.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/studio/PlayerStudioState.kt)
- [BarEditor.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/studio/BarEditor.kt)
- [PlayerCoverStyles.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/customize/PlayerCoverStyles.kt)
- [ButtonStyles.kt](../app/src/main/kotlin/com/example/musicfy/ui/component/ButtonStyles.kt)
- [SeekBarStyles.kt](../app/src/main/kotlin/com/example/musicfy/ui/component/SeekBarStyles.kt)
- [PlayerControls.kt](../app/src/main/kotlin/com/example/musicfy/ui/player/PlayerControls.kt)

## 6. Cakupan yang sudah ditelusuri dan batasnya

- Deklarasi seluruh14 PlayerMenuAction dan dispatch pada BottomSheetPlayer/
  PlayerMenuExtras, default/penyimpanan/penukaran menu, dan style alternatif.
- Setiap kelompok Other menu serta cabang fromLyrics dan pemanggilan sheet anak.
- Isi sheet speed, sleep, device output, provider, editor, translation/language,
  playlist/create/duplicates, detail artist/album/about, serta daftar StudioSheets.
- Alur Modules/login/verify/state/provider order/resolve/DRM/playback diagnostics,
  dibedakan dari import Library Apple Music dan sumber lirik Apple Music.
- Handler disabled/no-op dan ketidakcocokan label yang terkonfirmasi di source.

Ini inventarisasi kode jalur yang disebut, bukan klaim seluruh layar Android,
semua kombinasi preferensi, semua provider dan semua layanan pihak ketiga telah
diuji berjalan. Eksplorasi runtime HP sebelumnya lebih sempit dan tercatat di
audit utama. TV hanya dinilai terhadap implementasi lokal0.3.0.

## 7. Konsekuensi untuk pekerjaan berikutnya

Gunakan matriks utama untuk Home/Library/discovery dan laporan ini untuk player/
autentikasi. Setiap port harus membawa state dan tindakan sebenarnya, termasuk
persistensi, error, loading, pengaturan yang saling bergantung dan Back pada
submenu. Layout player TV yang sekarang diterima tetap menjadi wadahnya.

Hal yang harus dibuktikan terpisah dari kesamaan UI: login/session webOS,
pemutaran Apple Music berlisensi, DSP, output perangkat, offline dan sinkronisasi
akun. Menampilkan menu/label yang sama tidak menyelesaikan dukungan platform.
