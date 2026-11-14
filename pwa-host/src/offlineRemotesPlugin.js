// Module Federation runtime plugin that copies everything a remote needs into
// the Cache Storage buckets the service worker reads from (see vite.config.js).
//
// Why bother if the SW already has runtime caching? On the very first visit the
// SW is not controlling the page yet, so the remote requests made during that
// load bypass it. Lazy chunks the user never opened are not fetched at all.
// This plugin closes both gaps so "load once online, reload offline" works.

const MANIFEST_CACHE = 'mf-remote-manifests';
const ASSET_CACHE = 'mf-remote-assets';

const canCache = () => typeof window !== 'undefined' && 'caches' in window;

function collectManifestAssets(manifestJson, manifestUrl) {
  const publicPath =
    manifestJson.metaData.publicPath && manifestJson.metaData.publicPath !== 'auto'
      ? manifestJson.metaData.publicPath
      : new URL('.', manifestUrl).href;
  const toUrl = (file) => new URL(file, publicPath).href;
  const urls = new Set();

  const { remoteEntry } = manifestJson.metaData;
  if (remoteEntry?.name) {
    urls.add(toUrl([remoteEntry.path, remoteEntry.name].filter(Boolean).join('/')));
  }
  for (const item of [...manifestJson.exposes, ...manifestJson.shared]) {
    const { js, css } = item.assets ?? {};
    for (const group of [js, css]) {
      for (const file of [...(group?.sync ?? []), ...(group?.async ?? [])]) {
        urls.add(toUrl(file));
      }
    }
  }
  return urls;
}

// Chunks that are not listed in mf-manifest.json (loadShare proxies,
// virtualExposes, preload helpers...) but were already fetched by this page.
function collectLoadedResources(origin) {
  return performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => url.startsWith(origin) && !url.includes('mf-manifest.json'));
}

async function addMissing(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const results = await Promise.allSettled(
    [...urls].map(async (url) => {
      if (await cache.match(url, { ignoreVary: true })) return 'hit';
      await cache.add(new Request(url, { mode: 'cors', credentials: 'omit' }));
      return 'added';
    })
  );
  return results;
}

async function warmRemote({ manifestUrl, manifestJson }) {
  const origin = new URL(manifestUrl).origin;
  const manifestCache = await caches.open(MANIFEST_CACHE);
  await manifestCache.add(new Request(manifestUrl, { mode: 'cors', credentials: 'omit' }));

  const urls = collectManifestAssets(manifestJson, manifestUrl);
  for (const url of collectLoadedResources(origin)) urls.add(url);

  const results = await addMissing(ASSET_CACHE, urls);
  const failed = results.filter((r) => r.status === 'rejected');
  console.info(
    `[mf-offline] ${manifestJson.name}: ${urls.size - failed.length}/${urls.size} assets cached`,
    failed.length ? failed.map((f) => f.reason) : ''
  );
  window.dispatchEvent(
    new CustomEvent('mf-offline:warmed', {
      detail: { remote: manifestJson.name, total: urls.size, failed: failed.length },
    })
  );
}

export default function offlineRemotesPlugin() {
  // manifestUrl -> manifestJson, filled when the runtime resolves a remote.
  const pending = new Map();

  const flush = () => {
    if (!canCache() || !navigator.onLine) return;
    for (const [manifestUrl, manifestJson] of pending) {
      pending.delete(manifestUrl);
      warmRemote({ manifestUrl, manifestJson }).catch((error) =>
        console.warn('[mf-offline] warm-up failed', manifestUrl, error)
      );
    }
  };

  return {
    name: 'mf-offline-remotes',
    loadRemoteSnapshot(args) {
      if (args.from === 'manifest' && args.manifestJson && args.manifestUrl) {
        pending.set(args.manifestUrl, args.manifestJson);
      }
      return args;
    },
    onLoad(args) {
      // Wait until the exposed module (and its imports) finished loading so the
      // Resource Timing entries include every chunk it pulled in.
      setTimeout(flush, 0);
      return args;
    },
  };
}
