import { migrationHeld, publicAnalysis } from "./runtime-activity";
import { observeHistoryReaderSettlement } from "./history-github";
import type { HistoryCleanupRetainer, HistoryHttpLifecycle } from "./history-http";

const invalid = () => Object.assign(new Error("The original history analysis lifetime could not be established."), { code: "HISTORY_LIFECYCLE_UNAVAILABLE", status: 503 });

/** Concrete original-counter hook, NOT WIRED into any route/runtime. The caller
 * must inject the SAME original quota object used by its service and reader.
 * No new authoritative counter, quota, key, ledger or polling loop is created.
 * Physical settlement here is local promise settlement, never proof of remote
 * processing cancellation, database rollback or a production drain/retirement. */
export function createHistoryLifecycle(authority: object): HistoryHttpLifecycle {
  if (!authority || (typeof authority !== "object" && typeof authority !== "function") || typeof (authority as { take?: unknown }).take !== "function") throw invalid();
  return {
    held: migrationHeld,
    run<T>(work: (retain: HistoryCleanupRetainer) => Promise<T>): Promise<T> {
      let publish!: (value: T | PromiseLike<T>) => void, fail!: (error: unknown) => void;
      const response = new Promise<T>((resolve, reject) => { publish = resolve; fail = reject; });
      let value: T, error: unknown, failed = false;
      // publicAnalysis performs the real entry-time HOLD check and increments
      // its original counter BEFORE work. Its promise owns the full lifetime.
      const lifetime = publicAnalysis(async () => {
        const retained = new Set<Promise<unknown>>(); let sealed = false, retentionError: Error | undefined;
        const retain: HistoryCleanupRetainer = pending => {
          try {
            if (!pending || typeof pending.then !== "function") throw invalid();
            const p = Promise.resolve(pending);
            // A rejected cleanup is settled locally, not a successful remote
            // cancellation. Observe even an invalid late caller's rejection,
            // without authorizing it or reopening the original activity count.
            p.then(() => retained.delete(p), () => retained.delete(p));
            if (sealed) throw invalid();
            retained.add(p);
          } catch { retentionError ??= invalid(); throw retentionError; }
        };
        try {
          if (typeof work !== "function") throw invalid();
          value = await work(retain);
          if (retentionError) throw retentionError;
        } catch (caught) { failed = true; error = caught; }
        finally { sealed = true; }
        const reader = observeHistoryReaderSettlement(authority);
        if (retained.size || !reader.idle) {
          // Timeout/error response can leave now, while publicAnalysis remains
          // open through already-registered physical work and the reader's own
          // finished+pending0 release (including late-fetch -> cancel transfer).
          if (failed) fail(error); else publish(value!);
          await Promise.allSettled([...retained, reader.settled]);
        }
      });
      // Fast paths publish AFTER the original finally decrements the counter.
      // Pending paths already published; resolving/rejecting twice is harmless
      // and cannot decrement or release anyone else's original authority.
      void lifetime.then(() => { if (failed) fail(error); else publish(value!); }, fail);
      return response;
    },
  };
}
