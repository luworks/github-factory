import { createFileRoute } from "@tanstack/react-router";
import { appPath } from "../base-path";

export const Route = createFileRoute("/api/history/$owner/$repo")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { handleHistoryRequest } = await import("../server/history-runtime");
        return handleHistoryRequest(request, { repo: `${params.owner}/${params.repo}`.toLowerCase(), path: appPath(`/api/history/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`) });
      },
      POST: async ({ params, request }) => {
        const { handleHistoryRequest } = await import("../server/history-runtime");
        return handleHistoryRequest(request, { repo: `${params.owner}/${params.repo}`.toLowerCase(), path: appPath(`/api/history/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}`) });
      },
    },
  },
});
