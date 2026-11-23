import { defineConfig, type Plugin } from 'vite';

/** Writes sw.js with the list of built files so the game works offline after the first visit. */
function serviceWorker(): Plugin {
  return {
    name: 'ashton-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).map((f) => `./${f}`);
      const assets = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', ...files];
      const version = Date.now().toString(36);
      const source = `// Generated at build time.
const CACHE = 'ashton-life-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  // `npm run relay` runs the family relay locally; the dev server forwards /relay to it.
  server: { proxy: { '/relay': { target: 'ws://localhost:8788', ws: true } } },
  preview: { proxy: { '/relay': { target: 'ws://localhost:8788', ws: true } } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('@babylonjs') ? 'babylon' : undefined) },
    },
  },
});
