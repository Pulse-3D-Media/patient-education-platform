# app/admin: the clinic's back office

Read `docs/areas/admin-area.md` before editing anything in this folder; it holds the map of which page does which job.

- **Every page has a fixed job.** Never move a job to another page or merge two.
- **Never put a list of past links back on the clinic side, and no plan or billing detail anywhere but `/admin/billing`.** Clinics get no reports or usage numbers.
- **Admins only, checked on the server** in every page and action (`isClinicAdmin()`); a member gets `<AdminsOnly />`. The highest-impact actions also ask Clerk live (`confirmAdminWithClerk()`, see `docs/areas/auth-and-roles.md`).
- **The clinic id comes from the session**, never from a form. A closed clinic gets `<ClinicClosed />`, except on Billing.
- People changes go through `lib/seat-changes.ts` only (see `docs/areas/seats.md`). Forms keep what was typed when a save fails.
