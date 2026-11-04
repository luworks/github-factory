import { appPath } from "../base-path";
import type { RepositoryPreviewData } from "./contracts";

// A landing page may have many cards; at most two cache reads run at once. No retries or polling.
let active = 0;
const queue: (() => void)[] = [];
export function loadRepositoryPreview(fullName: string, signal: AbortSignal): Promise<RepositoryPreviewData> {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      active++;
      const [owner, repo] = fullName.split("/");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      void fetch(appPath(`/api/gallery-preview/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Preview unavailable");
          const data: RepositoryPreviewData = await response.json();
          if (data.fullName.toLowerCase() !== fullName.toLowerCase() || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Invalid preview");
          resolve(data);
        }).catch(reject).finally(() => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          active--;
          while (active < 2 && queue.length) queue.shift()!();
        });
    };
    if (active < 2) start(); else queue.push(start);
  });
}
