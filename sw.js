"use strict";

const cachePrefix = `age-capital-structure:${self.registration.scope}:`;
const cacheName = `${cachePrefix}v1`;
const assets = [
  "./", "./index.html", "./styles.css", "./capstruct.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png", "./data/assumptions.csv", "./data/cdss.csv",
  "./data/example_firms.csv", "./data/ebit_scenarios.csv", "./data/banker_schedule.csv"
];
const assetUrls = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(cacheName);
  let response;
  try {
    response = await fetch(request, { cache: "no-cache" });
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }

  if (response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn("Could not refresh the offline copy.", error);
    }
  } else if (response.status >= 500) {
    return (await cache.match(request)) ?? response;
  }
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !assetUrls.has(request.url)) return;
  event.respondWith(networkFirst(request));
});
