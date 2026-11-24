/** Same ordered steps as the former workflow; a thrown stage prevents all following stages. */
export type StageRunner=(path:string,...args:string[])=>void;
export function runEngineStages(run:StageRunner):void {
 run("scripts/engine/run-live.ts");
 run("scripts/experiment/publish.ts");
 run("scripts/experiment/run.ts","tick");
 run("scripts/tm-study/forward.ts");
}
