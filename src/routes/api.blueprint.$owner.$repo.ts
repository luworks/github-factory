import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/blueprint/$owner/$repo")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { json, apiError, allowMutation, readJson, actionRequest } = await import("../server/http");
        try {
          const { accessRequest } = await import("../server/access");
          const access = accessRequest(request);
          allowMutation(request, "blueprint");
          actionRequest(await readJson(request), "blueprint");
          const { loadWorld } = await import("../server/service");
          const { enrichWorld } = await import("../server/ai");
          const world = await loadWorld(`${params.owner}/${params.repo}`, { admit: access.admitCollection });
          access.admitAi();
          return json(await enrichWorld(world));
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
