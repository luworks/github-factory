import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CURATED_PROJECTS } from "../src/catalog";
import { LandingPage } from "../src/components/LandingPage";

test("curation preserves the authorized twenty identities and original six positions", () => {
  expect(CURATED_PROJECTS.map((project) => project.fullName)).toEqual([
    "openclaw/openclaw",
    "pingdotgg/t3code",
    "react/react",
    "pytorch/pytorch",
    "facebookresearch/segment-anything",
    "meta-llama/llama-models",
    "microsoft/vscode",
    "torvalds/linux",
    "kubernetes/kubernetes",
    "huggingface/transformers",
    "rust-lang/rust",
    "golang/go",
    "python/cpython",
    "denoland/deno",
    "oven-sh/bun",
    "vercel/next.js",
    "sveltejs/svelte",
    "vuejs/core",
    "supabase/supabase",
    "TanStack/router",
  ]);
  expect(new Set(CURATED_PROJECTS.map((project) => project.fullName.toLowerCase())).size).toBe(20);
});

test("uncached catalog cannot present editorial metadata as captured facts", () => {
  for (const project of CURATED_PROJECTS) {
    expect(project).toMatchObject({ language: null, stars: null, ready: false, collectedAt: null });
  }
});

test("initial English landing renders all twenty curated links without fabricated star counts", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { lang: "en", onLangChange: () => {} }));
  const cards = [...html.matchAll(/<a class="project-card" href="([^"]+)"/g)].map((match) => match[1]);
  expect(cards).toEqual(CURATED_PROJECTS.map((project) => `/github-factory/world/${project.fullName}?style=${project.suggestedStyle}`));
  expect(html).toContain("20 CURATED POPULAR PROJECTS");
  expect(html).not.toContain("World ready");
  expect(html).not.toContain("lucide-star");
});
