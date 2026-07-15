import { defineConfig } from "vitest/config"

// Separate from vite.config.ts on purpose: unit tests don't need the PWA
// plugin, Tailwind, or the React refresh transform, and loading them just slows
// collection down. Add `environment: "jsdom"` here once we start testing code
// that touches the DOM / browser globals (e.g. the notification helpers).
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
})
