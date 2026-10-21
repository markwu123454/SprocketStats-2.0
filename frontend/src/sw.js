import {cleanupOutdatedCaches, precacheAndRoute} from "workbox-precaching";
import {clientsClaim} from "workbox-core";
import {registerRoute} from "workbox-routing";
import {NetworkFirst} from "workbox-strategies";

const API = import.meta.env.VITE_BACKEND_URL;

// A new build sits in "waiting" until the user taps "Reload" in UpdatePrompt,
// which posts SKIP_WAITING here; we never yank a page mid-session (that could
// wipe an unsaved scouting form). If they ignore it, it still activates on its
// own once every old client is closed. clientsClaim() lets the new worker take
// over the reloaded page right away.
self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
clientsClaim();

// Drop precaches left behind by older workbox versions.
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
    ({request, url}) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin,
    new NetworkFirst({
        cacheName: "html-cache",
    })
);

// Web Push: the backend sends a JSON payload ({ title, body, delivery_id?, url?,
// tag? }). This runs even when no tab is open. `delivery_id` is only present on
// Control Panel sends (automated ones like task/meeting/event reminders aren't
// delivery-tracked); `url` is the in-app path a tap should open; `tag` makes a
// newer push about the same thing replace the older one instead of stacking.
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
        data: {url: data.url},
    };
    if (data.tag) {
        options.tag = data.tag;
        // Still buzz when replacing an earlier notification with the same tag.
        options.renotify = true;
    }

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

// Only ever route to an in-app path (never "//host" or an absolute URL).
function notificationPath(data) {
    const url = data && data.url;
    return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/dashboard";
}

// Clicking the notification focuses an existing tab and asks it to route to
// the push's path in-app (see onNotificationNavigate in lib/push.ts) -- a
// client-side route change rather than client.navigate(), which would reload
// the page. With no tab open, opens one on that path.
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const path = notificationPath(event.notification.data);

    event.waitUntil(
        self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clients) => {
            for (const client of clients) {
                if (client.url.startsWith(self.location.origin) && "focus" in client) {
                    client.postMessage({type: "NOTIFICATION_NAVIGATE", url: path});
                    return client.focus();
                }
            }
            return self.clients.openWindow(path);
        })
    );
});

// Same decoding as urlBase64ToUint8Array in lib/push.ts (the worker is built
// separately and doesn't import app modules).
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from([...atob(base64)].map((c) => c.charCodeAt(0)));
}

// The push service rotated or expired this device's subscription. Re-subscribe
// (if the browser hasn't already handed us the new one) and register it with
// the backend, so pushes keep arriving without the user opening the app. The
// old endpoint needs no cleanup call: the backend prunes it on the next send
// when the push service answers 404/410. Best-effort: if this fails (e.g. the
// session cookie expired), the app's load-time re-sync (syncPushSubscription)
// registers the subscription the next time it's opened.
self.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil((async () => {
        let subscription = event.newSubscription;
        if (!subscription) {
            let applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
            if (!applicationServerKey) {
                const res = await fetch(`${API}/push/public-key`, {credentials: "include"});
                if (!res.ok) return;
                const {public_key: publicKey} = await res.json();
                if (!publicKey) return;
                applicationServerKey = urlBase64ToUint8Array(publicKey);
            }
            subscription = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey});
        }
        const json = subscription.toJSON();
        await fetch(`${API}/push/subscribe`, {
            method: "POST",
            credentials: "include",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({endpoint: json.endpoint, keys: json.keys}),
        });
    })().catch(() => {}));
});
