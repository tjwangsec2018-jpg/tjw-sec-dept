/* QuorumSeal Firebase Cloud Messaging Service Worker */
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'QuorumSeal Resolution Alert', body: event.data.text() } };
  }
  const title = payload.notification?.title || 'QuorumSeal — Action Required';
  const body = payload.notification?.body || 'A corporate resolution requires your signature.';
  const pendingCount = Number(payload.data?.pendingCount || 1);

  const tasks = [
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.data?.resolutionId || 'quorumseal-resolution',
      data: payload.data || {},
    }),
  ];

  if (self.navigator && 'setAppBadge' in self.navigator) {
    tasks.push(self.navigator.setAppBadge(pendingCount).catch(() => {}));
  }

  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
