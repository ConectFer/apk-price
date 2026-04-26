// Service Worker — PriceWatch
// Handles background periodic checks and push notifications

const CACHE_NAME = 'pricewatch-v1';
const CACHE_URLS = ['./index.html', './manifest.json'];

// ── Install ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── Fetch (serve from cache when offline) ────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── Periodic Background Sync ──────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'price-check') {
    e.waitUntil(runPriceChecks());
  }
});

// ── Message from main thread (manual trigger) ────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'MANUAL_CHECK') {
    runPriceChecks();
  }
});

// ── Core: run checks for all watched products ─────────────
async function runPriceChecks() {
  // Load products from IndexedDB via a trick (SW can't use localStorage)
  const allClients = await clients.matchAll({ includeUncontrolled: true });

  // Get products list from the SW cache store
  const db = await openDB();
  const products = await getAllProducts(db);

  for (const product of products) {
    try {
      await checkProduct(product, db);
    } catch (err) {
      console.error('[SW] Error checking', product.name, err);
    }
  }
}

async function checkProduct(product, db) {
  const today = new Date().toLocaleDateString('pt-BR');

  const prompt = `Hoje é ${today}. Busque o preço ATUAL de "${product.query}" nas lojas brasileiras: Amazon Brasil, Magazine Luiza, Americanas, Casas Bahia, Fast Shop. NÃO inclua Shopee, AliExpress ou OLX.

Retorne SOMENTE JSON válido sem markdown:
{
  "offers": [
    {"store": "Amazon Brasil", "storeId": "amazon", "price": 1234, "url": "https://...", "desc": "nome do produto"}
  ],
  "lowestPrice": 1234
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  if (data.error) return;

  // Handle tool_use loop
  let finalText = '';
  let msgs = [{ role: 'user', content: prompt }];
  msgs.push({ role: 'assistant', content: data.content });

  if (data.stop_reason === 'tool_use') {
    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    const toolResults = toolUseBlocks.map(b => ({
      type: 'tool_result', tool_use_id: b.id,
      content: 'Resultados disponíveis. Responda com o JSON solicitado.'
    }));
    msgs.push({ role: 'user', content: toolResults });

    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: msgs
      })
    });
    const data2 = await res2.json();
    const tb = [...(data2.content||[])].reverse().find(b => b.type === 'text');
    finalText = tb?.text || '';
  } else {
    const tb = [...data.content].reverse().find(b => b.type === 'text');
    finalText = tb?.text || '';
  }

  const jsonMatch = finalText.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) return;

  const result = JSON.parse(jsonMatch[0]);
  const lowestNow = result.lowestPrice || Math.min(...(result.offers||[]).map(o => o.price));
  const bestOffer = result.offers?.sort((a,b) => a.price - b.price)[0];

  // Save last price
  const prevLowest = product.lastLowestPrice || Infinity;
  await updateProduct(db, product.id, { lastLowestPrice: lowestNow, lastChecked: Date.now(), lastOffers: result.offers });

  // Notify if price dropped below threshold OR dropped significantly from last check
  const droppedBelowThreshold = lowestNow <= product.alertPrice && prevLowest > product.alertPrice;
  const significantDrop = prevLowest !== Infinity && lowestNow < prevLowest * 0.97; // 3%+ drop

  if (droppedBelowThreshold || significantDrop) {
    const dropPct = prevLowest !== Infinity ? Math.round((1 - lowestNow / prevLowest) * 100) : null;
    const title = droppedBelowThreshold
      ? `🔔 ${product.name} abaixo de R$${product.alertPrice.toLocaleString('pt-BR')}!`
      : `📉 ${product.name} caiu ${dropPct}%!`;

    const body = `Menor preço: R$ ${lowestNow.toLocaleString('pt-BR')} na ${bestOffer?.store || 'loja'}`;

    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: `price-${product.id}`,
      renotify: true,
      data: { url: bestOffer?.url || 'https://www.google.com.br/search?q=' + encodeURIComponent(product.query) },
      actions: [
        { action: 'open', title: '↗ Ver oferta' },
        { action: 'dismiss', title: 'Ignorar' }
      ]
    });
  }
}

// ── Notification click ────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || './index.html';
  e.waitUntil(clients.openWindow(url));
});

// ── Simple IndexedDB helpers ──────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('PriceWatchDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}

function getAllProducts(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readonly');
    const req = tx.objectStore('products').getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = reject;
  });
}

function updateProduct(db, id, updates) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    const getReq = store.get(id);
    getReq.onsuccess = e => {
      const product = e.target.result;
      if (!product) { resolve(); return; }
      Object.assign(product, updates);
      store.put(product);
      resolve();
    };
    getReq.onerror = reject;
  });
}
