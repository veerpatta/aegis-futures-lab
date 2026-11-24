// Build-only entry, not an executor. Embeds the original research hash without editing hashed files.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { researchCodeHash } from "../engine/research-code";
async function main(){
 const hash=researchCodeHash();
 const out="dist/functions/aegisstandby";
 mkdirSync(out,{recursive:true});
 await build({entryPoints:["functions/aegisstandby/index.ts"],bundle:true,platform:"node",target:"node24",format:"esm",outfile:out+"/index.mjs",external:["pg-native","cloudflare:sockets"],banner:{js:"import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);"},plugins:[{name:"pin-research-hash",setup(b){b.onLoad({filter:/[\\/]scripts[\\/]engine[\\/]research-code\.ts$/},()=>({contents:"export function researchCodeHash(){return "+JSON.stringify(hash)+"}",loader:"js"}))}}]});
 const source=readFileSync(out+"/index.mjs","utf8");
 for(const host of ["hist.databento.com","api.anthropic.com","api.openai.com"])if(source.includes(host))throw Error("Forbidden paid endpoint: "+host);
 // The GitHub build runner has zip; this is only a source archive, no environment.
 const z=spawnSync("zip",["-q","-j",out+".zip",out+"/index.mjs"],{stdio:"inherit"});
 if(z.status!==0)throw Error("zip failed");
 console.log("Standby source bundle built; research hash "+hash);
}
main().catch(e=>{console.error(e);process.exitCode=1});
