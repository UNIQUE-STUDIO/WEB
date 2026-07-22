const CACHE_NAME = 'uw-studio-v6';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/github-storage.js',
  './js/notifications.js',
  './manifest.json',
  './vendor/fonts/fonts.css',
  './vendor/swiper/swiper-bundle.min.css',
  './vendor/aos/aos.css',
  './vendor/fontawesome/css/all.min.css',
  './vendor/swiper/swiper-bundle.min.js',
  './vendor/aos/aos.js',
  './vendor/vanilla-tilt/vanilla-tilt.min.js',
  './vendor/chartjs/chart.umd.min.js'
];

const OFFLINE_QUEUE = 'uw-offline-queue';

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Caching static assets v5');
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[SW] Removing old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  if (event.request.destination === 'style' ||
      event.request.destination === 'script' ||
      event.request.destination === 'font' ||
      event.request.destination === 'image' ||
      url.pathname.match(/\.(css|js|woff2?|png|jpg|jpeg|gif|svg|ico|json|ttf)$/i)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() {
            return cached || new Response('Offline', { status: 503 });
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || caches.match('./');
      });
    })
  );
});

self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-leads') {
    event.waitUntil(syncOfflineLeads());
  } else if (event.tag === 'sync-tickets') {
    event.waitUntil(syncOfflineTickets());
  }
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'SYNC_NOW') {
    syncOfflineLeads().then(function() {
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SYNC_COMPLETE' });
        });
      });
    });
  }
});

function getOfflineQueue() {
  return new Promise(function(resolve) {
    if ('storage' in self) {
      self.clients.matchAll().then(function(clients) {
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'GET_OFFLINE_QUEUE' });
        }
        resolve([]);
      });
    } else {
      resolve([]);
    }
  });
}

function syncOfflineLeads() {
  return getOfflineQueue().then(function(queue) {
    if (!queue || queue.length === 0) return;
    console.log('[SW] Syncing offline leads:', queue.length);
    return Promise.all(queue.map(function(lead) {
      var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw0eEHPeS5Ad2RxlRlErM8Ffbkw0NmfDkYiUCtzj6qieUnPBe3iCpgzq-teblsDeQnN/exec';
      var formData = new FormData();
      Object.keys(lead).forEach(function(k) {
        formData.append(k, lead[k]);
      });
      return fetch(SCRIPT_URL, { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; });
    }));
  });
}

function syncOfflineTickets() {
  return Promise.resolve();
}
