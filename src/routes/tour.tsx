import { createFileRoute } from "@tanstack/react-router";
import { TourPage } from "../tour/TourPage";
export const Route = createFileRoute("/tour")({ validateSearch: (search: Record<string, unknown>) => search, component: Tour });
function Tour() {
  const search = Route.useSearch();
  return <TourPage record={String(search.record) === "1"} />;
}
