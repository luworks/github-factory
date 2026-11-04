import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/world/$owner/$repo")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { json, apiError } = await import("../server/http");
        try {
          const { loadWorld } = await import("../server/service");
          const { getCachedBlueprint } = await import("../server/ai");
          const world = await loadWorld(`${params.owner}/${params.repo}`);
          const blueprint = getCachedBlueprint(world, { allowPreviousHead: true });
          return json(blueprint ? { ...world, blueprint } : world);
        } catch (e) {
          return apiError(e);
        }
      },
      POST: async ({ params, request }) => {
        const { json, apiError, allowMutation, readJson } = await import("../server/http");
        try {
          allowMutation(request, "refresh");
          await readJson(request);
          const { loadWorld } = await import("../server/service");
          const { getCachedBlueprint } = await import("../server/ai");
          const world = await loadWorld(`${params.owner}/${params.repo}`, { refresh: true });
          const blueprint = getCachedBlueprint(world, { allowPreviousHead: true });
          return json(blueprint ? { ...world, blueprint } : world);
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
