import fs from 'node:fs';
import pg from 'pg';
if(!process.argv.includes('--branch')&&!process.argv.includes('--apply-main')) throw new Error('Choose --branch or --apply-main explicitly');
const env = fs.readFileSync('.env.local','utf8');
const raw = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
const url = new URL(raw); url.searchParams.set('sslmode','verify-full');
if(!url.hostname.startsWith('ep-twilight-recipe-b3apaham')) throw new Error('Not the expected Aegis project');
if(process.argv.includes('--branch')) url.hostname='ep-billowing-recipe-b3sx1q0t.c-4.ap-southeast-1.aws.neon.tech';
else url.hostname=url.hostname.replace('-pooler','');
const c=new pg.Client({connectionString:url.toString()}); await c.connect();
try {
 const canonical=fs.readFileSync('db/neon-schema.sql','utf8');
 const tables=[...canonical.matchAll(/CREATE TABLE IF NOT EXISTS public\."([^"]+)" \(([\s\S]*?)\n\);/g)];
 const actual=await c.query("select table_name,column_name from information_schema.columns where table_schema='public'");
 const found=new Set(actual.rows.map(r=>r.table_name+'.'+r.column_name));
 let checked=0;
 for(const t of tables) for(const col of t[2].matchAll(/^\s*"([^"]+)"/gm)) {
   checked++; if(!found.has(t[1]+'.'+col[1])) throw new Error('Schema drift: missing '+t[1]+'.'+col[1]);
 }
 if(checked<232) throw new Error('Canonical schema comparison did not cover all original columns');
 console.log({verifiedOriginalColumns:checked,target:process.argv.includes('--branch')?'test branch':'main'});
 const sql=fs.readFileSync('db/migrations/20260925_research_recovery.sql','utf8');
 await c.query('BEGIN');
 try {await c.query(sql);await c.query(sql);await c.query('COMMIT');console.log('Migration and idempotent rerun passed');}
 catch(e){await c.query('ROLLBACK');throw e;}
} finally { await c.end(); }
