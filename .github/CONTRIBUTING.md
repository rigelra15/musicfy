# Contributing to Musicfy for LG webOS TV

Thanks for wanting to help. This is an unofficial TV port of [Musicfy](https://github.com/realidkroo/musicfy), kept small, so the process is light.

> [!NOTE]
> Independent project, not affiliated with, endorsed by, or sponsored by YouTube, Google, Spotify, Apple, LG, Last.fm, Deezer or any other service it talks to. See the Disclaimer in the [README](../README.md).

## Getting set up

- Node.js 22.12 or newer
- LG's webOS CLI to package the app: `npm install --global @webos-tools/cli`
- An LG webOS TV in Developer Mode if you want to try it on a real TV (the install guide is in the [README](../README.md#install-on-your-tv))

```sh
cd webos-tv
npm ci
npm run dev -- --port 4177   # browser preview
npm run typecheck
npm test
npm run package:ipk
```

Developer notes (layout, service, remote control) are in [`webos-tv/README.md`](../webos-tv/README.md).

## Making a change

1. **Fork and branch** with a short name such as `fix/player-crash`.
2. **Keep it focused.** One fix or feature per pull request.
3. **Match the surrounding code**: naming, structure and comment style. Don't reformat code you aren't changing.
4. **Think about the remote.** Every screen must work with the D-pad, OK and Back, and focus must stay visible from the couch.
5. **Both languages.** User-facing text goes into `src/app/i18n.ts` in Indonesian and English. A test fails if text is hard-coded in code.
6. **Test it.** `npm run typecheck` and `npm test` must pass; add a test for logic you change. Say what you checked in the browser or on a TV.

## Reporting bugs

Open an issue on this repository with the app version, your TV model and webOS version, what you did, what you expected and what happened. A screenshot helps. Please do not report problems with this TV app to the original repository, which does not support forks.

## Third-party services and content

- Don't commit API keys, tokens, cookies or account credentials.
- Don't add code whose purpose is to bypass DRM, paywalls or access controls.
- Don't add trackers or analytics. Not collecting user data is a project goal.
- Playback and metadata come from third-party services that can change or break at any time.

## Licensing

Licensed under the [GNU General Public License v3.0](../LICENSE). By contributing you agree that your contribution is released under the same license. Keep existing copyright and attribution notices, and credit the source of any code you bring in from another project (it must be GPL-3.0 compatible).
