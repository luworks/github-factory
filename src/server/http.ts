import { getConfig } from "./config";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
export function apiError(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string; retryAfter?: number };
  const status = Number(e?.status);
  const safe = Number.isInteger(status) && status >= 400 && status < 500;
  const response = json(
    {
      error: safe ? e.message : "The repository service is temporarily unavailable. Please try again.",
      code: safe ? (e.code ?? "REQUEST_REJECTED") : "SERVICE_UNAVAILABLE",
    },
    safe ? status : 503,
  );
  if (safe && e.retryAfter && Number.isFinite(e.retryAfter)) response.headers.set("retry-after", String(Math.ceil(e.retryAfter)));
  return response;
}
const hits = new Map<string, number[]>();
export function allowMutation(request: Request, bucket: string) {
  const origin = request.headers.get("origin");
  // A trusted gateway changes the upstream host. Only an explicitly configured
  // canonical origin may override it; forwarded headers never grant authority.
  const expectedOrigin = getConfig().publicOrigin || new URL(request.url).origin;
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "ORIGIN_REJECTED", "This operation must start from Moonshot.");
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "JSON_REQUIRED", "Send this request as JSON.");
  const now = Date.now(),
    recent = (hits.get(bucket) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 8) throw new HttpError(429, "SLOW_DOWN", "A few worlds are already being mapped. Please try again in a minute.");
  hits.set(bucket, [...recent, now]);
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 2048)
    throw new HttpError(413, "INPUT_TOO_LARGE", "The repository input is too long.");
  const reader = request.body?.getReader();
  let text = "",
    length = 0;
  if (reader) {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) {
        await reader.cancel();
        throw new HttpError(413, "INPUT_TOO_LARGE", "The repository input is too long.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Please send a valid repository request.");
  }
}
