import { appPath } from "../base-path";
import type { BudgetStatus, FeaturedProject, WorldSnapshot } from "../contracts";
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(appPath(url), { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  let result: unknown;
  try {
    result = await r.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!r.ok) throw new Error((result as { error?: string })?.error || `Request failed (${r.status}).`);
  return result as T;
}
export const getGallery = () => request<{ projects: FeaturedProject[] }>("/api/gallery");
export const createWorld = (repo: string) =>
  request<WorldSnapshot>("/api/worlds", { method: "POST", body: JSON.stringify({ repo, enrich: true }) });
const pendingWorlds = new Map<string, Promise<WorldSnapshot>>();
export function getWorld(owner: string, repo: string): Promise<WorldSnapshot> {
  const url = `/api/world/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pending = pendingWorlds.get(url);
  if (pending) return pending;
  const requestWorld = request<WorldSnapshot>(url);
  pendingWorlds.set(url, requestWorld);
  const clear = () => {
    if (pendingWorlds.get(url) === requestWorld) pendingWorlds.delete(url);
  };
  void requestWorld.then(clear, clear);
  return requestWorld;
}
export const refreshWorld = (owner: string, repo: string) =>
  request<WorldSnapshot>(`/api/world/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    method: "POST",
    body: JSON.stringify({ refresh: true }),
  });
export const enrichWorld = (owner: string, repo: string) =>
  request<WorldSnapshot>(`/api/blueprint/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: "POST", body: "{}" });
export const getBudget = () => request<BudgetStatus>("/api/budget");
export const shortNumber = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const clock = (s: string) =>
  new Date(s).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }) + " PT";
