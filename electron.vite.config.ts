import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: path.join(__dirname, "electron/main.ts"),
      },
      rollupOptions: {
        external: ["uiohook-napi"],
        output: {
          entryFileNames: "index.js",
        },
      },
      outDir: "dist-electron/main",
    },
  },
  preload: {
    build: {
      lib: {
        entry: path.join(__dirname, "electron/preload.ts"),
      },
      rollupOptions: {
        output: {
          // Preload runs as CommonJS in Electron's sandboxed context.
          // Build as CJS so Electron can execute it reliably.
          format: "cjs",
          exports: "named",
          entryFileNames: "preload.cjs",
        },
      },
      outDir: "dist-electron/preload",
    },
  },
  renderer: {
    plugins: [react()],
    root: __dirname,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(__dirname, "index.html"),
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "::",
      port: 8080,
    },
  },
});

