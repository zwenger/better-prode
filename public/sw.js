/**
 * Service Worker — Web Push handler for Better Prode reminders.
 *
 * Push payload shape (matches WebPushSender in push-subscription.ts):
 *   { title: string; body: string; matchId: string }
 *
 * The matchId is used to build a deep link to the matches page.
 * Falls back gracefully when the payload is missing or plain text.
 */

const DEFAULT_TITLE = "Better Prode";
const MATCHES_URL = "/matches";

self.addEventListener("push", (event) => {
  let title = DEFAULT_TITLE;
  let body = "Recordatorio de partido";
  let url = MATCHES_URL;

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || DEFAULT_TITLE;
      body = payload.body || body;
      // matchId is used to deep-link; build the URL from it when present
      if (payload.matchId) {
        url = `/matches/${payload.matchId}`;
      } else if (payload.url) {
        // Forward-compat: accept an explicit url field if ever added
        url = payload.url;
      }
    } catch {
      // Plain-text payload — treat it as the body
      try {
        body = event.data.text();
      } catch {
        // Nothing useful — keep defaults
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/logo192.png",
      badge: "/logo192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || MATCHES_URL;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an already-open window/tab at the same origin if one exists
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client.navigate(targetUrl).then((c) => c?.focus());
          }
        }
        // No open window — open a new one
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
