/** Server-only bridge for the engine's PostgREST-style query chains.
 * All queries run against Neon PostgreSQL with a server-side pooled URL.
 * No database credential or write endpoint is exposed to the browser.
 */
import { Pool, types } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1184, (value) => new Date(value).toISOString());

type Row = Record<string, unknown>;
type Filter = { column: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "notnull" | "like"; value?: unknown };
type Result = { data: Row[] | Row | null; error: { message: string; code?: string } | null; count: number | null };
const identifier = (name: string) => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
};
let pool: Pool | undefined;
function connection(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Neon database access.");
  if (!pool) {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("sslmode", "verify-full");
    pool = new Pool({ connectionString: url.toString(), max: 5, allowExitOnIdle: true });
  }
  return pool;
}

class Query {
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private records: Row[] = [];
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private maxRows?: number;
  private offset = 0;
  private one = false;
  private head = false;
  private exactCount = false;
  private conflict: string[] = [];
  private returning = false;

  constructor(private readonly table: string) { identifier(table); }
  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.columns = columns;
    this.head = !!options?.head;
    this.exactCount = options?.count === "exact";
    if (this.operation !== "select") this.returning = true;
    return this;
  }
  insert(value: Row | Row[]) { this.operation = "insert"; this.records = Array.isArray(value) ? value : [value]; return this; }
  upsert(value: Row | Row[], options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.records = Array.isArray(value) ? value : [value];
    this.conflict = (options?.onConflict || "id").split(",").map((x) => x.trim());
    return this;
  }
  update(value: Row) { this.operation = "update"; this.records = [value]; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, op: "eq", value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, op: "neq", value }); return this; }
  gt(column: string, value: unknown) { this.filters.push({ column, op: "gt", value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column, op: "gte", value }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ column, op: "lt", value }); return this; }
  lte(column: string, value: unknown) { this.filters.push({ column, op: "lte", value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, op: "in", value }); return this; }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) throw new Error(`Unsupported negated filter: ${operator}`);
    this.filters.push({ column, op: "notnull" }); return this;
  }
  like(column: string, value: string) { this.filters.push({ column, op: "like", value }); return this; }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst }); return this;
  }
  limit(n: number) { this.maxRows = n; return this; }
  range(from: number, to: number) { this.offset = from; this.maxRows = to - from + 1; return this; }
  single() { this.one = true; return this; }

  private where(values: unknown[]) {
    const conditions = this.filters.map((filter) => {
      const col = identifier(filter.column);
      if (filter.op === "notnull") return `${col} IS NOT NULL`;
      if (filter.op === "in") {
        values.push(filter.value);
        return `${col} = ANY($${values.length})`;
      }
      if (filter.value === null && filter.op === "eq") return `${col} IS NULL`;
      if (filter.value === null && filter.op === "neq") return `${col} IS NOT NULL`;
      values.push(filter.value);
      const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE" }[filter.op];
      return `${col} ${op} $${values.length}`;
    });
    return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  }
  private selectedColumns() {
    return this.columns.trim() === "*" ? "*" : this.columns.split(",").map((x) => identifier(x.trim())).join(", ");
  }
  private async execute(): Promise<Result> {
    const values: unknown[] = [];
    const table = `public.${identifier(this.table)}`;
    try {
      let sql: string;
      if (this.operation === "select") {
        sql = `SELECT ${this.head ? "count(*)::bigint AS n" : this.selectedColumns()} FROM ${table}${this.where(values)}`;
        if (!this.head) {
          if (this.orders.length) sql += ` ORDER BY ${this.orders.map((o) => `${identifier(o.column)} ${o.ascending ? "ASC" : "DESC"}${o.nullsFirst === undefined ? "" : o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"}`).join(", ")}`;
          if (this.maxRows !== undefined) sql += ` LIMIT ${Math.max(0, this.maxRows)}`;
          if (this.offset) sql += ` OFFSET ${Math.max(0, this.offset)}`;
        }
      } else if (this.operation === "insert" || this.operation === "upsert") {
        if (!this.records.length) return { data: [], error: null, count: 0 };
        const columns = [...new Set(this.records.flatMap((row) => Object.keys(row)))];
        sql = `INSERT INTO ${table} (${columns.map(identifier).join(", ")})${columns.includes("id") ? " OVERRIDING SYSTEM VALUE" : ""} VALUES ` +
          this.records.map((row) => `(${columns.map((column) => { values.push(row[column] ?? null); return `$${values.length}`; }).join(", ")})`).join(", ");
        if (this.operation === "upsert") {
          const update = columns.filter((column) => !this.conflict.includes(column) && column !== "id");
          sql += ` ON CONFLICT (${this.conflict.map(identifier).join(", ")}) ` +
            (update.length ? `DO UPDATE SET ${update.map((column) => `${identifier(column)} = EXCLUDED.${identifier(column)}`).join(", ")}` : "DO NOTHING");
        }
        if (this.returning) sql += ` RETURNING ${this.selectedColumns()}`;
      } else if (this.operation === "update") {
        if (!this.filters.length) throw new Error("Refusing an unfiltered update");
        sql = `UPDATE ${table} SET ${Object.entries(this.records[0]).map(([column, value]) => { values.push(value); return `${identifier(column)} = $${values.length}`; }).join(", ")}${this.where(values)}`;
        if (this.returning) sql += ` RETURNING ${this.selectedColumns()}`;
      } else {
        if (!this.filters.length) throw new Error("Refusing an unfiltered delete");
        sql = `DELETE FROM ${table}${this.where(values)}`;
        if (this.returning) sql += ` RETURNING ${this.selectedColumns()}`;
      }
      const result = await connection().query(sql, values);
      const rows = result.rows as Row[];
      if (this.head) return { data: null, error: null, count: Number(rows[0]?.n ?? 0) };
      if (this.one) {
        if (rows.length !== 1) return { data: null, error: { message: `Expected one row, got ${rows.length}`, code: "PGRST116" }, count: null };
        return { data: rows[0], error: null, count: null };
      }
      return { data: this.operation === "select" || this.returning ? rows : null, error: null, count: this.exactCount ? rows.length : null };
    } catch (error) {
      const e = error as Error & { code?: string };
      return { data: null, error: { message: e.message, code: e.code }, count: null };
    }
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
}

/** Uses the existing query-chain type at call sites while replacing the transport. */
export function createClient(_url?: string, _key?: string, _options?: unknown): SupabaseClient {
  connection(); // fail early when a job was deployed without its Neon secret
  return { from: (table: string) => new Query(table) } as unknown as SupabaseClient;
}
