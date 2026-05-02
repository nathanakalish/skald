# Database migrations

Skald is still pre-1.0; the dev workflow expects to wipe `data/skald.db`
between schema changes. The full schema is therefore expressed as a single
**idempotent baseline** in `src/lib/db/baselineMigrations.ts`, which runs at
every boot and uses `CREATE TABLE IF NOT EXISTS` / `PRAGMA table_info` guards
so it's safe to re-run on an existing dev DB.

This folder is kept around for the `runMigrations()` runner in
`src/lib/db/migrate.ts` — once 1.0 ships and we need a forward-only upgrade
path between versions, drop new `NNNN_description.sql` files in here and they
will be applied in lexicographic order, tracked in the `_migrations` table.

Until then: schema changes go in `baselineMigrations.ts`, and the matching
column / table needs to land in `src/lib/db/schema.ts` so drizzle stays in
sync.
