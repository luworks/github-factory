import { publicAnalysis } from "./runtime-activity";
import { WorldStorageError, type SnapshotStore, type WorldStoragePhysicalObservation } from "./world-storage";

export class WorldLifecycleError extends WorldStorageError {
  readonly writeOutcome = "unknown";
  readonly physicalSettlement = "unknown";
}
const invalid = () => new WorldLifecycleError();
const retained = () => new Promise<void>(() => {});
const nativeThen = Promise.prototype.then;

/** Only absence selects the legacy path. Bind the original method from THIS
 * store, never an independently injected observer/client/counter. Providers
 * must implement the accepted truthful local-settlement contract; arbitrary
 * callbacks cannot prove remote processing or physical binding identity.
 * Invalid/changed/rejected evidence deliberately retains original authority
 * indefinitely. Recovery needs a separately reviewed operator action, no reset,
 * polling, retry or forced unlock here. Cached reads do not use this hook. */
export function createWorldLifecycle(store: SnapshotStore) {
  let method: SnapshotStore["observeSettlement"], bindingInvalid = false;
  try { if (!("observeSettlement" in store)) return null; method = store.observeSettlement; if (typeof method !== "function") bindingInvalid = true; }
  catch { bindingInvalid = true; }
  const binding = () => { if (bindingInvalid || typeof method !== "function" || store.observeSettlement !== method) throw invalid(); return method; };
  return {
    run<T>(work: () => Promise<T>, releaseSlot: () => void): Promise<T> {
      let publish!: (value: T | PromiseLike<T>) => void, fail!: (error: unknown) => void;
      const response = new Promise<T>((resolve, reject) => { publish = resolve; fail = reject; });
      let value: T, error: unknown, failed = false, released = false;
      const finish = () => { if (!released) { released = true; releaseSlot(); } };
      const unknown = async () => { fail(invalid()); await retained(); };
      // publicAnalysis performs the ORIGINAL entry HOLD check and increments
      // its ORIGINAL counter before the first mutating generation request.
      const lifetime = publicAnalysis(async () => {
        try { binding(); } catch { await unknown(); return; }
        try { value = await work(); } catch (caught) { failed = true; error = caught; }
        let observation: WorldStoragePhysicalObservation, physical: Promise<boolean>, idle: boolean;
        const state: { result: "pending" | "settled" | "invalid" } = { result: "pending" };
        try {
          observation = Reflect.apply(binding(), store, []);
          // Attach to the actual native Promise, ignoring a shadowed .then.
          // This also handles rejection before validating the other fields.
          const signal = observation?.settled;
          let settled!: (value: boolean) => void;
          physical = new Promise(resolve => { settled = resolve; });
          Reflect.apply(nativeThen, signal, [
            (v: unknown) => { state.result = v === undefined ? "settled" : "invalid"; settled(v === undefined); },
            () => { state.result = "invalid"; settled(false); },
          ]);
          const observedIdle = observation?.idle;
          if (!observation || Object.keys(observation).sort().join() !== "idle,settled" || typeof observedIdle !== "boolean") throw invalid();
          idle = observedIdle;
        } catch { await unknown(); return; }
        // No sleep or polling. Already settled native evidence takes the fast
        // cleanup path; an already rejected/malformed proof cannot publish a
        // successful response. idle=true also requires settled evidence.
        await Promise.resolve();
        if (state.result === "invalid" || idle && state.result === "pending") { await unknown(); return; }
        if (state.result === "settled") return;
        // Logical response can leave while the SAME store's physical work and
        // both original authorities remain retained. No new work is dispatched.
        // Errors may leave promptly; successful results wait for a valid
        // settlement so a later rejecting observer cannot certify success.
        if (failed) fail(error);
        if (!await physical) await unknown();
      });
      // Original global finally runs before this slot release. Fast responses
      // publish after BOTH counters are cleaned; pending responses were already
      // published and retain their singleflight entry until this exact point.
      void lifetime.then(() => { try { finish(); if (failed) fail(error); else publish(value!); } catch { fail(invalid()); } }, caught => { try { finish(); fail(caught); } catch { fail(invalid()); } });
      return response;
    },
  };
}
