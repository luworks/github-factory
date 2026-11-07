import { appPath } from "../base-path";
import { accessConfig, clientIdentity } from "./access";
import { apiError } from "./http";
import { createOgImageService, imageResponse, siteLabel } from "./og-image";
import { hasConfiguredOrigin, serverPublicOrigin } from "./public-origin";
import { projectEnv } from "./config";
import { getCachedWorld } from "./service";

let service: ReturnType<typeof createOgImageService> | undefined;
const og = () => (service ??= createOgImageService({
  getCached: getCachedWorld,
  site: hasConfiguredOrigin(projectEnv()) ? siteLabel(serverPublicOrigin(), appPath("")) : null,
}));

export async function serveHomeImage(request: Request) {
  try {
    clientIdentity(request, accessConfig());
    return imageResponse(request, og().home());
  } catch (error) {
    return apiError(error);
  }
}
export async function serveWorldImage(request: Request, owner: string, repo: string) {
  try {
    clientIdentity(request, accessConfig());
    return imageResponse(request, await og().world(owner, repo, new URL(request.url).searchParams.get("style")));
  } catch (error) {
    return apiError(error);
  }
}
