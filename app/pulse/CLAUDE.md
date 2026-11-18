# app/pulse: the Pulse 3D master dashboard

Read `docs/areas/pulse-dashboard-and-reports.md` before editing anything in this folder.

- **Pulse staff only.** Every page and every Server Action calls `requirePulseStaff()` first; anyone else gets not-found, never a redirect or a message.
- **Nothing here is visible to clinics**, and no page is shared with `app/admin`.
- **Every change saved on a clinic is logged** through `changeClinicWithLog()` (`lib/db/clinics.ts`): the change and its entry in one transaction.
- **Every form with boxes goes through `useKeptForm()`** (`FormBits.tsx`), so a failed save keeps what was typed.
- **A save that reaches every clinic or link asks first** through `useConfirmedSubmit()` (`ConfirmPopup.tsx`), and a Pulse-wide change goes in the server log under the staff member's name. No link code on any page here. See "Guard rails against a slip".
- **Long lists are paged or capped** (`lib/paging.ts`). Reports count links and play starts, never people.
