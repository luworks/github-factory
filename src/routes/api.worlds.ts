import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/worlds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, apiError, allowMutation, readJson, repositoryRequest } = await import("../server/http");
        try {
          const { accessRequest } = await import("../server/access");
          const access = accessRequest(request);
          allowMutation(request, "create");
          const body = await readJson(request);
          const repo = repositoryRequest(body);
          const { loadWorld } = await import("../server/service");
          let w = await loadWorld(repo, { admit: access.admitCollection });
          if (body.enrich === true) {
            const { publicAnalysis, requireAnalysisOpen } = await import("../server/runtime-activity");
            requireAnalysisOpen();
            access.admitAi();
            const { enrichWorld } = await import("../server/ai");
            w = await publicAnalysis(() => enrichWorld(w));
          }
          return json(w);
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
