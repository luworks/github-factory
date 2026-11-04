/** Public build-time prefix, shared by browser navigation and API requests. */
export const appPath = (path: string) => `${import.meta.env.BASE_URL || "/github-factory/"}${path.replace(/^\//, "")}`;
