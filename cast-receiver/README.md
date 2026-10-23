# Musicfy TV receiver

This static Preact receiver uses Google Cast CAF for playback and Musicfy's
custom Cast channel for artwork, synchronized lyrics, and display-mode updates.
It does not contain playback URLs, account tokens, or other credentials.

## Preview

From this folder, run `npm ci`, then `npm run dev` and open `/?demo` to preview
the screen with sample artwork and lyrics. Run `npm test`, `npm run typecheck`,
and `npm run build` before deployment.

## Connect a real receiver

1. Enable GitHub Pages with **GitHub Actions** as the publishing source. Check
   whether this repository already publishes a Pages site first: the Pages
   deploy action publishes the uploaded artifact as the whole site. If another
   site is already there, update the workflow to include its output in the
   uploaded `site/` artifact before deploying. The manual workflow fails by
   default until its `pages_site_checked` confirmation is selected.
2. Run **Deploy Cast Receiver** from GitHub Actions only after confirming the
   existing site can safely be replaced by the artifact. The receiver URL is
   `https://rigelra15.github.io/musicfy/cast-receiver/`.
3. In the Google Cast SDK Developer Console, create a **Custom Web Receiver**
   using that URL and register the LG TV for private testing. Save the generated
   application ID.
4. Add `MUSICFY_CAST_APP_ID=<application-id>` to the ignored root
   `local.properties`, then build and install the Android **GMS** variant. Leave
   the ID out of committed files and public CI logs.
5. Cast a track from Musicfy and check custom receiver launch, playback, seek,
   next track, reconnect, and lyric synchronization on the TV.

Until an application ID is configured, Android continues to use Google's
Default Media Receiver. In that state, Musicfy's custom TV layout and lyrics
controls are intentionally unavailable.
