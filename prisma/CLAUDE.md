# prisma: schema, migrations and operator scripts

Read `docs/areas/database-and-migrations.md` before editing anything here.

- **Never change `schema.prisma` unless explicitly asked** (rule 3). An approved change only adds; never rename or delete a field.
- **Never run `migrate dev`, `migrate reset` or `db push` against the main checkout's `.env`, which is production.** Write the migration with `prisma migrate diff`, and apply it to the testing database with `migrate deploy`.
- **Production is migrated only on Evan's explicit word**, right before the merge, with `npx prisma migrate deploy`. An applied migration is never edited or deleted.
- **Every operator script calls `preflight()` first** and refuses production without `--production`; a script that loads `lib/db` runs with `--conditions=react-server`.
- The seed scripts are create-only, for a fresh database.
