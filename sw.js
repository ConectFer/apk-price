const CACHE='pw-v3';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./index.html','./manifest.json'])));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim());});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
self.addEventListener('message',e=>{
  if(e.data?.type==='SHOW_NOTIFICATION'){
    self.registration.showNotification(e.data.title,{body:e.data.body,icon:'./icon-192.png',tag:e.data.tag,data:{url:e.data.url},actions:[{action:'open',title:'↗ Ver oferta'}]});
  }
});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=e.notification.data?.url||'./index.html';e.waitUntil(clients.openWindow(url));});
