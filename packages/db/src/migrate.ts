import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

/**
 * Applies the SQL files in `migrations/`, in name order, once each.
 *
 * Plain SQL and a fifty-line runner rather than a migration framework. There
 * are three tables; a framework here would be more configuration than the
 * thing it configures, and SQL is what anyone debugging the database will be
 * reading anyway.
 *
 * Run: pnpm --filter @crossscreen/db migrate
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('DATABASE_URL is not set.\n');
  console.error('  postgres://user:password@localhost:5432/crossscreen');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

await sql`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

const applied = new Set(
  (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
);

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

let count = 0;
for (const name of files) {
  if (applied.has(name)) continue;

  const statements = readFileSync(join(migrationsDir, name), 'utf8');
  // Each migration and its bookkeeping in one transaction, so a failure
  // halfway through cannot leave a file recorded as applied when it is not.
  await sql.begin(async (tx) => {
    await tx.unsafe(statements);
    await tx`INSERT INTO schema_migrations ${tx({ name }, 'name')}`;
  });

  console.log(`applied ${name}`);
  count += 1;
}

console.log(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`);
await sql.end();
