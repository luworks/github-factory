import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GitHubError, type Fetcher } from "./github";

/** Separate from the paid ledger. Every upstream attempt, including retries,
 * consumes a persisted admission; restarts and concurrent callers cannot reset it. */
export class PublicGitHubQuota {
  private db: Database;
  constructor(path: string, private limit: number, private now = Date.now) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS github_quota (window INTEGER PRIMARY KEY, used INTEGER NOT NULL)");
  }
  take() {
    const now = this.now();
    const window = Math.floor(now / 3_600_000);
    const admitted = this.db.query(`INSERT INTO github_quota(window, used) SELECT ?, 1 WHERE ? > 0
      ON CONFLICT(window) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used`).get(window, this.limit, this.limit);
    if (!admitted) throw new GitHubError("PUBLIC_RATE_LIMIT", 429,
      "Public GitHub collection allowance reached. Cached worlds remain available; retry after the cooldown.",
      Math.max(1, Math.ceil(((window + 1) * 3_600_000 - now) / 1000)));
    this.db.query("DELETE FROM github_quota WHERE window < ?").run(window - 1);
  }
  wrap(fetcher: Fetcher): Fetcher {
    return (input, init) => { this.take(); return fetcher(input, init); };
  }
  close() { this.db.close(); }
}
