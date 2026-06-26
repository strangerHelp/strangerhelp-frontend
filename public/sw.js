// Service Worker for Push Notifications
self.addEventListener('push', function(event) {
  // Since we send empty pushes (no encrypted payload), fetch the latest notification
  event.waitUntil(
    fetch('/api/notifications?unread=true')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var notif = data.notifications && data.notifications[0];
        if (notif) {
          return self.registration.showNotification(notif.title || 'StrangerHelp', {
            body: notif.message || 'You have a new notification',
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            data: { url: notif.link || '/dashboard' },
            vibrate: [200, 100, 200],
            tag: notif.id,
          });
        }
        return self.registration.showNotification('StrangerHelp', {
          body: 'You have a new notification',
          icon: '/favicon.svg',
          data: { url: '/dashboard' },
        });
      })
      .catch(function() {
        return self.registration.showNotification('StrangerHelp', {
          body: 'You have a new notification',
          icon: '/favicon.svg',
          data: { url: '/dashboard' },
        });
      })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.includes(url) && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
