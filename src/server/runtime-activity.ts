import { projectEnv } from "./config";
let publicAnalyses = 0;
export const migrationHeld = () => projectEnv().MOONSHOT_WORLD_WRITES_HOLD === "1";
export function requireAnalysisOpen() {
  if (migrationHeld()) throw Object.assign(new Error("World storage migration is in progress. Cached source evidence remains available; new analysis is temporarily held."), { status: 503, code: "STORAGE_MIGRATION_HOLD" });
}
export async function publicAnalysis<T>(action: () => Promise<T>): Promise<T> {
  requireAnalysisOpen(); publicAnalyses++;
  try { return await action(); } finally { publicAnalyses--; }
}
export const activePublicAnalyses = () => publicAnalyses;
