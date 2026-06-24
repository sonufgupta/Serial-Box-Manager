const CACHE_NAME = 'serial-manager-cache-v14';
const OFFLINE_FALLBACK = 'offline.html';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=14',
  './app.js?v=14',
  './manifest.json',
  './offline.html'
];

// Offline caching logic during installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Cache activation & old version cleanup
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercept fetch requests
self.addEventListener('fetch', (event) => {
  // Navigation request fallback logic (opens offline.html if disconnected)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(OFFLINE_FALLBACK);
      })
    );
  } else {
    // Standard asset caching (cache first, then network fallback)
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((networkResponse) => {
          // Cache newly requested assets dynamically
          if (networkResponse.status === 200 && event.request.method === 'GET') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Fallback if resource fetch fails (e.g. network down)
          return new Response('Offline content unavailable', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
  }
});

// Background Sync Listener
self.addEventListener('sync', (event) => {
  console.log('Background sync activated:', event.tag);
  // Firebase SDK handles offline writes dynamically, but we keep this hook for OS feature compliance
});

// Push Notification Listener
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let title = 'Serial Box Manager';
  let options = {
    body: 'Notification from Serial Box Manager',
    icon: 'icons/icon-192x192.png',
    badge: 'icons/icon-192x192.png'
  };

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      options = { ...options, ...data.options };
    } catch (e) {
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Push Notification click action
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});

// Message listener for skipWaiting command
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
