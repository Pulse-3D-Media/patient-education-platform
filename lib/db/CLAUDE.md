# lib/db: every database query

Read `docs/areas/database-and-migrations.md` before editing here, and the area file for the feature the query belongs to (the index is at the end of the root `CLAUDE.md`).

- **Nothing outside `lib/db` touches Prisma** (rule 1).
  `client.ts` starts with `import "server-only"`; keep it.
- **Every function that touches clinic-owned data takes `clinicId` as its first argument.**
  The only public-by-code functions are the ones listed in rule 1; ask before adding another.
- **Read, decide and write in one transaction when the decision depends on the read**, with the row locks the existing writers use (`createShare()`, `changeClinicWithLog()`). Test a forced overlap for any write that matters.
- **Lists are bounded:** a limit, a page, or a count in the database.
- **Log only the kind of an error** (`errorKind()`), never its message.
