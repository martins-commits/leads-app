/* ============================================================
 * Service Worker — Prospecção WhatsApp (Elevo Leads)
 * ------------------------------------------------------------
 * Responsabilidades:
 *   1. Tornar o app instalável como PWA (Add to Home Screen)
 *   2. Mostrar notificações do sistema via showNotification()
 *      (chamado a partir da página principal via registration.showNotification)
 *   3. Escutar eventos de push (para uso futuro com push server VAPID)
 *   4. Fazer cache básico do app shell (offline-first leve)
 *
 * LIMITAÇÃO IMPORTANTE:
 *   Sem um push server (VAPID + Push Service do Android/Chrome),
 *   não é possível receber notificações com o app 100% fechado.
 *   O Service Worker eventualmente é descarregado pelo navegador.
 *   Por isso a página principal faz polling a cada 1 minuto e
 *   dispara notificações + som + vibração quando o app está aberto.
 * ============================================================ */

const CACHE_NAME = 'elevo-leads-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// Instalação: pré-cacheia os assets essenciais
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando assets essenciais');
        return cache.addAll(ASSETS_TO_CACHE).catch(err => {
          // Não falha a instalação se algum asset não estiver disponível
          console.warn('[SW] Alguns assets não puderam ser cacheados:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Ativação: limpa caches antigos
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando Service Worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: estratégia cache-first para assets do app, network-first para o resto
self.addEventListener('fetch', (event) => {
  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;
  // Ignora requisições para Supabase e CDNs externos (sempre network)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Cache hit: retorna do cache
      if (cachedResponse) return cachedResponse;
      // Senão: busca na rede e tenta cachear
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Offline e não está em cache: tenta retornar o index.html como fallback
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ============================================================
// NOTIFICAÇÕES
// ============================================================

// Recebe notificação push de um servidor (requer VAPID + subscrição)
// Por enquanto, apenas loga — futuro: integrar com FCM ou outro push service
self.addEventListener('push', (event) => {
  console.log('[SW] Push event recebido:', event);
  let data = { title: 'Prospecção WhatsApp', body: 'Você tem uma nova notificação' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  const options = {
    body: data.body,
    icon: 'icon.svg',
    badge: 'icon.svg',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'elevo-push',
    requireInteraction: false,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Clique na notificação: abre/foca o app
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notificação clicada:', event);
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já tem uma aba aberta, foca ela
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre nova aba
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Mensagem da página principal para o SW (extensibilidade futura)
self.addEventListener('message', (event) => {
  console.log('[SW] Mensagem recebida:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
