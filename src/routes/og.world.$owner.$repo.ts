import { createFileRoute } from "@tanstack/react-router";
const serve = async ({ request, params }: { request: Request; params: { owner: string; repo: string } }) =>
  (await import("../server/og-routes")).serveWorldImage(request, params.owner, params.repo);
export const Route = createFileRoute("/og/world/$owner/$repo")({
  server: { handlers: { GET: serve, HEAD: serve } },
});
