import { createFileRoute } from "@tanstack/react-router";
const serve = async ({ request }: { request: Request }) => (await import("../server/og-routes")).serveHomeImage(request);
export const Route = createFileRoute("/og/home.png")({
  server: { handlers: { GET: serve, HEAD: serve } },
});
