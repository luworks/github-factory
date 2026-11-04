import { createFileRoute } from "@tanstack/react-router";
import { ExplorerPage } from "../components/ExplorerPage";
import { useLanguage } from "../client/use-language";
export const Route = createFileRoute("/world/$owner/$repo")({ component: WorldPage });
function WorldPage() {
  const { owner, repo } = Route.useParams();
  const [lang, onLangChange] = useLanguage();
  return <ExplorerPage key={`${owner}/${repo}`} owner={owner} repo={repo} lang={lang} onLangChange={onLangChange} />;
}
