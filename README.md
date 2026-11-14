# Module Federation + PWA: offline remotes

This PoC shows a federated host that keeps working after a reload with no network. That includes remotes served from another origin.

https://github.com/Nsttt/mf-vite-pwa-offline/raw/main/docs/demo.mp4

▶️ [Watch the demo](docs/demo.mp4). The video loads the host online, kills both servers, switches the browser offline and reloads. The host and the remote still render, and so does a lazy remote chunk that was never opened while online.

- `pwa-remote` (`:5181`) exposes `./Widget`. The widget has a lazy chunk, so we can tell whether async remote chunks get cached too.
- `pwa-host` (`:5180`) uses [`@module-federation/vite`](https://github.com/module-federation/vite) and [`@unplugin-pwa/vite`](https://github.com/vite-pwa/unplugin-pwa) together.

## Run it

```bash
pnpm install
pnpm preview              # builds + previews both apps
open http://localhost:5180
```

Load the page once while online. Then go offline (DevTools → Network → Offline), or kill both servers, and reload. The remote still renders. "Show lazy details" also loads, even if you never opened it while online.

Service workers only make sense against a build. The dev server is not covered.

## How it works

Three layers each handle one part of the problem.

1. **Precache (host shell).** `generateSW` precaches the host's own build output: `index.html`, entry chunks, `hostInit`, loadShare chunks and the host `remoteEntry`. It sets `navigateFallback: 'index.html'`.

2. **Runtime caching (remote origins)** — [`pwa-host/vite.config.js`](pwa-host/vite.config.js) turns `REMOTE_ORIGINS` into two Workbox routes:
   - `mf-manifest.json` is not hashed, so it uses `NetworkFirst` (3s timeout) in the `mf-remote-manifests` cache. Online, you get new remote deploys. Offline, you get the last known manifest.
   - Everything else on the remote origin is content-hashed (`remoteEntry-[hash].js`, chunks, css), so it uses `CacheFirst` in `mf-remote-assets`.

3. **Warm-up runtime plugin** — [`pwa-host/src/offlineRemotesPlugin.js`](pwa-host/src/offlineRemotesPlugin.js). The service worker can't intercept anything on the first visit, before it takes control. The runtime caching in layer 2 also only stores what was actually requested. This MF runtime plugin closes both gaps:
   - `loadRemoteSnapshot` records each remote's `manifestUrl` and `manifestJson`.
   - `onLoad` writes the following into the same Cache Storage buckets the SW reads from:
     - the manifest
     - every asset listed in it (remoteEntry, exposes sync and async, shared)
     - every remote-origin resource the page already fetched (Resource Timing). This catches chunks the manifest doesn't list, such as `virtualExposes`, loadShare proxies and preload helpers.
   - When it finishes, it dispatches a `mf-offline:warmed` event, which the UI shows.

   Without this plugin, the first-visit → offline-reload flow fails outright: the host doesn't render at all. The e2e test fails if the warm-up is disabled.

## Test

```bash
pnpm e2e
```

[`e2e/offline.spec.ts`](e2e/offline.spec.ts) does four things:
- loads the host online and waits for the warm-up
- calls `context.setOffline(true)` and reloads
- checks the remote renders and its lazy chunk loads
- checks every remote response came from the service worker

## Record the demo video

```bash
pnpm record   # → reports/pwa-offline-demo/demo.{webm,mp4}
```

[`e2e/record-demo.mjs`](e2e/record-demo.mjs) starts both previews and drives Chromium through the scenario. It shows:
- a drawn mouse pointer, since headless recordings have none
- captions for each step
- a panel showing whether each remote request came from the network, the service worker or the warm-up
- a panel with the contents of Cache Storage

If Playwright's pinned browser isn't installed, set `PW_CHROMIUM_PATH` to point at a Chromium binary. This works for `pnpm e2e` and `pnpm record`.

## Known limits / next steps

- **Remote deploys while offline.** The cached manifest points at the cached hashed chunks, so it stays consistent. Once back online, `NetworkFirst` picks up the new manifest. Old hashed assets are only evicted by the `expiration` plugin (500 entries / 30 days).
- **Nested lazy chunks.** The manifest lists only the first level of async chunks for each expose. Their own deeper imports are cached only once fetched. A full solution would need `mf-manifest.json` to list the whole chunk graph, or the remote to ship its own asset list.
- **CORS.** The remote must send CORS headers. Vite's preview server already allows `localhost` by default. Without CORS, responses are opaque. They are still cached (`statuses: [0, 200]`) but count heavily against storage quota.
- **`@unplugin-pwa/vite@0.0.6` quirks.** It needs `magicast` and `rolldown` installed for `generateSW`. It also logs a harmless rolldown `debugName` warning during the SW build.
