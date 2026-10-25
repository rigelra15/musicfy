# Mobile/TV consistency

Reference: the original Android app, [realidkroo/musicfy](https://github.com/realidkroo/musicfy) (`app/src/main/kotlin/com/example/musicfy`); not part of this branch.

TV keeps the mobile black/white/gray palette and Inter fonts. The top navigation
is adapted for D-pad and viewing distance; it includes the Musicfy icon before
Cari. No decorative hero, debug instructions or permanent remote-help footer.

The TV player uses the user's Apple Music references for its layout: artwork and
controls on the left, integrated lyrics on the right, and extra options in an
ellipsis dropdown. The black/white Musicfy identity remains unchanged. No
separate lyrics page is exposed. The0.3.0 layout is verified locally only.

The requested player options are now ported:
- ui/utils/YouTubeUtils.kt artwork sizing => src/data/artwork.ts (1200px large)
- constants/PreferenceKeys.kt cover style enum and player/customize/DiscCover*
  => src/components/Artwork, with eight style IDs and26degrees/second rotation
- lyrics/LyricsProviderRegistry.kt => src/lyrics/types.ts and service/lyrics.cjs
- lyrics/LyricsEntry.kt words/syllables/voice/background => src/lyrics/types.ts
- lyrics/LyricsHelper.kt quality/language preference => src/lyrics/selection.ts
- LyricsProviderSheet and LyricsMotionStyle => compact TV-native options in
  LyricsView; detailed timing uses source timestamps and never guessed timing.

This records parity of these requested capabilities, not an assertion that every
Android screen, gesture, animation, audio effect, library management or offline
feature exists in this TV app. Compose graphics and phone touch interactions
are adapted to CSS and TV controls, with native device validation in VALIDATION.md.
