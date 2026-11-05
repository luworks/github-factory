import type { WorldIdentity } from "../evidence/contracts";
import { snapshotKey } from "../evidence/contracts";
import type { Attempt, CompletionReceipt, ProgressChallenge, RepoProgress } from "./contracts";
import { challengeIdFor, rewardKeyFor } from "./contracts";
import { validateAttempt } from "./rules";

export const progressDatabase = "moon-factory-exploration";
const repoPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const identityValid = (v: WorldIdentity) => v && repoPattern.test(v.repoKey) && /^[a-f0-9]{40}$/.test(v.headSha) && v.source === "github" && Number.isFinite(Date.parse(v.collectedAt));
export type ProgressState = { generation: number; repos: RepoProgress[]; completions: CompletionReceipt[]; persistence: "device" | "session" | "mixed"; durableRepos: RepoProgress[]; warning: string | null; durableCountKnown: boolean };
export class StaleProgress extends Error {}
class ProgressStorageError extends Error { constructor(readonly kind: "capacity" | "corrupt" | "unsupported") { super(kind === "capacity" ? "Local progress capacity reached; earlier records retained." : kind === "corrupt" ? "Local progress is corrupt; retained without changes." : "Unsupported local progress metadata or generation; retained."); } }
function storageWarning(error: unknown) {
  const detail = error instanceof ProgressStorageError && error.kind === "capacity" ? "Local saving capacity reached. Earlier progress was retained." : error instanceof ProgressStorageError && error.kind !== "capacity" ? "Existing local progress is invalid or unsupported and was retained." : "Browser saving is unavailable or failed; existing data was retained.";
  return detail + " Progress is not saved. Practice for this session or retry saving. Durable progress count is unknown.";
}
const empty = (): ProgressState => ({ generation: 0, repos: [], completions: [], durableRepos: [], persistence: "session", warning: "Progress is not saved. Practice for this session or retry saving. Durable progress count is unknown.", durableCountKnown: false });
const validReceipt = (r: CompletionReceipt, session = false) => r && r.schemaVersion === 1 && identityValid(r.completedIdentity) && r.rewardKey === rewardKeyFor(r.completedIdentity.repoKey) &&
  Number.isSafeInteger(r.rulesVersion) && r.rulesVersion >= 1 && r.rulesVersion <= 999 && r.challengeId === challengeIdFor(r.completedIdentity.repoKey, r.rulesVersion) &&
  ["node-link", "commit-marker"].includes(r.variant) && /^[a-f0-9]{64}$/.test(r.evidenceFingerprint) && Number.isFinite(Date.parse(r.completedAt)) && r.verification === "local-answer-check" && (r.persistence === "device" || session && r.persistence === "session") && r.reward === "exploration-star";
function validateGeneration(generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new ProgressStorageError("unsupported");
}
function validate(state: ProgressState, session = false) {
  const { repos, completions, generation } = state;
  validateGeneration(generation);
  if (repos.length > 100 || completions.length > 100 || [...repos, ...completions].some(r => bytes(r) > 2048) || bytes([repos, completions, { generation }]) > 256 * 1024) throw new ProgressStorageError("capacity");
  if (repos.some(r => !r || r.schemaVersion !== 1 || !repoPattern.test(r.repoKey) || typeof r.discovered !== "boolean" || typeof r.visited !== "boolean" || r.visited && !r.discovered || Object.keys(r).some(k => !["schemaVersion","repoKey","discovered","visited"].includes(k))) ||
    completions.some(r => !validReceipt(r, session) || !repos.some(p => p.repoKey === r.completedIdentity.repoKey))) throw new ProgressStorageError("corrupt");
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
        const db = r.result;
        const names = Array.from(db.objectStoreNames).sort();
        if (JSON.stringify(names) !== JSON.stringify(["completions", "metadata", "repoProgress"])) { db.close(); reject(new ProgressStorageError("unsupported")); return; }
        const schema = db.transaction(names);
        if (schema.objectStore("repoProgress").keyPath !== "repoKey" || schema.objectStore("completions").keyPath !== "rewardKey" || schema.objectStore("metadata").keyPath !== null || names.some(n => schema.objectStore(n).autoIncrement)) { db.close(); reject(new ProgressStorageError("unsupported")); return; }
        r.result.onversionchange = () => { this.reload = true; r.result.close(); this.db = null; this.memory.warning = "Reload to continue saving local progress."; };
        resolve(r.result);
      };
    });
  }
  private async transaction<T>(write: boolean, action: (state: ProgressState, tx: IDBTransaction) => T, clearing = false): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["repoProgress", "completions", "metadata"], write ? "readwrite" : "readonly");
      let value: T, failure: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || Error("Progress was not saved."));
      void Promise.all([clearing ? Promise.resolve([]) : request(tx.objectStore("repoProgress").getAll(undefined, 101)), clearing ? Promise.resolve([]) : request(tx.objectStore("completions").getAll(undefined, 101)), request(tx.objectStore("metadata").getAllKeys(undefined, 2)), request(tx.objectStore("metadata").get("generation"))]).then(([repos, completions, keys, gen]) => {
        try {
          if (keys.some(k => k !== "generation")) throw new ProgressStorageError("unsupported");
          const state: ProgressState = { generation: gen === undefined ? 0 : gen, repos, completions, durableRepos: repos, persistence: "device", warning: null, durableCountKnown: true };
          validate(state); value = action(state, tx);
        } catch (e) { failure = e; tx.abort(); }
      }).catch(e => { failure = e; try { tx.abort(); } catch {} });
    });
  }
  private overlay(state: ProgressState): ProgressState {
    if (this.memory.generation !== state.generation) this.memory = { ...empty(), generation: state.generation };
    const unsaved = this.memory.completions.filter(r => !state.completions.some(d => d.rewardKey === r.rewardKey));
    const repos = state.repos.map(r => { const local = this.memory.repos.find(m => m.repoKey === r.repoKey); return local ? { ...r, discovered: r.discovered || local.discovered, visited: r.visited || local.visited } : r; });
    repos.push(...this.memory.repos.filter(r => !state.repos.some(d => d.repoKey === r.repoKey)));
    const pendingFlags = repos.some(r => { const saved = state.repos.find(d => d.repoKey === r.repoKey); return !saved || r.discovered && !saved.discovered || r.visited && !saved.visited; });
    if (!unsaved.length && !pendingFlags) return state;
    if (repos.length > 100) return this.memory;
    return { ...state, repos, completions: [...state.completions, ...unsaved], persistence: state.repos.length ? "mixed" : "session", warning: "Some exploration is session progress — not saved. Repractice and submit to retry saving." };
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
    catch (error) {
      const staged = structuredClone(this.memory); staged.warning = storageWarning(error);
      this.upsert(staged, identity.repoKey, event === "visited"); validate(staged, true);
      this.memory = staged; return this.memory;
    }
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
      validate(s, persistence === "session");
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
      // Recovery must never relabel an uncommitted receipt durable. Memory is
      // per tab; no cross-tab uniqueness or known durable total is claimed.
      const staged = structuredClone(this.memory); staged.warning = storageWarning(e);
      const result = complete(staged, "session"); this.memory = staged; return result;
    }
  }
  async reset() {
    const generation = await this.transaction(true, (s, tx) => {
      if (s.generation >= Number.MAX_SAFE_INTEGER) throw new Error("Reset generation exhausted.");
      tx.objectStore("repoProgress").clear(); tx.objectStore("completions").clear();
      tx.objectStore("metadata").put(s.generation + 1, "generation"); return s.generation + 1;
    }, true);
    this.memory = { ...empty(), generation }; return this.read();
  }
  close() { void this.db?.then(db => db.close()).catch(() => {}); this.db = null; }
}

export function completionFor(state: ProgressState, key: string) { return state.completions.find(r => r.rewardKey === rewardKeyFor(key)) ?? null; }
export function sameCapture(a: WorldIdentity, b: WorldIdentity) { return snapshotKey(a) === snapshotKey(b); }

export function flagSaved(state: ProgressState, repoKey: string, flag: "discovered" | "visited") { return state.durableRepos.some(r => r.repoKey === repoKey && r[flag]); }
export function progressCounts(state: ProgressState) { return { saved: state.completions.filter(r => r.persistence === "device").length, session: state.completions.filter(r => r.persistence === "session").length }; }
