import type { WorldSnapshot } from "../contracts";
import { cachedWorldReady } from "../evidence/captured";
import { WorldStorageError } from "./world-storage";
import { HttpError } from "./http";
/** No ambiguous intent can downgrade cache-only navigation to collection. */
export function worldReadMode(url: string): "cached" | "legacy" {
  const query = new URL(url).searchParams;
  if (!query.has("mode")) return "legacy";
  if (query.getAll("mode").length !== 1 || query.get("mode") !== "cached" || [...query.keys()].some(k => k !== "mode"))
    throw new HttpError(400,"INVALID_REQUEST","Cached reads accept exactly one mode=cached parameter and no other query fields.");
  return "cached";
}
export async function readCachedWorld(input: string, read: (key:string) => Promise<WorldSnapshot|null>, now=Date.now()) {
  let world:WorldSnapshot|null;
  try { world = await read(input); } catch(error) {
    if ((error as {status?:number}).status === 400) throw error;
    throw new WorldStorageError();
  }
  if (!world) throw new HttpError(404,"CACHE_MISS","Not collected. No cached world is available; no collection was requested.");
  if (!cachedWorldReady(world,now)) throw new HttpError(503,"WORLD_STORAGE_UNAVAILABLE","The cached capture cannot be verified for exploration.");
  return world;
}
