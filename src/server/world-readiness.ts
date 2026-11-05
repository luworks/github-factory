import type { WorldSnapshot } from "../contracts";
import { cachedWorldReady } from "../evidence/captured";
/** Same positive shape gate for catalog navigation and cache-only exploration. */
export function isRenderableWorld(world: WorldSnapshot, now = Date.now()) { return cachedWorldReady(world, now); }
