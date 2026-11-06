/** The bounded shape actually dereferenced by the explorer, renderer and source
 * adapter. Reject malformed captures; never repair facts or manufacture defaults. */
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 100_000): v is string => typeof v === "string" && v.length <= max;
const nullableText = (v: unknown) => v === null || text(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const list = (v: unknown, max: number, valid: (v: any) => boolean): v is any[] => Array.isArray(v) && v.length <= max && v.every(valid);
const strings = (v: unknown, max = 100) => list(v, max, x => text(x));
const one = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);
const confidence = (v: unknown) => one(v, ["observed", "inferred"]);
const node = (n: unknown) => object(n) && text(n.id, 512) && !!n.id && text(n.label) && text(n.path, 512) && text(n.description) &&
  one(n.kind, ["app", "service", "package", "data", "infra", "docs", "test", "tool", "external"]) && confidence(n.confidence) && one(n.status, ["healthy", "active", "attention", "unknown"]) && nullableText(n.language) && finite(n.size) && strings(n.evidence);
const edge = (e: unknown) => object(e) && text(e.id, 512) && text(e.source, 512) && text(e.target, 512) && text(e.label) && one(e.kind, ["dependency", "pipeline", "containment", "inferred"]) && confidence(e.confidence);
const work = (w: unknown) => object(w) && finite(w.number) && [w.title,w.url,w.author,w.updatedAt].every(x=>text(x)) && one(w.state,["open","closed"]) && one(w.kind,["issue","pull"]) && strings(w.labels) && (w.draft === undefined || typeof w.draft === "boolean") && (w.headSha === undefined || text(w.headSha));
export function worldShapeValid(w: unknown): boolean {
  if (!object(w) || w.schemaVersion !== 1 || !object(w.repo) || !object(w.coverage) || !object(w.health) || !object(w.blueprint)) return false;
  const r=w.repo,b=w.blueprint,g=b.generator;
  if (![r.owner,r.name,r.fullName,r.url,r.description,r.defaultBranch,r.pushedAt].every(x=>text(x)) || ![r.stars,r.forks,r.openIssues].every(finite) || ![r.language,r.license,r.homepage].every(nullableText)) return false;
  if (!list(w.nodes,100,node) || !list(w.edges,256,edge) || new Set(w.nodes.map(n=>n.id)).size !== w.nodes.length || new Set(w.edges.map(e=>e.id)).size !== w.edges.length) return false;
  if (!list(w.issues,100,work) || !list(w.pulls,100,work) || !list(w.workflows,100,x=>object(x) && finite(x.id) && [x.name,x.url,x.status,x.branch,x.headSha,x.createdAt,x.updatedAt].every(v=>text(v)) && nullableText(x.conclusion)) ||
      !list(w.commits,100,c=>object(c) && [c.id,c.message,c.url,c.author,c.date].every(v=>text(v)))) return false;
  if (!object(w.languages) || Object.keys(w.languages).length>100 || !Object.values(w.languages).every(finite) || !one(w.coverage.tree,["full","truncated","unavailable"]) || ![w.coverage.issueWindow,w.coverage.pullWindow,w.coverage.workflowWindow].every(finite) || !strings(w.coverage.notes) || !one(w.health.github,["ok","partial","error"]) || !(w.health.rateLimitRemaining===null || finite(w.health.rateLimitRemaining))) return false;
  return text(b.summary) && text(b.narrative) && list(b.districts,100,d=>object(d) && [d.nodeId,d.title,d.purpose].every(v=>text(v))) &&
    list(b.missions,100,m=>object(m) && [m.id,m.title,m.description].every(v=>text(v)) && one(m.priority,["high","medium","low"]) && strings(m.evidence) && strings(m.nodeIds) && nullableText(m.url)) &&
    object(g) && one(g.provider,["rules","muse","openai"]) && text(g.model) && text(g.generatedAt) && finite(g.costUsd) && strings(g.notes);
}
