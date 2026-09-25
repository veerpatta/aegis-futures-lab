import fs from 'node:fs';
import pg from 'pg';
const raw=fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
const url=new URL(raw);url.hostname='ep-billowing-recipe-b3sx1q0t.c-4.ap-southeast-1.aws.neon.tech';url.searchParams.set('sslmode','verify-full');
const c=new pg.Client({connectionString:url.toString()});await c.connect();await c.query('BEGIN');
try {
 const key='integration-'+Date.now();
 await c.query(`INSERT INTO research_observations(observation_key,candidate_key,strategy_version,source,provenance,signal_ts,exit_ts,payload) VALUES($1,'test','test','yahoo','historical-replay',now()-interval '1 hour',now(),'{"pnl":5}')`,[key]);
 await c.query('SAVEPOINT immutable');
 let rejected=false;try{await c.query(`UPDATE research_observations SET provenance='forward' WHERE observation_key=$1`,[key]);}catch{rejected=true;await c.query('ROLLBACK TO SAVEPOINT immutable');}
 if(!rejected)throw new Error('Replay provenance was mutable');
 await c.query('SAVEPOINT closed');rejected=false;
 try{await c.query(`UPDATE research_observations SET payload='{"pnl":50}' WHERE observation_key=$1`,[key]);}catch{rejected=true;await c.query('ROLLBACK TO SAVEPOINT closed');}
 if(!rejected)throw new Error('Closed outcome was mutable');
 const privileges=await c.query(`SELECT has_table_privilege('anonymous','paper_releases','INSERT') inserts,has_table_privilege('authenticated','paper_account','UPDATE') updates,has_table_privilege('anonymous','paper_account','SELECT') reads`);
 if(privileges.rows[0].inserts||privileges.rows[0].updates||!privileges.rows[0].reads)throw new Error('Incorrect public privileges');
 console.log('PASS: immutable provenance, write-once closed outcome, public reads, server-only writes');
}finally{await c.query('ROLLBACK');await c.end();}
