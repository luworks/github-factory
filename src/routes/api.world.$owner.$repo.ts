import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/world/$owner/$repo")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { json, apiError } = await import("../server/http");
        try {
          const { worldReadMode, readCachedWorld } = await import("../server/cached-world");
          const mode = worldReadMode(request.url);
          if (mode === "cached") {
            const { clientIdentity, accessConfig } = await import("../server/access");
            clientIdentity(request, accessConfig());
            const { getCachedWorld } = await import("../server/service");
            return json(await readCachedWorld(`${params.owner}/${params.repo}`, getCachedWorld));
          }
          const { accessRequest } = await import("../server/access");
          const access = accessRequest(request);
          const { loadWorld } = await import("../server/service");
          const { getCachedBlueprint } = await import("../server/ai");
          const world = await loadWorld(`${params.owner}/${params.repo}`, { admit: access.admitCollection });
          const blueprint = getCachedBlueprint(world, { allowPreviousHead: true });
          return json(blueprint ? { ...world, blueprint } : world);
        } catch (e) {
          return apiError(e);
        }
      },
      POST: async ({ params, request }) => {
        const { json, apiError, allowMutation, readJson, actionRequest } = await import("../server/http");
        try {
          const { accessRequest } = await import("../server/access");
          const access = accessRequest(request);
          allowMutation(request, "refresh");
          actionRequest(await readJson(request), "refresh");
          const { loadWorld } = await import("../server/service");
          const { getCachedBlueprint } = await import("../server/ai");
          const world = await loadWorld(`${params.owner}/${params.repo}`, { refresh: true, admit: access.admitCollection });
          const blueprint = getCachedBlueprint(world, { allowPreviousHead: true });
          return json(blueprint ? { ...world, blueprint } : world);
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
