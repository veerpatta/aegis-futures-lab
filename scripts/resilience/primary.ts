/* Primary runner: serialize complete work when the private guard is enabled.
   Disabled is compatibility mode until all old jobs have drained. Never run with local prod credentials. */
import { Pool } from "pg";
import { spawnSync } from "node:child_process";
import { claim, release } from "@/lib/resilience/guard";
import { runEngineStages } from "@/lib/resilience/pipeline";
const mode=process.argv[2], args=process.argv.slice(3);
if(!process.env.GITHUB_ACTIONS||!process.env.DATABASE_URL)throw Error("Primary runner requires the approved Actions environment");
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,allowExitOnIdle:true});
function run(path:string,...args:string[]){
 const r=spawnSync(process.execPath,["--import","tsx",path,...args],{stdio:"inherit",env:process.env});
 if(r.error||r.status!==0)throw Error("Pipeline stage failed: "+path);
}
async function main(){
 const owned=await claim(pool,"primary",process.env.GITHUB_SHA??"");
 if(owned.kind!=="owned"&&owned.kind!=="disabled")throw Error("Execution guard "+owned.kind);
 if(mode==="engine"){runEngineStages(run);}else if(mode==="experiment"&&["tick","learn","review"].includes(args[0]))run("scripts/experiment/run.ts",...args);
 else if(mode==="control"&&["pause","resume","stop","start"].includes(args[0]))run("scripts/experiment/control.ts",...args);
 else throw Error("Unknown primary route");
 if(owned.kind==="owned")await release(pool,owned.token);
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Guarded runner failed");process.exitCode=1}).finally(()=>pool.end());
