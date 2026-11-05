/** Operational proof must contain all five explicit table counts. Empty or
 * partial management responses never mean zero. No model/runtime data needed. */
export function requireExactCounts(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 5) throw new Error("Exactly five successful count results required");
  return value.map((item) => {
    if (!item || typeof item !== "object" || item.success !== true || !Array.isArray(item.results) || item.results.length !== 1) throw new Error("Count result unavailable");
    const row = item.results[0];
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 1 || typeof row.n !== "number" || !Number.isSafeInteger(row.n) || row.n < 0) throw new Error("Count is not a nonnegative integer");
    return row.n;
  });
}
if (import.meta.main) {
  try { const text = await Bun.stdin.text(); if (text.length > 100_000) throw new Error(); console.log(JSON.stringify(requireExactCounts(JSON.parse(text)))); }
  catch { console.error("Complete table-count evidence unavailable"); process.exitCode = 1; }
}
