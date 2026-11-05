import type { HistoryActionResult, HistoryService } from "./history-service";

export const HISTORY_HTTP_RUNTIME_LIFECYCLE = "NOT_WIRED" as const;
export interface HistoryHttpContext { readonly repo: string; readonly path: string; readonly publicOrigin: string }
export interface HistoryHttpAccess {
  /** authenticate must verify the gateway key and asserted IP, then debit the
   * ORIGINAL request allowance exactly once. No localhost/anonymous downgrade. */
  readonly gatewayAuthenticated: true;
  readonly requestAdmitted: true;
  readonly identity: string;
  readonly admitCollection: () => void | Promise<void>;
}
export type HistoryCleanupRetainer = (pending: Promise<unknown>) => void;
export interface HistoryHttpLifecycle {
  held(): boolean | Promise<boolean>;
  /** REQUIRED RUNTIME AUTHORITY (standalone hook exists, not wired): retain the original active-analysis
   * authority through late physical admission/fetch/body cleanup AND durable
   * persistence. act() settlement alone is not physical settlement. retain()
   * reports adapter body reads/cancellation; the existing reader's hidden late
   * cleanup is observed by the standalone history-lifecycle hook. Bootstrap
   * adoption remains separate and unimplemented. A response timeout never proves drain. */
  run<T>(work: (retain: HistoryCleanupRetainer) => Promise<T>): Promise<T>;
}
export interface HistoryHttpDependencies {
  authenticate(request: Request): HistoryHttpAccess | Promise<HistoryHttpAccess>;
  makeService?: (admission: { admitRequest: () => void; admitCollection: () => void | Promise<void> }) => Pick<HistoryService, "read" | "act"> | null | Promise<Pick<HistoryService, "read" | "act"> | null>;
  lifecycle?: HistoryHttpLifecycle;
  /** Mandatory on definitive metadata PUBLIC_ONLY: original world-cache and
   * alias authority, never immutable-history deletion or stale fallback. */
  revokePublicCapture(repo: string): void | Promise<void>;
  bodyTimeoutMs?: number;
}
class Rejection extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const reject = (code: string, status: number): never => { throw new Rejection(code, status); };
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const codes = new Set(`GATEWAY_REQUIRED GATEWAY_UNCONFIGURED CLIENT_IDENTITY_REQUIRED IP_RATE_LIMIT PUBLIC_RATE_LIMIT STORAGE_MIGRATION_HOLD ORIGIN_REJECTED JSON_REQUIRED INPUT_TOO_LARGE INVALID_JSON HISTORY_INVALID_REQUEST HISTORY_INVALID_REPOSITORY HISTORY_CACHE_MISSING HISTORY_CACHE_UNAVAILABLE HISTORY_CAPTURE_INVALID HISTORY_CURSOR_STALE HISTORY_CAPTURE_CHANGED HISTORY_CONTEXT_INVALID HISTORY_CONTEXT_DRIFT HISTORY_MEMBER_UNKNOWN HISTORY_WALK_STOPPED HISTORY_CAPACITY HISTORY_BUSY HISTORY_AUTHORITY_LOST HISTORY_READER_REJECTED HISTORY_UNIT_INVALID HISTORY_UNAVAILABLE HISTORY_HTTP_UNAVAILABLE HISTORY_BODY_TIMEOUT HISTORY_PRIVACY_UNAVAILABLE HISTORY_LIFECYCLE_UNAVAILABLE PUBLIC_ONLY GITHUB_FORBIDDEN GITHUB_RATE_LIMIT REPO_NOT_FOUND GITHUB_UNAVAILABLE GITHUB_REDIRECT GITHUB_INVALID_RESPONSE HISTORY_REQUEST_TIMEOUT HISTORY_ACTION_TIMEOUT HISTORY_CLOCK_INVALID HISTORY_ATTEMPT_CAP HISTORY_COMMIT_WINDOW_CAP HISTORY_COMMIT_INVALID HISTORY_COMMIT_RECORD_CAP HISTORY_IMMUTABLE_COMMIT_CONFLICT HISTORY_PARENTS_UNOBSERVED HISTORY_FRAME_CAP HISTORY_FRAME_NOT_VERIFIED HISTORY_TREE_IDENTITY_INVALID HISTORY_TREE_INVALID HISTORY_IMMUTABLE_TREE_CONFLICT HISTORY_WORKING_SET_CAP HISTORY_TREE_PARTIAL_INVALID HISTORY_TREE_ENTRY_CAP HISTORY_TREE_FRAME_CAP HISTORY_RESPONSE_BYTE_CAP HISTORY_ACTION_BYTE_CAP HISTORY_COOLDOWN_CLOCK_UNKNOWN history-revision-conflict history-storage-unavailable history-commit-cap history-frame-cap history-anchor-cap history-receipt-cap history-byte-cap action-already-used batch-payload-conflict`.split(" "));
function safeError(error: unknown) {
  const e = error as { code?: unknown; status?: unknown; retryAfter?: unknown };
  const code = typeof e?.code === "string" && codes.has(e.code) ? e.code : "HISTORY_UNAVAILABLE";
  const status = code === "HISTORY_UNAVAILABLE" ? 503 : typeof e?.status === "number" && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : 503;
  const message = code === "PUBLIC_ONLY" ? "Only publicly accessible repositories are available."
    : code === "STORAGE_MIGRATION_HOLD" ? "History analysis is paused for storage maintenance. Cached evidence remains available."
    : code === "HISTORY_CACHE_MISSING" ? "No cached repository capture is available."
    : code === "HISTORY_CAPTURE_CHANGED" ? "The cached capture changed. Read current history before another action; confirmed old-capture saves remain recorded."
    : status === 429 ? "The existing request or collection allowance is cooling down."
    : status < 500 ? "The history request was rejected. Read current cached history and use only its explicit controls."
    : "History is temporarily unavailable. No automatic retry or fallback was attempted.";
  const retryAfter = typeof e?.retryAfter === "number" && Number.isFinite(e.retryAfter) && e.retryAfter > 0 ? Math.max(1, Math.min(86400, Math.ceil(e.retryAfter))) : undefined;
  return { code, status, message, ...(retryAfter === undefined ? {} : { retryAfter }) };
}
function response(body: unknown, status = 200, retryAfter?: number, allow = false) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...(retryAfter ? { "retry-after": String(retryAfter) } : {}), ...(allow ? { allow: "GET, POST" } : {}) } });
}
function failure(error: unknown) { const e = safeError(error); return response({ code: e.code, error: e.message }, e.status, e.retryAfter); }
const members = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 2 && new Set(v).size === v.length && v.every(s => typeof s === "string" && /^[a-f0-9]{40}$/.test(s));
function query(url: URL): Record<string, unknown> {
  if (url.hash || url.search.length > 4096) return reject("HISTORY_INVALID_REQUEST", 400);
  const output: Record<string, unknown> = {}, selected: string[] = [];
  for (const pair of url.search.slice(1).split("&").filter((_p, i, all) => !(all.length === 1 && all[0] === ""))) {
    if (!pair || !pair.includes("=")) return reject("HISTORY_INVALID_REQUEST", 400);
    let k: string, v: string; try { const at = pair.indexOf("="); k = decodeURIComponent(pair.slice(0, at).replaceAll("+", " ")); v = decodeURIComponent(pair.slice(at + 1).replaceAll("+", " ")); } catch { return reject("HISTORY_INVALID_REQUEST", 400); }
    if (k === "member") selected.push(v);
    else if (k === "cursor" && !Object.hasOwn(output, k) && v.length > 0 && v.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) output.cursor = v;
    else if (k === "offset" && !Object.hasOwn(output, k) && /^(0|[1-9][0-9]{0,2})$/.test(v) && Number(v) <= 500) output.offset = Number(v);
    else return reject("HISTORY_INVALID_REQUEST", 400);
  }
  if (selected.length) { if (!members(selected)) return reject("HISTORY_INVALID_REQUEST", 400); output.members = selected; }
  return output;
}
/** Reject duplicate decoded top-level JSON keys instead of accepting last-wins
 * overrides. JSON.parse already established valid syntax; strings are skipped. */
function duplicateKeys(text: string) {
  const seen = new Set<string>(); let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1; while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (depth === 1 && text[next] === ":") { const name = JSON.parse(text.slice(start, i + 1)); if (seen.has(name)) return true; seen.add(name); }
    } else if (text[i] === "{" || text[i] === "[") depth++;
    else if (text[i] === "}" || text[i] === "]") depth--;
  }
  return false;
}
async function body(request: Request, timeout: number, retain: HistoryCleanupRetainer) {
  const reader = request.body?.getReader(); if (!reader) return reject("INVALID_JSON", 400);
  let expired = false, length = 0;
  const pending = <T>(p: Promise<T>) => { void p.catch(() => {}); retain(p); return p; };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, fail) => { timer = setTimeout(() => { expired = true; fail(new Rejection("HISTORY_BODY_TIMEOUT", 408)); }, timeout); });
  try {
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > 2048)) return reject("INPUT_TOO_LARGE", 413);
    const chunks: Uint8Array[] = [];
    for (;;) { const part = await Promise.race([pending(reader.read()), deadline]); if (expired) return reject("HISTORY_BODY_TIMEOUT", 408); if (part.done) break; length += part.value.byteLength; if (length > 2048) return reject("INPUT_TOO_LARGE", 413); chunks.push(part.value); }
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    let text: string, value: unknown;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); value = JSON.parse(text); } catch { return reject("INVALID_JSON", 400); }
    if (!record(value) || duplicateKeys(text) || Object.keys(value).some(k => !["action", "cursor", "members"].includes(k)) || typeof value.cursor !== "string" || !value.cursor.length || value.cursor.length > 2048 || value.action !== "walk" && value.action !== "frames" || value.action === "walk" && Object.hasOwn(value, "members") || value.action === "frames" && !members(value.members)) return reject("HISTORY_INVALID_REQUEST", 400);
    return value;
  } finally {
    clearTimeout(timer);
    // Cancellation can remain pending after the response deadline. Hand it to
    // the injected original authority; never await it or pretend it has drained.
    try { const cancelled = reader.cancel(); void cancelled.catch(() => {}); retain(cancelled); } catch { reject("HISTORY_LIFECYCLE_UNAVAILABLE", 503); }
  }
}
function actionPayload(result: HistoryActionResult) {
  const error = result.error ? safeError(result.error) : null;
  const observed = result.observed ? { ...result.observed, coverage: { ...result.observed.coverage, errors: result.observed.coverage.errors.map(e => ({ ...safeError(e), stage: ["request", "admission", "cursor", "metadata", "commit", "tree", "finalize"].includes(e.stage) ? e.stage : "unknown" })) } } : null;
  return { status: result.status, capture: result.capture, token: error ? null : result.token, observed, persisted: result.persisted, error };
}

/** Injected factory only. There is no route, runtime instance, environment/key
 * reader, default access, active counter or runtime lifecycle registration. */
export function createHistoryHttp(deps: HistoryHttpDependencies) {
  const timeout = deps.bodyTimeoutMs ?? 5000;
  return async (request: Request, context: HistoryHttpContext): Promise<Response> => {
    let admitted = false;
    try {
      const access = await deps.authenticate(request);
      if (!access || access.gatewayAuthenticated !== true || access.requestAdmitted !== true || !/^[a-f0-9]{64}$/.test(access.identity) || typeof access.admitCollection !== "function") return reject("GATEWAY_REQUIRED", 403);
      admitted = true;
      const guard = () => { if (!admitted) return reject("HISTORY_AUTHORITY_LOST", 503); };
      if (!context || typeof context.repo !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/.test(context.repo) || [".", ".."].includes(context.repo.split("/")[1]!) || typeof context.path !== "string" || !context.path.startsWith("/") || /[?#\\]/.test(context.path)) return reject("HISTORY_INVALID_REQUEST", 400);
      const url = new URL(request.url);
      if (url.pathname !== context.path || url.hash) return reject("HISTORY_INVALID_REQUEST", 400);
      if (request.method !== "GET" && request.method !== "POST") return response({ code: "METHOD_NOT_ALLOWED", error: "Use GET or explicit POST for history." }, 405, undefined, true);
      let origin: URL; try { origin = new URL(context.publicOrigin); } catch { return reject("GATEWAY_UNCONFIGURED", 503); }
      if (origin.origin !== context.publicOrigin || origin.protocol !== "https:") return reject("GATEWAY_UNCONFIGURED", 503);
      const service = async () => { const value = await deps.makeService?.({ admitRequest: guard, admitCollection: access.admitCollection }); if (!value) return reject("HISTORY_HTTP_UNAVAILABLE", 503); return value; };
      if (request.method === "GET") { const controls = query(url); return response(await (await service()).read(context.repo, controls)); }
      if (url.search) return reject("HISTORY_INVALID_REQUEST", 400);
      if (request.headers.get("origin") !== context.publicOrigin || ![null, "same-origin", "same-site", "none"].includes(request.headers.get("sec-fetch-site"))) return reject("ORIGIN_REJECTED", 403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return reject("JSON_REQUIRED", 415);
      if (!deps.lifecycle || typeof deps.lifecycle.run !== "function" || typeof deps.lifecycle.held !== "function") return reject("HISTORY_LIFECYCLE_UNAVAILABLE", 503);
      if (await deps.lifecycle.held()) return reject("STORAGE_MIGRATION_HOLD", 503);
      if (typeof deps.revokePublicCapture !== "function") return reject("HISTORY_PRIVACY_UNAVAILABLE", 503);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 5000) return reject("HISTORY_HTTP_UNAVAILABLE", 503);
      let started = false, settled = false, succeeded = false, open = true;
      let completed: HistoryActionResult | undefined, privateResponse: Response | undefined;
      let result: HistoryActionResult;
      try { result = await deps.lifecycle.run(async retain => {
        if (!open || started || typeof retain !== "function") return reject("HISTORY_LIFECYCLE_UNAVAILABLE", 503);
        started = true;
        try {
          const input = await body(request, timeout, retain); if (!open) return reject("HISTORY_LIFECYCLE_UNAVAILABLE", 503);
          completed = await (await service()).act(context.repo, input);
          if (completed.error?.code === "PUBLIC_ONLY") {
            if (!completed.observed?.coverage.errors.some(e => e.code === "PUBLIC_ONLY" && e.status === 403 && e.stage === "metadata")) return reject("HISTORY_PRIVACY_UNAVAILABLE", 503);
            // Revocation is part of the explicit action, inside the same
            // injected authority, and must settle before any response/exit.
            try { if (typeof deps.revokePublicCapture !== "function") throw new Error(); await deps.revokePublicCapture(context.repo); }
            catch { return reject("HISTORY_PRIVACY_UNAVAILABLE", 503); }
            privateResponse = failure(new Rejection("PUBLIC_ONLY", 403));
          }
          succeeded = true; return completed;
        }
        finally { settled = true; }
      }); } finally { open = false; }
      if (!started || !settled || !succeeded || result !== completed) return reject("HISTORY_LIFECYCLE_UNAVAILABLE", 503);
      if (privateResponse) return privateResponse;
      const payload = actionPayload(result); return response(payload, payload.error?.status ?? 200, payload.error?.retryAfter);
    } catch (error) { return failure(error); }
    finally { admitted = false; }
  };
}
