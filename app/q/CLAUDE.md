# app/q: a printed QR code's page

Read `docs/areas/printed-qr-codes.md` before editing anything in this folder, and `docs/areas/patient-page.md` for the page it shares with `app/watch`.

- **Opening the page makes nothing.** Only the Play tap (POST `/q/<code>/issue`) makes the visit's own link; the accept route writes nothing.
- **A retry never makes a second link:** the link's code comes from the code's row id and the visit's key.
- **Every tap is checked on the server, under locks** (`issueShareFromQrCode()`), the daily limit included. Every refusal shows the same calm page.
- **The printed code is a secret like a key:** never in a log, a file name or an admin address.
- **The production address is fixed** (`PERMANENT_QR_ORIGIN`); changing it breaks every code ever printed. Only on Evan's say-so.
- No Server Actions here: routes only, never cached, `noindex`.
