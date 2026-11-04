import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
const base = process.env.MOONSHOT_BASE_PATH || "/github-factory/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error("MOONSHOT_BASE_PATH must be a slash-delimited absolute path with a trailing slash.");
export default defineConfig({
  base,
  resolve: { tsconfigPaths: true },
  plugins: [
    nitro({
      baseURL: base,
      rollupConfig: { external: ["bun:sqlite"] },
      plugins: [fileURLToPath(new URL("./src/server/request-timeout.ts", import.meta.url))],
    }),
    tanstackStart({
      router: { basepath: base, routeTreeFileHeader: ["/* eslint-disable */"] },
    }),
    viteReact(),
  ],
});
