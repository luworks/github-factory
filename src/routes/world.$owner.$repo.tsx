import { createFileRoute } from "@tanstack/react-router";
import { ExplorerPage } from "../components/ExplorerPage";
export const Route = createFileRoute("/world/$owner/$repo")({ component: WorldPage });
function WorldPage() {
  const { owner, repo } = Route.useParams();
  return <ExplorerPage key={`${owner}/${repo}`} owner={owner} repo={repo} />;
}
