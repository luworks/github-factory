import { basePath, test, expect, worldApi, worldPath } from "./fixtures";

test("SYNTHETIC cached entry, retry, reload and sixty-second idle never collect or request AI",async({page,api})=>{
 api.world.source="github";let ready=false;const queries:string[]=[];
 api.respond("GET",worldApi,route=>{const u=new URL(route.request().url());queries.push(u.search);return ready?{body:api.world}:{status:404,body:{error:"Not collected. No collection was requested.",code:"CACHE_MISS"}}});
 await page.clock.install();await page.goto(worldPath+"?mode=cached");await expect(page.getByRole("alert")).toContainText("Not collected");
 ready=true;await page.getByRole("button",{name:"Try again",exact:true}).click();await expect(page.locator(".stage-heading h1")).toContainText("browser-fixture");
 const before=api.requests.length;await page.clock.fastForward(61000);expect(api.requests.length).toBe(before);
 await page.reload();await expect(page.locator(".stage-heading h1")).toContainText("browser-fixture");
 expect(queries).toEqual(["?mode=cached","?mode=cached","?mode=cached"]);expect(api.requests.some(r=>r.method==="POST"||r.path.includes("blueprint")||r.path.includes("budget"))).toBe(false);
});
test("SYNTHETIC unknown exploration mode does not silently enter legacy collection",async({page,api})=>{
 await page.goto(worldPath+"?mode=other");await expect(page.getByRole("alert")).toContainText("Invalid exploration mode");expect(api.requests).toEqual([]);
});
test("SYNTHETIC actual local empty-store route rejects malformed intent and returns cache miss without collection",async({request})=>{
 test.skip(process.env.MOONSHOT_OFFLINE_FIXTURE !== "1", "Native empty-store test requires the explicit outbound-blocked fixture runtime.");
 // APIRequestContext bypasses browser fixtures: this uses the owned keyless local
 // runtime's empty synthetic store, never a public origin or real repository.
 for(const query of ["mode=other","mode=cached&mode=cached","mode=cached&refresh=true"]){const response=await request.get(`${basePath}/api/world/synthetic-cache-test/not-collected?${query}`);expect(response.status()).toBe(400);expect((await response.json()).code).toBe("INVALID_REQUEST")}
 const miss=await request.get(`${basePath}/api/world/synthetic-cache-test/not-collected?mode=cached`);expect(miss.status()).toBe(404);expect((await miss.json()).code).toBe("CACHE_MISS");
});
