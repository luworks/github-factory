import { createIsomorphicFn } from "@tanstack/react-start";
import { serverPublicOrigin } from "../server/public-origin";

/** Server: configured MOONSHOT_PUBLIC_ORIGIN (never the Host header).
 * Client: the page's own origin, used only after hydration. */
export const publicOrigin = createIsomorphicFn()
  .server(() => serverPublicOrigin())
  .client(() => window.location.origin);
