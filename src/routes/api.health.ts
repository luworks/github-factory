import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { getConfig } = await import("../server/config");
        const c = getConfig();
        const { readFile } = await import("node:fs/promises");
        const stamp = await readFile("SOURCE_SHA", "utf8").catch(() => "");
        const sourceSha = /^[a-f0-9]{40}$/.test(stamp.trim()) ? stamp.trim() : null;
        return Response.json(
          {
            app: "moonshot",
            status: "ok",
            version: "0.1.0",
            sourceSha,
            provider: c.provider,
            model: c.model,
            configured: Boolean(c.apiKey),
            githubConfigured: Boolean(c.githubToken),
            readOnly: true,
            at: new Date().toISOString(),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
