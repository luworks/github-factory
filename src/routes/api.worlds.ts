import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/worlds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, apiError, allowMutation, readJson, HttpError } = await import("../server/http");
        try {
          allowMutation(request, "create");
          const body = await readJson(request);
          if (typeof body.repo !== "string") throw new HttpError(400, "REPO_REQUIRED", "Paste a public GitHub repository URL.");
          const { loadWorld } = await import("../server/service");
          let w = await loadWorld(body.repo);
          if (body.enrich === true) {
            const { enrichWorld } = await import("../server/ai");
            w = await enrichWorld(w);
          }
          return json(w);
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
