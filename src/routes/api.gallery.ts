import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/gallery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, apiError } = await import("../server/http");
        try {
          const { clientIdentity, accessConfig } = await import("../server/access");
          clientIdentity(request, accessConfig());
          const { listFeatured } = await import("../server/service");
          return json({ projects: await listFeatured() });
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
