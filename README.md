# Patient Education Platform

Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link. The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link expires after a set number of days. No account, no app to install.

Built by [Pulse 3D Media](https://www.pulse3dmedia.com).

## Status

**Phase 1, in development.** Create a link, watch a video, link expires. Logins, clinic management and billing come later.

## Three surfaces

| Route | Who it is for |
|---|---|
| `/watch/[code]` | The patient, on their own phone. No login, ever. |
| `/library` | The surgeon, mid-consult. Browse and play on a tablet. |
| `/admin` | The office manager. Create share links and QR codes. |

## Stack

Next.js (App Router) and TypeScript on Vercel, Postgres on Neon, Prisma for data access, Tailwind for styling.

## Running it locally

```bash
npm install
cp .env.example .env     # then fill in the values
npx prisma migrate dev   # set up the database tables
npm run dev
```

`.env.example` lists the variables you need. Real values never go in this repository.

## Conventions

`CLAUDE.md` in the root holds the project rules and is the single source of truth for how this is built. Read it before changing anything.

Two worth knowing up front:

- **No patient-identifying information is ever stored.** A share link is tied to a procedure and a clinic, never to a person.
- **All database access happens on the server, through `lib/db`.** Pages never call Prisma directly.
