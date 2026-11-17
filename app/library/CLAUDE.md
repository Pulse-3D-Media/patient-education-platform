# app/library: the surgeon's exam-room surface

Read `docs/areas/library.md` before editing anything in this folder (and `docs/areas/categories.md` for categories, `docs/areas/branding-and-players.md` for the player).

- **The speed rule:** tablet-first, big targets, three taps from opening to a playing video; the watch page opens paused and starts fetching at once. Flag anything that adds a step or a delay.
- **Only what the clinic's plan allows.** Lists are filtered in the query through the access rule (`lib/access.ts`, `lib/db/access.ts`); an off-plan video's address never leaves the server.
- **Send and Show QR only for someone holding a seat**, checked again on the server.
- **No number about hearts or plays on the clinic side, and no price anywhere in the library.**
- The clinic id always comes from the session (`getCurrentClinicId()`), never from a form.
