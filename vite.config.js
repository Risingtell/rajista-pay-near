import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
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
      },
    },
  },
});
