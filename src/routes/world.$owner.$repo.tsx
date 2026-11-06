import { createFileRoute } from "@tanstack/react-router";
import { ExplorerPage } from "../components/ExplorerPage";
export const Route = createFileRoute("/world/$owner/$repo")({ validateSearch: (search: Record<string, unknown>) => search, component: WorldPage });
function WorldPage() {
  const { owner, repo } = Route.useParams();
  const search = Route.useSearch();
  const readMode = search.mode === undefined ? "legacy" : search.mode === "cached" ? "cached" : "invalid";
  return <ExplorerPage key={`${owner}/${repo}`} owner={owner} repo={repo} readMode={readMode} />;
}
