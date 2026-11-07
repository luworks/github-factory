import { normalizeOrigin } from "../og/meta";
import { projectEnv } from "./config";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Absolute public origin for share links. Only server configuration counts:
 * MOONSHOT_PUBLIC_ORIGIN when it is https (or http on loopback), otherwise the
 * local default. Host and forwarded headers are never consulted. */
export function resolvePublicOrigin(env: Record<string, string | undefined>) {
  const configured = normalizeOrigin(env.MOONSHOT_PUBLIC_ORIGIN);
  if (configured && (configured.startsWith("https://") || LOOPBACK.has(new URL(configured).hostname))) return configured;
  const port = Number(env.PORT);
  return `http://localhost:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000}`;
}
/** True only when the operator configured a real public origin. */
export const hasConfiguredOrigin = (env: Record<string, string | undefined>) => resolvePublicOrigin(env) === normalizeOrigin(env.MOONSHOT_PUBLIC_ORIGIN);

let cached: string | undefined;
export const serverPublicOrigin = () => (cached ??= resolvePublicOrigin(projectEnv()));
