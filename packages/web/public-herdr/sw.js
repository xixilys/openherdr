// Keep terminal data and credentials on the network. Installing this worker
// supplies the PWA lifecycle without caching authenticated requests or HTML.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
