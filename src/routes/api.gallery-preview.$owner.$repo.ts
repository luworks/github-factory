import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/gallery-preview/$owner/$repo")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { json, apiError } = await import("../server/http");
        try {
          const { clientIdentity, accessConfig } = await import("../server/access");
          clientIdentity(request, accessConfig());
          const { getCachedWorld } = await import("../server/service");
          const { readRepositoryPreview } = await import("../server/gallery-preview");
          return json(readRepositoryPreview(`${params.owner}/${params.repo}`, getCachedWorld));
        } catch (error) {
          return apiError(error);
        }
      },
    },
  },
});
