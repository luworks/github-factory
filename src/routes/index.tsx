import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/LandingPage";
import { homeMeta } from "../og/meta";
import { publicOrigin } from "../og/origin";
export const Route = createFileRoute("/")({ head: () => ({ meta: homeMeta(publicOrigin()) }), component: Home });
function Home() {
  return <LandingPage />;
}
