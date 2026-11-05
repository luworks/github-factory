import type { WorldIdentity } from "../evidence/contracts";
import { snapshotKey } from "../evidence/contracts";
import type { Attempt, CompletionReceipt, ProgressChallenge, RepoProgress } from "./contracts";
import { challengeIdFor, rewardKeyFor } from "./contracts";
import { validateAttempt } from "./rules";

export const progressDatabase = "moon-factory-exploration";
const repoPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const identityValid = (v: WorldIdentity) => v && repoPattern.test(v.repoKey) && /^[a-f0-9]{40}$/.test(v.headSha) && v.source === "github" && Number.isFinite(Date.parse(v.collectedAt));
export type ProgressState = { generation: number; repos: RepoProgress[]; completions: CompletionReceipt[]; persistence: "device" | "session"; warning: string | null; durableCountKnown: boolean };
export class StaleProgress extends Error {}
function storageWarning(error: unknown) {
  const detail = error instanceof Error && /full|capacity/.test(error.message) ? "Local saving capacity reached. Earlier progress was retained." : error instanceof Error && /corrupt|unsupported|metadata/.test(error.message) ? "Existing local progress is invalid or unsupported and was retained." : "Browser saving is unavailable or failed; existing data was retained.";
  return detail + " Progress is not saved. Practice for this session or retry saving. Durable progress count is unknown.";
}
const empty = (): ProgressState => ({ generation: 0, repos: [], completions: [], persistence: "session", warning: "Progress is not saved. Practice for this session or retry saving. Durable progress count is unknown.", durableCountKnown: false });
const validReceipt = (r: CompletionReceipt) => r && r.schemaVersion === 1 && identityValid(r.completedIdentity) && r.rewardKey === rewardKeyFor(r.completedIdentity.repoKey) &&
  Number.isSafeInteger(r.rulesVersion) && r.rulesVersion >= 1 && r.rulesVersion <= 999 && r.challengeId === challengeIdFor(r.completedIdentity.repoKey, r.rulesVersion) &&
  ["node-link", "commit-marker"].includes(r.variant) && /^[a-f0-9]{64}$/.test(r.evidenceFingerprint) && Number.isFinite(Date.parse(r.completedAt)) && r.verification === "local-answer-check" && r.persistence === "device" && r.reward === "exploration-star";
function validate(state: ProgressState) {
  const { repos, completions, generation } = state;
  if (!Number.isSafeInteger(generation) || generation < 0 || repos.length > 100 || completions.length > 100 ||
    repos.some(r => !r || r.schemaVersion !== 1 || !repoPattern.test(r.repoKey) || typeof r.discovered !== "boolean" || typeof r.visited !== "boolean" || r.visited && !r.discovered || Object.keys(r).some(k => !["schemaVersion","repoKey","discovered","visited"].includes(k))) ||
    completions.some(r => !validReceipt(r) || !repos.some(p => p.repoKey === r.completedIdentity.repoKey)) ||
    [...repos, ...completions].some(r => bytes(r) > 2048) || bytes([repos, completions, { generation }]) > 256 * 1024) throw new Error("Local progress is corrupt, unsupported or full; retained without changes.");
}
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** No source snapshots, answer history or network work. All mutations serialize
 * across the same three stores and compare reset generation inside that txn. */
function browserFactory(): IDBFactory | undefined { try { return globalThis.indexedDB; } catch { return undefined; } }
export class ProgressStore {
  private db: Promise<IDBDatabase> | null = null;
  private memory = empty();
  private reload = false;
  constructor(private factory: IDBFactory | undefined = browserFactory()) {}
  private open() {
    if (this.reload) throw new Error("Reload to continue saving local progress.");
    if (!this.factory) throw new Error("Browser storage is unavailable.");
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = this.factory!.open(progressDatabase, 1);
      let settled = false;
      r.onupgradeneeded = e => {
        if ((e as IDBVersionChangeEvent).oldVersion !== 0) { r.transaction?.abort(); return; }
        r.result.createObjectStore("repoProgress", { keyPath: "repoKey" });
        r.result.createObjectStore("completions", { keyPath: "rewardKey" });
        r.result.createObjectStore("metadata");
      };
      r.onblocked = () => { settled = true; reject(new Error("Storage upgrade is blocked; existing data was retained.")); };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        if (settled) { r.result.close(); return; }
        r.result.onversionchange = () => { this.reload = true; r.result.close(); this.db = null; this.memory.warning = "Reload to continue saving local progress."; };
        resolve(r.result);
      };
    });
  }
  private async transaction<T>(write: boolean, action: (state: ProgressState, tx: IDBTransaction) => T): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["repoProgress", "completions", "metadata"], write ? "readwrite" : "readonly");
      let value: T, failure: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || Error("Progress was not saved."));
      void Promise.all([request(tx.objectStore("repoProgress").getAll(undefined, 101)), request(tx.objectStore("completions").getAll(undefined, 101)), request(tx.objectStore("metadata").getAllKeys(undefined, 2)), request(tx.objectStore("metadata").get("generation"))]).then(([repos, completions, keys, gen]) => {
        try {
          if (keys.some(k => k !== "generation")) throw new Error("Unsupported local progress metadata; retained.");
          const state: ProgressState = { generation: gen === undefined ? 0 : gen, repos, completions, persistence: "device", warning: null, durableCountKnown: true };
          validate(state); value = action(state, tx);
        } catch (e) { failure = e; tx.abort(); }
      }).catch(e => { failure = e; try { tx.abort(); } catch {} });
    });
  }
  private overlay(state: ProgressState): ProgressState {
    if (this.memory.generation !== state.generation) this.memory = { ...empty(), generation: state.generation };
    const unsaved = this.memory.completions.filter(r => !state.completions.some(d => d.rewardKey === r.rewardKey));
    if (!unsaved.length) return state;
    const repos = [...state.repos, ...this.memory.repos.filter(r => !state.repos.some(d => d.repoKey === r.repoKey))];
    if (repos.length > 100) return this.memory;
    return { ...state, repos, completions: [...state.completions, ...unsaved], warning: "Some Exploration stars are session progress — not saved. Repractice and submit to retry saving." };
  }
  async read(): Promise<ProgressState> {
    try { return this.overlay(await this.transaction(false, s => s)); }
    catch (error) { this.db = null; this.memory.warning = storageWarning(error); return { ...this.memory, warning: this.reload ? "Reload to continue saving local progress." : this.memory.warning }; }
  }
  private upsert(state: ProgressState, key: string, visited: boolean) {
    const old = state.repos.find(r => r.repoKey === key);
    if (old) { old.discovered = true; old.visited ||= visited; }
    else state.repos.push({ schemaVersion: 1, repoKey: key, discovered: true, visited });
  }
  async note(identity: WorldIdentity, event: "discovered" | "visited") {
    if (!identityValid(identity)) return this.read();
    try { return await this.transaction(true, (s, tx) => { this.upsert(s, identity.repoKey, event === "visited"); validate(s); tx.objectStore("repoProgress").put(s.repos.find(r => r.repoKey === identity.repoKey)!); return s; }); }
    catch (error) { this.memory.warning = storageWarning(error); if (this.memory.repos.length < 100 || this.memory.repos.some(r => r.repoKey === identity.repoKey)) this.upsert(this.memory, identity.repoKey, event === "visited"); return this.memory; }
  }
  async complete(challenge: ProgressChallenge, attempt: Attempt, identity: WorldIdentity | null, stillCurrent: () => boolean = () => true) {
    if (validateAttempt(challenge, attempt, identity) !== "correct" || !challenge.identity) throw new Error("The current source answers do not qualify.");
    const complete = (s: ProgressState, persistence: "device" | "session") => {
      if (!stillCurrent()) throw new StaleProgress("Snapshot changed or challenge was left. Start again.");
      if (s.generation !== attempt.progressGeneration) throw new StaleProgress("Progress was reset. Start again.");
      const existing = s.completions.find(r => r.rewardKey === challenge.rewardKey);
      if (existing) return { receipt: existing, existing: true, state: s };
      const prior = persistence === "device" ? this.memory.completions.find(r => r.rewardKey === challenge.rewardKey && this.memory.generation === s.generation) : null;
      const receipt: CompletionReceipt = prior ? { ...prior, persistence: "device" } : { schemaVersion: 1, rewardKey: challenge.rewardKey!, challengeId: challenge.challengeId!, rulesVersion: challenge.rulesVersion, completedIdentity: { ...challenge.identity! }, variant: challenge.variant!, evidenceFingerprint: challenge.evidenceFingerprint!, completedAt: new Date().toISOString(), verification: "local-answer-check", persistence, reward: "exploration-star" };
      this.upsert(s, challenge.identity!.repoKey, true); s.completions.push(receipt);
      if (persistence === "device") validate(s);
      else if (s.repos.length > 100 || s.completions.length > 100 || bytes(receipt) > 2048 || bytes(s) > 256 * 1024) throw new Error("Session progress capacity reached.");
      return { receipt, existing: false, state: s };
    };
    try {
      return await this.transaction(true, (s, tx) => {
        const result = complete(s, "device");
        if (!result.existing) { tx.objectStore("completions").add(result.receipt); tx.objectStore("repoProgress").put(s.repos.find(r => r.repoKey === challenge.identity!.repoKey)!); }
        return result;
      });
    } catch (e) {
      if (e instanceof StaleProgress) throw e;
      this.memory.warning = storageWarning(e);
      // Recovery must never relabel an uncommitted receipt durable. Memory is
      // per tab; no cross-tab uniqueness or known durable total is claimed.
      return complete(this.memory, "session");
    }
  }
  async reset() {
    const generation = await this.transaction(true, (s, tx) => {
      if (s.generation >= Number.MAX_SAFE_INTEGER) throw new Error("Reset generation exhausted.");
      tx.objectStore("repoProgress").clear(); tx.objectStore("completions").clear();
      tx.objectStore("metadata").put(s.generation + 1, "generation"); return s.generation + 1;
    });
    this.memory = { ...empty(), generation }; return this.read();
  }
  close() { void this.db?.then(db => db.close()).catch(() => {}); this.db = null; }
}

export function completionFor(state: ProgressState, key: string) { return state.completions.find(r => r.rewardKey === rewardKeyFor(key)) ?? null; }
export function sameCapture(a: WorldIdentity, b: WorldIdentity) { return snapshotKey(a) === snapshotKey(b); }
