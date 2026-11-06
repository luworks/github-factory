import { createFileRoute } from "@tanstack/react-router";
import { AtlasPage } from "../atlas/AtlasPage";
export const Route = createFileRoute("/atlas")({validateSearch:(search:Record<string,unknown>)=>search,component:AtlasPage});
