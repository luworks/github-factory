import type { FeaturedProject } from "./contracts";

/** Editorial selection of popular public projects, not a global ranking.
 * Client-safe metadata only: observed facts are filled from cached snapshots. */
export const CURATED_PROJECTS: ReadonlyArray<Readonly<FeaturedProject>> = Object.freeze(
  (
    [
      {
        fullName: "openclaw/openclaw",
        name: "OpenClaw",
        description: "Explore the public OpenClaw repository.",
        category: "AI assistant",
        suggestedStyle: "moonshot",
      },
      {
        fullName: "pingdotgg/t3code",
        name: "T3 Code",
        description: "Explore the public T3 Code repository.",
        category: "Developer tools",
        suggestedStyle: "factorio",
      },
      {
        fullName: "react/react",
        name: "React",
        description: "The library for web and native user interfaces.",
        category: "UI framework",
        suggestedStyle: "civilization",
      },
      {
        fullName: "pytorch/pytorch",
        name: "PyTorch",
        description: "Tensors and dynamic neural networks.",
        category: "Machine learning",
        suggestedStyle: "red-alert",
      },
      {
        fullName: "facebookresearch/segment-anything",
        name: "Segment Anything",
        description: "Explore image segmentation research.",
        category: "Computer vision",
        suggestedStyle: "red-alert-2",
      },
      {
        fullName: "microsoft/vscode",
        name: "Visual Studio Code",
        description: "Explore the open-source code editor.",
        category: "Developer tools",
        suggestedStyle: "factorio",
      },
      {
        fullName: "torvalds/linux",
        name: "Linux",
        description: "Explore the Linux kernel source tree.",
        category: "Operating systems",
        suggestedStyle: "civilization",
      },
      {
        fullName: "kubernetes/kubernetes",
        name: "Kubernetes",
        description: "Container orchestration for distributed applications.",
        category: "Infrastructure",
        suggestedStyle: "red-alert-2",
      },
      {
        fullName: "huggingface/transformers",
        name: "Transformers",
        description: "Explore tools for pretrained machine learning models.",
        category: "Machine learning",
        suggestedStyle: "moonshot",
      },
      {
        fullName: "rust-lang/rust",
        name: "Rust",
        description: "Explore the Rust programming language and compiler.",
        category: "Programming languages",
        suggestedStyle: "factorio",
      },
      {
        fullName: "golang/go",
        name: "Go",
        description: "Explore the Go programming language and toolchain.",
        category: "Programming languages",
        suggestedStyle: "civilization",
      },
      {
        fullName: "python/cpython",
        name: "CPython",
        description: "Explore the Python language implementation.",
        category: "Programming languages",
        suggestedStyle: "moonshot",
      },
      {
        fullName: "denoland/deno",
        name: "Deno",
        description: "Explore a runtime for JavaScript and TypeScript.",
        category: "Runtimes",
        suggestedStyle: "red-alert",
      },
      {
        fullName: "oven-sh/bun",
        name: "Bun",
        description: "Explore the JavaScript runtime and development toolkit.",
        category: "Runtimes",
        suggestedStyle: "factorio",
      },
      {
        fullName: "vercel/next.js",
        name: "Next.js",
        description: "Explore the React framework for web applications.",
        category: "Web frameworks",
        suggestedStyle: "civilization",
      },
      {
        fullName: "sveltejs/svelte",
        name: "Svelte",
        description: "Explore the compiler for reactive user interfaces.",
        category: "UI framework",
        suggestedStyle: "red-alert-2",
      },
      {
        fullName: "vuejs/core",
        name: "Vue",
        description: "Explore the progressive JavaScript framework.",
        category: "UI framework",
        suggestedStyle: "civilization",
      },
      {
        fullName: "supabase/supabase",
        name: "Supabase",
        description: "Explore the open-source application backend platform.",
        category: "Backend platform",
        suggestedStyle: "red-alert",
      },
      {
        fullName: "TanStack/router",
        name: "TanStack Router",
        description: "Explore type-safe routing for web applications.",
        category: "Web tooling",
        suggestedStyle: "moonshot",
      },
    ] satisfies ReadonlyArray<Omit<FeaturedProject, "language" | "stars" | "ready" | "collectedAt">>
  ).map((project) => Object.freeze({ ...project, language: null, stars: null, ready: false, collectedAt: null })),
);
