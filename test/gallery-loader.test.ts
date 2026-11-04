import { expect, test, spyOn } from "bun:test";
import { loadRepositoryPreview } from "../src/gallery/preview-loader";

test("SYNTHETIC gallery fetches use the base path, cap concurrent reads at two and continue after a failed read", async () => {
  const replies: ((response: Response) => void)[] = [];
  const urls: string[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign((url: Parameters<typeof fetch>[0]) => {
    urls.push(String(url));
    return new Promise<Response>((resolve) => replies.push(resolve));
  }, { preconnect: () => {} }));
  try {
    const requests = ["a", "b", "c"].map((repo) => loadRepositoryPreview(`owner/${repo}`, new AbortController().signal).catch(() => null));
    expect(urls).toEqual(["/github-factory/api/gallery-preview/owner/a", "/github-factory/api/gallery-preview/owner/b"]);
    replies[0](new Response("unavailable", { status: 503 }));
    expect(await requests[0]).toBeNull();
    // Request completion releases its slot in finally, rather than starting all cards at once.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls).toHaveLength(3);
    replies[1](Response.json({ fullName: "owner/b", nodes: [], edges: [] }));
    replies[2](Response.json({ fullName: "owner/c", nodes: [], edges: [] }));
    expect((await Promise.all(requests)).filter(Boolean)).toHaveLength(2);
  } finally { mock.mockRestore(); }
});
