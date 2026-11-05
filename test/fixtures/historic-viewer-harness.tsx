import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HistoricTopologyViewer } from "../../src/components/HistoricTopologyViewer";
import { syntheticHistoricalWindow } from "./historic-viewer";
declare global { interface Window { __historicHarness: { replace: (mode: "full" | "partial" | "gap" | "many" | "invalid" | "missing", generation?: string) => void } } }
function Harness() {
 const [windowInput,setWindowInput]=useState<unknown>(()=>syntheticHistoricalWindow());
 useEffect(()=>{window.__historicHarness={replace:(mode,generation)=>setWindowInput(mode==="missing"?null:mode==="invalid"?{}:syntheticHistoricalWindow(mode,generation))};},[]);
 return <main><p style={{padding:12}}>SYNTHETIC standalone historical component harness. No product runtime integration or live data.</p><HistoricTopologyViewer window={windowInput}/></main>;
}
globalThis.fetch=(async()=>{throw new Error("SYNTHETIC harness blocks outbound fetch");}) as unknown as typeof fetch;
createRoot(document.getElementById("root")!).render(<Harness/>);
