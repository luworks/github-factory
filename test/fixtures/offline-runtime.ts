/** Explicit CI/local synthetic runtime only. Browser-route fixtures cannot
 * intercept a server collector regression, so block every outbound fetch too. */
if (process.env.MOONSHOT_OFFLINE_FIXTURE !== "1") throw new Error("Explicit offline fixture flag required");
globalThis.fetch = (async () => { throw new Error("SYNTHETIC offline runtime blocked outbound network"); }) as unknown as typeof fetch;
