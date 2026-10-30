import {defineConfig} from '@neon/config/v1';

/** Deploy this standalone config only to the intended Neon branch. A new
 * trigger starts disabled; enable it only after both services are configured. */
export default defineConfig({
  functions:{aegisshadow:{name:'Aegis shadow scheduler',source:'index.ts',env:{AI_SHADOW_CRON_SECRET:process.env.AI_SHADOW_CRON_SECRET!}}},
  triggers:{'aegis-shadow-forward':{type:'schedule',function:'aegisshadow',cron:'7,22,37,52 * * * *',functionPath:'/',enabled:false}},
});
