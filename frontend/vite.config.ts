import path from "path";
import {execSync} from "child_process";
import {defineConfig, type ServerOptions} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {VitePWA} from "vite-plugin-pwa";

const gitHash = (() => {
    const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (vercelSha) return vercelSha.slice(0, 7);
    try { return execSync("git rev-parse --short HEAD").toString().trim(); }
    catch { return ""; }
})();

/**
 * `npm run dev:phone` (`vite --mode phone`) opens the dev app on a phone on the same
 * Wi-Fi (CONTRIBUTING.md). The phone can't reach the backend at `localhost`, so every
 * API call goes to `/api` on this server, which forwards it to the backend on this
 * computer. It's all one origin then, so the session cookie needs nothing special.
 */
function devServer(mode: string): ServerOptions {
    if (mode !== "phone") return {host: true};
    // A real VITE_* variable outranks the .env files, and Vite reads env after this config.
    process.env.VITE_BACKEND_URL = "/api";
    return {
        host: true,
        proxy: {
            "/api": {
                target: process.env.DEV_BACKEND_URL ?? "http://127.0.0.1:8000",
                changeOrigin: true,
                rewrite: p => p.replace(/^\/api/, ""),
            },
        },
    };
}

export default defineConfig(({mode}) => ({
    plugins: [
        react(),
        tailwindcss(),

        VitePWA({
            strategies: "injectManifest",

            srcDir: "src",
            filename: "sw.js",

            // Updates wait for the user to opt in via UpdatePrompt.tsx.
            registerType: "prompt",

            manifest: {
                name: "SprocketStats",
                short_name: "SprocketStats",
                start_url: "/",
                display: "standalone",
                background_color: "#ffffff",
                theme_color: "#ffffff",
                icons: [
                    {src: "/pwa/sprocket_logo_128.png", sizes: "128x128", type: "image/png"},
                    {src: "/pwa/sprocket_logo_192.png", sizes: "192x192", type: "image/png"},
                    {src: "/pwa/sprocket_logo_256.png", sizes: "256x256", type: "image/png"},
                    {src: "/pwa/sprocket_logo_512.png", sizes: "512x512", type: "image/png"},
                ],
            },

            injectManifest: {
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB
                // The app's code plus the images every screen shows, so it
                // looks the same offline: season art, wordmarks, logos, icons
                // (~200 KB). Not the 3,800 team icons or the big PNG/GIF
                // originals; sw.js keeps other images once they've been seen.
                globPatterns: [
                    "**/*.{js,css,html}",
                    "**/*.svg",
                    "seasons/*/expanded.avif",
                    "human_signal_*.png",
                    "pwa/*.png",
                    "favicon.ico",
                ],
            },

            injectRegister: "auto",

            // The dev SW's precache manifest gets a fresh revision on every
            // dev-server start, so with this on the update banner shows on
            // every launch. Test the SW with `vite build && vite preview`.
            devOptions: {
                enabled: false,
            },
        })
    ],

    resolve: {
        alias: {"@": path.resolve(__dirname, "./src")},
    },

    define: {
        __GIT_HASH__: JSON.stringify(gitHash),
    },

    build: {
        outDir: "dist", // make sure this matches your globDirectory
        emptyOutDir: true,
    },

    server: devServer(mode),
}));
