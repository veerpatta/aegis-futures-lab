import fs from 'node:fs';
import pg from 'pg';
const branch=process.argv.includes('--test');
if(!branch&&!process.argv.includes('--apply-main'))throw new Error('Choose --test or --apply-main');
const env=fs.readFileSync('.env.local','utf8');
const url=new URL(env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,''));
if(!url.hostname.startsWith('ep-twilight-recipe-b3apaham'))throw new Error('Wrong project');
url.hostname=branch?'ep-young-fog-b3kwq9bw.c-4.ap-southeast-1.aws.neon.tech':url.hostname.replace('-pooler','');url.searchParams.set('sslmode','verify-full');
const c=new pg.Client({connectionString:url.toString()});await c.connect();
try{
 const canonical=fs.readFileSync('db/neon-schema.sql','utf8');
 const found=new Set((await c.query("select table_name||'.'||column_name name from information_schema.columns where table_schema='public'")).rows.map(r=>r.name));
 let checked=0;for(const t of canonical.matchAll(/CREATE TABLE IF NOT EXISTS public\."([^"]+)" \(([\s\S]*?)\n\);/g))for(const col of t[2].matchAll(/^\s*"([^"]+)"/gm)){checked++;if(!found.has(t[1]+'.'+col[1]))throw new Error('Schema drift '+t[1]+'.'+col[1]);}
 if(checked<232)throw new Error('Incomplete schema check');
 await c.query('BEGIN');await c.query(fs.readFileSync('db/migrations/20260925_trader_overview.sql','utf8'));await c.query(fs.readFileSync('db/migrations/20260925_trader_overview.sql','utf8'));
 await c.query('SET LOCAL ROLE anonymous');
 for(const view of ['bot_overview','candidate_progress','bot_activity'])console.log(view,(await c.query(`select count(*) from public.${view}`)).rows[0]);
 await c.query('RESET ROLE');await c.query('COMMIT');console.log({checked,target:branch?'test':'main'});
}finally{await c.end();}
