import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { appendFileSync, mkdirSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/**
 * Diagnóstico de desempenho (só `vite dev`):
 *  - POST /__perf          → grava uma linha JSON em .perf/perf.jsonl
 *  - GET  /__perf/cmd?...  → repassa o comando ao app pelo canal de HMR
 */
function perfBridge(): Plugin {
  return {
    name: "perf-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (req.method === "POST" && url === "/__perf") {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            mkdirSync(".perf", { recursive: true });
            appendFileSync(".perf/perf.jsonl", body.replace(/\n/g, " ") + "\n");
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        if (url.startsWith("/__perf/cmd")) {
          const params = new URL(url, "http://localhost").searchParams;
          server.ws.send({ type: "custom", event: "perf:cmd", data: Object.fromEntries(params) });
          res.end("ok");
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), perfBridge()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
