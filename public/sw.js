// Service Worker for Push Notifications
self.addEventListener('push', function(event) {
  var options = {
    body: 'You have a new notification',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: '/dashboard' },
    vibrate: [200, 100, 200],
  };
  var title = 'StrangerHelp';

  // Try to fetch latest notification (only works if device has internet)
  event.waitUntil(
    fetch('/api/notifications?unread=true')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var n = data.notifications && data.notifications[0];
        if (n) {
          title = n.title || title;
          options.body = n.message || options.body;
          options.data = { url: n.link || '/dashboard' };
          options.tag = n.id;
        }
        return self.registration.showNotification(title, options);
      })
      .catch(function() {
        // Offline or fetch failed — still show notification with default text
        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Focus existing tab if open
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      return clients.openWindow(url);
    })
  );
});
