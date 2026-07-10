import {precacheAndRoute} from "workbox-precaching";
import {clientsClaim} from "workbox-core";
import {registerRoute} from "workbox-routing";
import {NetworkFirst} from "workbox-strategies";

const API = import.meta.env.VITE_BACKEND_URL;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
    ({request, url}) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin,
    new NetworkFirst({
        cacheName: "html-cache",
    })
);

// Web Push: the backend sends a JSON payload ({ title, body, delivery_id }) for
// every push message sent via /push. This runs even when no tab is open.
// `delivery_id` may be absent on old/legacy pushes.
self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = {title: "SprocketStats", body: event.data ? event.data.text() : ""};
    }

    const title = data.title || "SprocketStats";
    const options = {
        body: data.body || "",
        icon: "/pwa/sprocket_logo_192.png",
        badge: "/pwa/sprocket_logo_128.png",
    };

    const showNotificationPromise = self.registration.showNotification(title, options);

    // Delivery receipt for the delivery-tracking feature: best-effort report to
    // the backend that this push actually reached the device. This must never
    // hold up or break the notification itself, so it's run alongside
    // showNotification (not awaited before it) and every failure is swallowed.
    const receiptPromise = data.delivery_id
        ? self.registration.pushManager.getSubscription()
            .then((subscription) => {
                if (!subscription) return;
                return fetch(`${API}/push/delivered`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({delivery_id: data.delivery_id, endpoint: subscription.endpoint}),
                });
            })
            .catch(() => {})
        : Promise.resolve();

    event.waitUntil(Promise.all([showNotificationPromise, receiptPromise]));
});

// Clicking the notification focuses an existing tab (or opens one) on the
// dashboard -- there's no per-message link to route to anymore.
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const link = "/dashboard";

    event.waitUntil(
        self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clients) => {
            for (const client of clients) {
                if (client.url.startsWith(self.location.origin) && "focus" in client) {
                    return client.focus();
                }
            }
            return self.clients.openWindow(link);
        })
    );
});
