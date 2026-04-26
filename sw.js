// PriceWatch Service Worker
const CACHE_NAME = 'pricewatch-v2';
const URLS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('serpapi.com')) return; // never cache API calls
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// Periodic background check (every 10+ min, browser controlled)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'price-check') e.waitUntil(runChecks());
});

// Manual trigger from app
self.addEventListener('message', e => {
  if (e.data?.type === 'MANUAL_CHECK') e.waitUntil(runChecks());
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: e.data.tag,
      renotify: true,
      data: { url: e.data.url },
      actions: [{ action: 'open', title: '↗ Ver oferta' }]
    });
  }
});

async function runChecks() {
  const db = await openDB();
  const products = await getAll(db, 'products');
  const settings = await getAll(db, 'settings');
  const apiKey = settings.find(s => s.key === 'serpApiKey')?.value;
  if (!apiKey) return;

  for (const p of products) {
    if (p.paused) continue;
    const interval = p.interval * 60 * 1000;
    if (p.lastChecked && Date.now() - p.lastChecked < interval) continue;
    try { await checkProduct(p, apiKey, db); }
    catch (err) { console.error('SW check error', err); }
  }
}

async function checkProduct(p, apiKey, db) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(p.query)}&gl=br&hl=pt-br&api_key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const offers = parseOffers(data);
  if (!offers.length) return;

  const lowestNow = Math.min(...offers.map(o => o.price));
  const prev = p.lastLowestPrice || Infinity;
  const droppedBelowAlert = lowestNow <= p.alertPrice && prev > p.alertPrice;
  const significantDrop = prev !== Infinity && lowestNow < prev * 0.97;

  await put(db, 'products', { ...p, lastChecked: Date.now(), lastOffers: offers, lastLowestPrice: lowestNow });

  if (droppedBelowAlert || significantDrop) {
    const best = offers.sort((a,b)=>a.price-b.price)[0];
    const title = droppedBelowAlert
      ? `🔔 ${p.name} abaixo de R$${p.alertPrice.toLocaleString('pt-BR')}!`
      : `📉 ${p.name} caiu de preço!`;
    const body = `R$ ${lowestNow.toLocaleString('pt-BR')} na ${best.store}`;
    await self.registration.showNotification(title, {
      body, icon: './icon-192.png', badge: './icon-192.png',
      tag: `price-${p.id}`, renotify: true,
      data: { url: best.url },
      actions: [{ action: 'open', title: '↗ Ver oferta' }]
    });
  }
}

const TRUSTED = ['amazon', 'magazineluiza', 'magalu', 'americanas', 'casasbahia', 'fastshop', 'apple', 'submarino'];

function parseOffers(data) {
  const items = data.shopping_results || data.inline_shopping_results || [];
  return items
    .map(it => {
      const priceStr = (it.price || it.extracted_price || '').toString();
      const price = it.extracted_price || parseFloat(priceStr.replace(/[^\d,.]/g,'').replace(/\./g,'').replace(',','.'));
      const source = (it.source || it.seller || '').toLowerCase();
      const link = it.product_link || it.link || it.merchant?.url || '';
      let storeId = null;
      for (const t of TRUSTED) {
        if (source.includes(t) || link.includes(t)) { storeId = t === 'magazineluiza' ? 'magalu' : t; break; }
      }
      return { price, store: it.source || it.seller || 'Loja', storeId, url: link, desc: it.title || '' };
    })
    .filter(o => o.price > 0 && o.storeId && o.url);
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || './index.html';
  e.waitUntil(clients.openWindow(url));
});

// IndexedDB
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('PriceWatchDB', 2);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
  });
}
function getAll(db, store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store,'readonly').objectStore(store).getAll();
    r.onsuccess = e => res(e.target.result || []);
    r.onerror = rej;
  });
}
function put(db, store, obj) {
  return new Promise((res, rej) => {
    const r = db.transaction(store,'readwrite').objectStore(store).put(obj);
    r.onsuccess = () => res();
    r.onerror = rej;
  });
}
