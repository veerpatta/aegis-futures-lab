import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "./learning-audit";
function sources(path:string):string[] {
  return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(path,e.name)):[join(path,e.name)]).filter(p=>p.endsWith(".ts"));
}
/* The same code must hash the same on every machine. Paths are normalised to
   forward slashes BEFORE sorting: sorting first put Windows' backslash paths
   in a different order from Linux's, so a measurement run on Windows (the
   2026-09-25 one, affc0974…) never matched the forward evidence the Linux
   engine recorded (921d5fa8…), and every candidate's forward count stayed at
   zero. Line endings were already normalised. */
export function researchCodeHash():string {
  const paths=[...sources("lib/strategies"),...sources("lib/backtest"),...sources("lib/costs"),...sources("lib/indicators"),...sources("lib/time"),...sources("lib/market"),"lib/paper/policy.ts",...sources("lib/validation"),"lib/types.ts","scripts/engine/regime.ts","scripts/engine/research-observer.ts","scripts/engine/paper-broker.ts","scripts/engine/research-code.ts"]
    .map(path=>path.replaceAll("\\","/")).sort();
  return stableHash(paths.map(path=>({path,content:readFileSync(path,"utf8").replaceAll("\r\n","\n")})));
}
