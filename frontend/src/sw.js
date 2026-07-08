import {precacheAndRoute} from "workbox-precaching";
import {clientsClaim} from "workbox-core";
import {registerRoute} from "workbox-routing";
import {NetworkFirst} from "workbox-strategies";

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

// Web Push: the backend sends a JSON payload ({ title, body }) for every push
// message sent via /push. This runs even when no tab is open.
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

    event.waitUntil(self.registration.showNotification(title, options));
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
