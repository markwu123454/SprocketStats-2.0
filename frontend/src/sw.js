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
