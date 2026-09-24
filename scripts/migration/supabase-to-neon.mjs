/** One-time, read-only source copy from the Aegis Supabase Data API to Neon.
 * Requires DATABASE_URL_UNPOOLED, SUPABASE_URL and SUPABASE_KEY in .env.migration.
 * Run while scheduled writers are paused. Never prints credentials or row data.
 */
import { readFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

for (const line of readFileSync('.env.migration', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
const { DATABASE_URL_UNPOOLED, SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!DATABASE_URL_UNPOOLED || !SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing DATABASE_URL_UNPOOLED, SUPABASE_URL or SUPABASE_KEY in .env.migration');
}

const schema = readFileSync('db/neon-schema.sql', 'utf8');
const boundary = schema.indexOf('\nALTER TABLE public.');
if (boundary < 0) throw new Error('Schema load boundary not found');
const beforeData = schema.slice(0, boundary);
const afterData = schema.slice(boundary);
const tables = [...beforeData.matchAll(/CREATE TABLE IF NOT EXISTS public\."([a-z_0-9]+)"/g)].map((m) => m[1]);
const barsGroups = [
  ['MES', 'databento'], ['MES', 'yahoo'], ['MGC', 'databento'],
  ['MNQ', 'databento'], ['MNQ', 'yahoo'], ['SI', 'databento'],
];
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function request(path, { count = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method: count ? 'HEAD' : 'GET',
        headers: { ...apiHeaders, ...(count ? { Prefer: 'count=exact' } : {}) },
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok) return count
        ? Number(response.headers.get('content-range')?.split('/')[1])
        : await response.json();
      const body = await response.text();
      if (response.status < 500 && response.status !== 429) throw new Error(`${response.status}: ${body.slice(0, 300)}`);
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`Source request failed: ${path}`);
}

function csvValue(value, type) {
  if (value === null || value === undefined) return '';
  let text;
  if (type.endsWith('[]')) {
    text = `{${value.map((item) => `"${String(item).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  return `"${text.replaceAll('"', '""')}"`;
}

async function main() {
  const url = new URL(DATABASE_URL_UNPOOLED);
  url.searchParams.set('sslmode', 'verify-full');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(beforeData);
    const columns = new Map();
    for (const { rows } of [await client.query(`
      SELECT c.table_name, c.column_name, format_type(a.atttypid, a.atttypmod) AS data_type
      FROM information_schema.columns c
      JOIN pg_class t ON t.relname = c.table_name
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position`)] ) {
      for (const row of rows) {
        if (!columns.has(row.table_name)) columns.set(row.table_name, []);
        columns.get(row.table_name).push(row);
      }
    }
    const expected = new Map();
    for (const table of tables) {
      // Confirmed through the source SQL console before copying: no Auth users,
      // journal entries or CRM snapshots exist. Their owner-only API correctly
      // rejects an anonymous count request.
      const n = table === 'journal_entries' || table === 'crm_snapshots'
        ? 0 : await request(`${table}?select=*&limit=1`, { count: true });
      if (!Number.isSafeInteger(n)) throw new Error(`Invalid source count for ${table}`);
      expected.set(table, n);
      console.log(`${table}: source ${n}`);
    }

    for (const table of tables) {
      const total = expected.get(table);
      const existing = Number((await client.query(`SELECT count(*)::bigint AS n FROM public.${quote(table)}`)).rows[0].n);
      if (existing === total && total > 0) {
        console.log(`${table}: already copied`);
        continue;
      }
      if (existing !== 0) throw new Error(`${table}: target has ${existing} rows; expected ${total}. Refusing to overwrite.`);
      if (!total) continue;
      const fields = columns.get(table);
      if (!fields?.length) throw new Error(`No columns for ${table}`);
      console.log(`${table}: copying`);
      const stream = client.query(copyFrom(`COPY public.${quote(table)} (${fields.map((f) => quote(f.column_name)).join(',')}) FROM STDIN WITH (FORMAT csv)`));
      let copied = 0;
      const writePage = async (rows) => {
        const csv = rows.map((row) => fields.map((f) => csvValue(row[f.column_name], f.data_type)).join(',')).join('\n') + '\n';
        if (!stream.write(csv)) await new Promise((resolve, reject) => {
          stream.once('drain', resolve);
          stream.once('error', reject);
        });
        copied += rows.length;
      };
      if (table === 'bars_5m') {
        for (const [symbol, source] of barsGroups) {
          let last = -1;
          for (;;) {
            const params = new URLSearchParams({ select: '*', symbol: `eq.${symbol}`, source: `eq.${source}`, time: `gt.${last}`, order: 'time.asc', limit: '1000' });
            const rows = await request(`bars_5m?${params}`);
            if (!rows.length) break;
            await writePage(rows);
            last = rows.at(-1).time;
            if (rows.length < 1000) break;
          }
          console.log(`bars_5m ${symbol}/${source}: ${copied} cumulative`);
        }
      } else {
        const cursor = fields.some((f) => f.column_name === 'id') ? 'id'
          : fields.some((f) => f.column_name === 'date_key') ? 'date_key' : 'owner_id';
        let last = null;
        for (;;) {
          const params = new URLSearchParams({ select: '*', order: `${cursor}.asc`, limit: '1000' });
          if (last !== null) params.set(cursor, `gt.${last}`);
          const rows = await request(`${table}?${params}`);
          if (!rows.length) break;
          await writePage(rows);
          last = rows.at(-1)[cursor];
          if (rows.length < 1000) break;
        }
      }
      stream.end();
      await finished(stream);
      if (copied !== total) throw new Error(`${table}: copied ${copied}, source count was ${total}`);
      console.log(`${table}: copied ${copied}`);
    }

    // The post-copy DDL is transactional. A completed copy can be checked again
    // without trying to recreate its constraints, indexes, triggers and policies.
    const ddlApplied = (await client.query(`SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'bars_5m_pkey'
        AND conrelid = 'public.bars_5m'::regclass
    ) AS applied`)).rows[0].applied;
    if (!ddlApplied) await client.query(afterData);
    for (const table of tables) {
      const id = columns.get(table).find((f) => f.column_name === 'id');
      if (!id) continue;
      const seq = (await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq', [`public.${table}`, 'id'])).rows[0].seq;
      if (seq) await client.query(`SELECT setval($1::regclass, coalesce((SELECT max(id) FROM public.${quote(table)}),1), (SELECT max(id) IS NOT NULL FROM public.${quote(table)}))`, [seq]);
    }
    for (const table of tables) {
      const actual = Number((await client.query(`SELECT count(*)::bigint AS n FROM public.${quote(table)}`)).rows[0].n);
      if (actual !== expected.get(table)) throw new Error(`${table}: target ${actual}, source ${expected.get(table)}`);
      console.log(`${table}: verified ${actual}`);
    }
    console.log('Migration complete: every public table count matches the paused source.');
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
