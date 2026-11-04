import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/budget")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, apiError } = await import("../server/http");
        try {
          const { clientIdentity, accessConfig } = await import("../server/access");
          clientIdentity(request, accessConfig());
          const { getBudgetStatus } = await import("../server/ai");
          return json(getBudgetStatus());
        } catch (e) {
          return apiError(e);
        }
      },
    },
  },
});
