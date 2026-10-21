// Mirrio — service worker (PWA).
// Stratégie volontairement prudente : les données (Supabase, /api/*) ne sont
// JAMAIS mises en cache — un agenda ou une facture périmés seraient pires
// qu'un message « hors connexion ». On ne met en cache que la coquille
// statique (pages, styles, scripts, icônes) pour que l'app s'ouvre vite et
// affiche une page claire sans réseau.
const VERSION = 'cadence-v5';
const COQUILLE = ['/offline.html', '/chrome.css', '/theme.js', '/pwa.js', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(noms => Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== location.origin) return;   // Supabase, CDN, polices : réseau seul
  if(url.pathname.startsWith('/api/')) return;                          // données : réseau seul

  // Pages : réseau d'abord (toujours à jour), repli sur le cache puis sur la page hors-ligne.
  if(req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(r => {
        const copie = r.clone();
        if(r.ok) caches.open(VERSION).then(c => c.put(req, copie));
        return r;
      }).catch(() => caches.match(req).then(r => r || caches.match('/offline.html')))
    );
    return;
  }

  // Ressources statiques : cache d'abord, rafraîchi en arrière-plan.
  e.respondWith(
    caches.match(req).then(enCache => {
      const reseau = fetch(req).then(r => {
        if(r.ok) caches.open(VERSION).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => enCache);
      return enCache || reseau;
    })
  );
});
