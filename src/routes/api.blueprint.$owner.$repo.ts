import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/blueprint/$owner/$repo")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { json, apiError, allowMutation, readJson } = await import("../server/http");
        try {
          allowMutation(request, "blueprint");
          await readJson(request);
          const { loadWorld } = await import("../server/service");
          const { enrichWorld } = await import("../server/ai");
          return json(await enrichWorld(await loadWorld(`${params.owner}/${params.repo}`)));
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
