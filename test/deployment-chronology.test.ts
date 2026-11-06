import { expect, test } from "bun:test";
import table from "./fixtures/deployment-chronology.json";
import { deploymentInstant, selectCurrentWorkerDeployment } from "../scripts/deployment-chronology";
for(const row of table.cases){
 test(`SYNTHETIC UTC chronology shared fixture: ${row.name}`,()=>{
   for(const records of [row.records,[...row.records].reverse()]){
    if(row.expectedDeploymentId===null)expect(()=>selectCurrentWorkerDeployment({deployments:records},table.nowMs)).toThrow();
    else expect(selectCurrentWorkerDeployment({deployments:records},table.nowMs).deploymentId).toBe(row.expectedDeploymentId);
   }
   const run=Bun.spawnSync([process.execPath,"--no-env-file",new URL("./fixtures/retirement-program.ts",import.meta.url).pathname],{cwd:new URL("..",import.meta.url).pathname,env:{PATH:process.env.PATH,HOME:"/tmp",MOON_FACTORY_RETIREMENT_FIXTURE:"chronology:"+row.name},stdout:"pipe",stderr:"pipe",timeout:15000});
   expect(run.exitCode,run.stderr.toString()).toBe(0);
   const result=JSON.parse(run.stdout.toString());
   expect(result.stopCalls).toBe(row.expectedDeploymentId?1:0);
   expect(result.receipts).toBe(row.expectedDeploymentId?1:0);
 });
}
test("SYNTHETIC deployment chronology retains sub-millisecond precision and normalizes offsets",()=>{
 expect(deploymentInstant("2026-11-04T12:00:00.000000002Z",table.nowMs)-deploymentInstant("2026-11-04T12:00:00.000000001Z",table.nowMs)).toBe(1n);
 expect(deploymentInstant("2026-11-04T12:00:00Z",table.nowMs)).toBe(deploymentInstant("2026-11-04T13:00:00.000+01:00",table.nowMs));
});

test("SYNTHETIC nonfinite deployment values and host clocks fail closed",()=>{
 for(const value of [NaN,Infinity,-Infinity]) {
  expect(()=>deploymentInstant(value,table.nowMs)).toThrow();
  expect(()=>deploymentInstant("2026-11-04T12:00:00Z",value)).toThrow();
 }
});
