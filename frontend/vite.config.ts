import path from "path";
import {execSync} from "child_process";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {VitePWA} from "vite-plugin-pwa";

const gitHash = (() => {
    const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (vercelSha) return vercelSha.slice(0, 7);
    try { return execSync("git rev-parse --short HEAD").toString().trim(); }
    catch { return ""; }
})();

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),

        VitePWA({
            strategies: "injectManifest",

            srcDir: "src",
            filename: "sw.js",

            registerType: "autoUpdate",

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
            },

            injectRegister: "auto",

            devOptions: {
                enabled: true,
                type: "module",
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

    server: {
        host: true
    },
});
