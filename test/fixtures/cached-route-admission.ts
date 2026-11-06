import { Route } from "../../src/routes/api.world.$owner.$repo";
import { WorldStore } from "../../src/server/store";
import { syntheticWorld } from "./browser-world";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
const dir=process.env.MOONSHOT_DATA_DIR!,world=syntheticWorld();world.source="github";
const store=new WorldStore(join(dir,"worlds.sqlite"));store.put(world);store.close();
const handler=(Route.options as any).server.handlers.GET,results=[];
for(const [owner,repo,query] of [[world.repo.owner,world.repo.name,"?mode=cached"],["synthetic-quota","missing","?mode=cached"],...(process.env.MOONSHOT_IP_REQUESTS_PER_MINUTE==="0"?[[world.repo.owner,world.repo.name,""]]:[])]) {
 const response=await handler({params:{owner,repo},request:new Request(`http://127.0.0.1/github-factory/api/world/${owner}/${repo}${query}`)});const body=await response.json();results.push({status:response.status,code:body.code??null,head:body.headSha??null});
}
const db=new Database(join(dir,"public-access.sqlite"));const buckets=db.query("SELECT DISTINCT bucket FROM client_quota").all();db.close();
console.log(JSON.stringify({results,buckets,upstreamQuotaCreated:existsSync(join(dir,"public-quota.sqlite"))}));
