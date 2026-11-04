import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/LandingPage";
import { useLanguage } from "../client/use-language";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const [lang, onLangChange] = useLanguage();
  return <LandingPage lang={lang} onLangChange={onLangChange} />;
}
