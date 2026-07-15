const CACHE_NAME = 'uw-studio-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css',
  'https://unpkg.com/aos@2.3.1/dist/aos.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js',
  'https://unpkg.com/aos@2.3.1/dist/aos.js',
  'https://cdn.jsdelivr.net/npm/vanilla-tilt@1.8.0/dist/vanilla-tilt.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

const DYNAMIC_CACHE = 'uw-studio-dynamic-v2';
const OFFLINE_QUEUE = 'uw-offline-queue';

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Caching static assets');
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
          return key !== CACHE_NAME && key !== DYNAMIC_CACHE;
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

  if (url.pathname.indexOf('/api/') === 0 && event.request.method === 'POST') {
    return;
  }

  var isStatic = event.request.destination === 'style' ||
                  event.request.destination === 'script' ||
                  event.request.destination === 'font' ||
                  event.request.destination === 'image' ||
                  url.pathname.match(/\.(css|js|woff2?|png|jpg|jpeg|gif|svg|ico|json)$/i) ||
                  url.hostname === 'cdn.jsdelivr.net' ||
                  url.hostname === 'unpkg.com' ||
                  url.hostname === 'fonts.googleapis.com' ||
                  url.hostname === 'fonts.gstatic.com' ||
                  url.hostname === 'cdnjs.cloudflare.com' ||
                  url.hostname === 'images.unsplash.com' ||
                  url.hostname === 'play-lh.googleusercontent.com';

  if (event.request.method !== 'GET') {
    return;
  }

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) {
          fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, response.clone());
              });
            }
          }).catch(function() {});
          return cached;
        }
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {
          return caches.match('/');
        });
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('/');
        });
      })
    );
  }
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
