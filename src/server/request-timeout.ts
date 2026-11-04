import { definePlugin } from "nitro";

/** A bounded GitHub survey plus one bounded model request can exceed Bun's 10s default. */
export default definePlugin((app) => {
  app.hooks.hook("request", (event) => {
    if (new URL(event.req.url).pathname.startsWith("/api/")) {
      event.req.runtime?.bun?.server?.timeout(event.req, 180);
    }
  });
});
