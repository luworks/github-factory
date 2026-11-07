import { appPath } from "../base-path";
import { createRootRoute, HeadContent, Scripts, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";
import { homeMeta } from "../og/meta";
import { publicOrigin } from "../og/origin";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Default share card; routes override by name/property.
      ...homeMeta(publicOrigin()),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: appPath("/favicon.svg") },
    ],
  }),
  shellComponent: Document,
  notFoundComponent: () => (
    <main className="error-page">
      <h1>Uncharted territory.</h1>
      <p>This world hasn’t been mapped yet.</p>
      <Link to="/">Return to Mission Control</Link>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main className="error-page">
      <h1>Signal interrupted.</h1>
      <p>{error instanceof Error ? error.message : "Try the request again."}</p>
      <button onClick={reset}>Try again</button>
      <Link to="/">Mission Control</Link>
    </main>
  ),
});
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
