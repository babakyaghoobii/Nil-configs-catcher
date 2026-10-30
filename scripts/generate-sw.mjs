import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

async function files(dir, prefix = "") {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(...(await files(join(dir, entry.name), path)));
    else if (entry.name !== "sw.js") result.push(path.replaceAll("\\", "/"));
  }
  return result;
}
const directory = process.argv[2] || "dist";
if (!["dist", "dist-hosted"].includes(directory))
  throw new Error("Unsupported build directory");
const paths = (await files(directory)).sort();
const hash = createHash("sha256");
hash.update(await readFile(new URL(import.meta.url)));
for (const path of paths) hash.update(await readFile(join(directory, path)));
const version = hash.digest("hex").slice(0, 16);
// Include data in the version so every published batch activates a fresh cache.
// Seed a coherent data snapshot too: offline works after the first visit,
// even if initial page requests preceded service-worker activation.
const precache = paths;
await writeFile(
  join(directory, "sw.js"),
  `
'use strict';
const CACHE = 'nil-${version}';
const BASE = self.registration.scope;
const ASSETS = ${JSON.stringify(precache)}.map(path => new URL(path, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shellURL = new URL('index.html', BASE).href;
    await cache.addAll(ASSETS.filter(url => url !== shellURL));
    // Some static hosts redirect index.html to /. Store a fresh 200 response:
    // WebKit refuses a redirected cached response for later app navigations.
    const shell = await fetch(shellURL, { cache: 'reload' });
    if (!shell.ok || new URL(shell.url).origin !== self.location.origin || !shell.url.startsWith(BASE)) throw new Error('App shell unavailable');
    const headers = new Headers(shell.headers);
    headers.delete('Content-Encoding'); headers.delete('Content-Length'); headers.delete('Transfer-Encoding');
    await cache.put(shellURL, new Response(await shell.arrayBuffer(), { status: 200, headers }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('nil-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !request.url.startsWith(BASE)) return;
  if (url.pathname.startsWith(new URL('data/', BASE).pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let response;
        try { response = await fetch(request, { cache: 'no-store', signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (!response.ok) throw new Error('Data unavailable');
        await cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (!cached) return new Response('Offline and no cached data', { status: 503 });
        const headers = new Headers(cached.headers); headers.set('X-Nil-Cache', 'offline');
        return new Response(await cached.arrayBuffer(), { status: 200, headers });
      }
    })());
  } else {
    event.respondWith(caches.open(CACHE).then(async cache => {
      // Navigation is the cached app shell. Do not require a failed network
      // navigation before returning it (important for offline WebKit).
      if (request.mode === 'navigate') {
        const shell = await cache.match(new URL('index.html', BASE).href);
        if (shell) return shell;
      }
      const cached = await cache.match(request); if (cached) return cached;
      try { return await fetch(request); }
      catch (error) { if (request.mode === 'navigate') return await cache.match(new URL('index.html', BASE).href) || Response.error(); throw error; }
    }));
  }
});
`,
);
console.log(`Service worker ${version}: ${precache.length} local assets`);
