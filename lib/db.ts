import { Pool } from "pg";

/**
 * Optional Postgres persistence. With DATABASE_URL set, the whole app state is
 * kept as one JSON document (this is a single-user app). Without it, state
 * lives in memory only, which is fine for local development.
 */
const g = globalThis as unknown as { __leashPool?: Pool };

function pool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!g.__leashPool) {
    // Render's internal URLs don't use SSL; external ones (*.render.com) require it.
    const ssl = /\.render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
    g.__leashPool = new Pool({ connectionString: url, ssl, max: 3 });
  }
  return g.__leashPool;
}

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

let tableReady: Promise<unknown> | null = null;
function ensureTable(p: Pool) {
  tableReady ??= p
    .query(
      `create table if not exists leash_state (
         id text primary key,
         data jsonb not null,
         updated_at timestamptz not null default now()
       )`,
    )
    .catch((e) => {
      tableReady = null;
      throw e;
    });
  return tableReady;
}

export async function loadDoc(): Promise<unknown | null> {
  const p = pool();
  if (!p) return null;
  await ensureTable(p);
  const r = await p.query("select data from leash_state where id = 'main'");
  return r.rows[0]?.data ?? null;
}

export async function saveDoc(data: unknown): Promise<void> {
  const p = pool();
  if (!p) return;
  await ensureTable(p);
  await p.query(
    `insert into leash_state (id, data, updated_at) values ('main', $1, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(data)],
  );
}
