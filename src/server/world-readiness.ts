import type { WorldSnapshot } from "../contracts";
/** Navigation requires a renderable public capture, not editorial metadata or
 * merely a row with a license. Historical expiry remains explicitly stale. */
export function isRenderableWorld(world: WorldSnapshot, now = Date.now()) {
  return world.schemaVersion === 1 && world.source === "github" &&
    /^[a-f0-9]{40}$/i.test(world.headSha) && Number.isFinite(Date.parse(world.collectedAt)) && Date.parse(world.collectedAt) <= now &&
    world.coverage?.tree !== "unavailable" && Array.isArray(world.nodes) && world.nodes.length > 0 && Array.isArray(world.edges);
}
