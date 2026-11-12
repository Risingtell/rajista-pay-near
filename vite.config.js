import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  root: "app",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve("app/index.html"),
        shop: resolve("app/shop.html"),
        pay: resolve("app/pay.html"),
        // The one-time contract-account page is only in local builds, never on the public site.
        ...(mode === "test" ? { admin: resolve("app/admin.html") } : {}),
      },
    },
  },
}));
