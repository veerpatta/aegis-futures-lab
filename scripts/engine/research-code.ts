import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "./learning-audit";
function sources(path:string):string[] {
  return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(path,e.name)):[join(path,e.name)]).filter(p=>p.endsWith(".ts"));
}
export function researchCodeHash():string {
  const paths=[...sources("lib/strategies"),...sources("lib/backtest"),...sources("lib/costs"),...sources("lib/indicators"),...sources("lib/time"),...sources("lib/market"),"lib/paper/policy.ts",...sources("lib/validation"),"lib/types.ts","scripts/engine/regime.ts","scripts/engine/research-observer.ts","scripts/engine/paper-broker.ts","scripts/engine/research-code.ts"];
  return stableHash(paths.sort().map(path=>({path:path.replaceAll("\\","/"),content:readFileSync(path,"utf8").replaceAll("\r\n","\n")})));
}
