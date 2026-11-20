# The library, access to videos, and keeping things working as it fills

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## `app/library`, the exam-room surface

**`app/library` is the exam-room surface.**
A surgeon opens it mid-consult, finds the procedure, and either plays it right there on their own device or sends the patient a link.
It is used standing up, in front of a patient, under time pressure.
**It obeys the same speed rule as the patient viewer**: tablet-first, big touch targets, **browse to playing in three taps** (a card opens the video's watch page paused, and Play starts it; see the speed rule), Play and Send as **separate one-tap actions**, no dense tables.
It shows only what the clinic's plan allows (see Category entitlements).
**The home page is Netflix rows** (decided by Evan on 2026-10-15; the rules and limits are in `lib/library-rows.ts`), top to bottom, with no headline: category pills, centered at the top of the page, under the top bar with its search box at the right ("All" and the categories on the plan; a pill opens that category's page, which keeps the pills at its top with its own lit, and the search results light none); **My favorites**, the videos this person hearted, newest heart first, as bigger cards, or one quiet line, "Tap the heart on any video to keep it here."; **Most watched**, this person's own most-played videos across every category, up to 10, shown once they have played at least 3 different ones; one row per category on the plan with its newest 5 videos and a "View category" link (a category on the plan with nothing to show says so in one quiet line); then the closed "More categories" section below.
Rows scroll sideways by swipe, with arrow buttons on a computer; no hover previews; thumbnails off the screen load only when scrolled near.
**A card opens the video's watch page**, `/library/watch/<videoId>`, laid out like YouTube (decided by Evan on 2026-10-15; `app/library/watch/[videoId]/`): the video top left and, on a tablet held sideways or a computer (the `side-by-side:` variant in `app/globals.css`: at least 1024px wide and in landscape), a right column, "More in <category>", that scrolls on its own and lists only the other videos in that category this clinic may use (read through the access rule in the query, `listMoreInCategory()`, at most `MORE_IN_CATEGORY_LIMIT`); on a phone or a tablet held upright the column is under the video.
Under the video: the title; a channel line like YouTube's, the category's tile image in a round frame (its first letter when there is no image or it will not load) with the category's name, the whole of it a link to the category's page; the length and the placeholder mark; then one row of buttons, **Favorite**, **Send to patient** (the Send panel) and **Show QR on screen** (makes the link exactly as Send does and shows its QR code as large as the screen allows, on white, for the patient to scan in the room), the last two only for someone holding a seat, and a fourth, **Chapters**, only when the video has chapters (below).
A back arrow returns to where the surgeon came from (the browser's back while the tab has a library page behind it, else the video's category).
**The video opens PAUSED and waits for a Play tap** (decided by Evan on 2026-10-15: a surgeon may open it while still talking to the patient), with one big Play button and the clinic's mark until then; it starts fetching at once so the tap is quick.
The player is the shared Vimeo-style one, with its own full screen.
**Chapters** (decided by Evan on 2026-10-15; `lib/chapters.ts`, read its top comment first): Pulse staff type a video's chapters on its page at `/pulse/videos`, one line each, a start time like "1:03" and a title.
The first starts at 0:00; times are whole seconds, all different, and before the video's length when it is known; titles are 1 to 40 characters on one line; at most 20; lines may be typed in any order and are saved sorted by time; removing every line clears them.
One pure parser (`parseChapterLines()`) is asked by the form before it is sent and by the server again, and a refusal is one plain sentence with every line kept.
A form drawn before someone else's save keeps the row's chapters when its own lines were left as it showed them (`shownChapters`, like the shown Mux fields).
On the watch page, the Chapters button opens the Chapters panel at the TOP of the right column and pushes "More in" down, like YouTube's (on a phone or an upright tablet, where that column is under the video, it opens in the same place, just under the buttons), with a close button; it lists each chapter's start and name, lights the one playing, and a tap jumps there, playing on if the video was playing and staying paused if it was paused.
The progress bar carries a small gap at each chapter start and the current chapter's name beside the time.
A video with no chapters has no button and no panel, and a damaged column reads as none.
**Chapters are for the library only: the patient page never shows them.**
No Transcript button until there is something behind it.
The address carries the video's id and nothing else: the page shows a video only when `getUsableVideo()` (the access rule in the query) and `playbackForLibraryVideo()` (`canUseVideo()` first) both say this clinic may use it, and anything else (off the plan, unpublished, a hidden placeholder, made up, junk) is the staff not-found page with nothing playable sent.
**Favorites and plays are per person** (`PersonalVideo`, written only by `lib/db/personal-videos.ts`): anyone in an open clinic who can browse may heart a video, on its card and on its watch page; the heart says what it wants ("a favorite" or not, never "flip it"), so a repeat is harmless, and the clinic and person come from the session, never the form.
A library play is counted once per opening of the watch page, at the first real "playing" event (so never before Play is tapped, and never again for a pause and a replay), into `playCount` and `lastPlayedAt`.
**No number about hearts or plays is ever shown on the clinic side**, and they are not in the Pulse reports either; they only order "Most watched".
Every row is read through the access rule in the query, so a favorite whose category left the plan is hidden, not deleted, and is back if the category returns.
**What the clinic bought comes first** (Van, 2026-09-21): the rows are the categories on the plan; a category off the plan that has something in it is one row of its own (padlock, name, then "Not on your plan" or the link below) in a one-column list under a closed "More categories" section (decided at the 2026-10-08 huddle: set side by side, the names read as a line of blue links and were skimmed past), and its own page is a locked page, never a list of videos; a category off the plan with nothing in it yet is not on the home page at all.
**A locked category that is for sale carries one small link, "Add to your plan"** (Van's idea, approved by Evan on 2026-10-02), on its line and on its own page: for an office admin it opens `/admin/billing?add=<slug>` with that category already ticked in the plan form, beside the plan the clinic has and nothing else (Van, 2026-10-08: anything more feels like being talked into more; see "Plan changes and billing recovery" for which plan that is); a member is told to ask an office admin and gets no link; a category that is not for sale offers nothing.
The link changes nothing by itself: the category in the address is only a suggestion for which box starts ticked (`lib/add-to-plan.ts`; a forged, unknown, unbuyable or already-owned one is ignored), the server prices and decides as always, and the category stays locked until the change is paid and confirmed.
A clinic that cannot change its plan by card lands on the words Billing already has for its case.
No price is ever shown in the library.
Everyone in the clinic can browse and play; **only someone holding a seat gets Send**, and a link they send is from them automatically, with no picker (the page hides the button from everyone else, and the action checks the seat again).
Someone without a seat gets one line under the videos instead (`NoSeatNote`, chosen by `noSeatHelp()` in `lib/seats.ts`; decided by the user on 2026-11-16, audit C3): the account owner with a seat free gets a **Take a seat** button, any other office admin (or the owner when none is free) a link to People, and a member the old "ask your clinic's office admin".
A plan with no categories says so, and an office admin also gets a **Go to Billing** link.
**"Finish setup" in the menu** (the approved design, screens 06-library-reminder and 06-library-collapsed): an office admin sees a card under Home in the full menu and a clock in the narrow rail until nothing in setup is left undone (`setupReminder()` in `lib/setup.ts`, decided 2026-11-19 after Evan's walkthrough).
While the steps are under way it says "Finish setup", a bar and "1 of 4 done", and opens setup at the step the clinic is on; once the last step is passed with something skipped, it names what is left ("Add your logo") and opens that step.
A step counts as done when its Continue (or Finish) was pressed, with whatever was saved; "Skip for now" is the only thing that leaves a step undone, apart from a logo upload that failed.
Members never see it, and a clinic made before setup never shows it.
Every setup save redraws the library's frame (`revalidatePath("/library", "layout")`), because the browser keeps a layout between pages and the card once went on showing an older count.
It is drawn from the clinic row the shell already reads (`Clinic.setupStep`, `setupDone`), so it costs no extra request and adds nothing to playing a video.
**The menu folds to icons and stays as it was left:** on a wide screen the menu button switches between the full menu and the narrow rail, and the choice is remembered in that browser (local storage, nothing on the server); a tablet keeps the rail with the full menu sliding out over the page, and a phone slides it out.

## Category entitlements

A clinic can browse, play and issue new links only for the videos its current access permits.
The rule is one pure function, `decideVideoAccess()` in `lib/access.ts`, and access requires all four of: the clinic is open (`clinicIsOpen`), the video is published, the video's category is on the clinic's plan (`Clinic.categories`), and, for a placeholder, the clinic is shown placeholders (`Clinic.showPlaceholders`).
`managedByPulse` plays no part: it says who manages billing, so a managed clinic that is paused is closed and a managed clinic with no categories has none.
Whether a category is for sale plays no part either: `listSellableCategories()` governs new purchases, and a category already on the plan stays usable when it comes off sale.

- **A category added on `/pulse/videos` (K3) follows the same rule.**
  It is entitled by being on a clinic's plan: bought (on its own, or as part of the full library, which includes every category), or put there by Pulse staff by hand.
  It is Coming soon until a video in it is published.
  **A clinic paying for the full library gets each new category automatically**: `includeInFullLibraries()` in `lib/db/clinics.ts` adds it to every such clinic's `Clinic.categories` right after it is added, each with a clinic log entry under "billing" (never to a clinic Pulse manages, which keeps the plan staff gave it); and every look at Stripe (`reconcileSubscription()`) gives a clinic whose plan in force is the full library every category there is, so a clinic that was missed is put right at its next notification or Check with Stripe.
- **The categories on the plan are the effective category set.**
  `Clinic.categories` is what the rule reads.
  When a self-serve clinic's first payment is confirmed, billing writes the accepted plan's entitled set (`entitledCategories` from the pricing engine, every category when the full library is bought) into `Clinic.categories`, so the rule needed no change for checkout.
- **The reads live in `lib/db/access.ts`.**
  `getClinicAccess(clinicId)` reads the clinic once (status, plan, placeholder setting); pages call it once per request and decide for everything they list in memory, never once per card.
  `canUseVideo(clinicId, videoId)` answers for one video with the reason when the answer is no.
  The clinic id always comes from `getCurrentClinicId()`, never from the browser; a clinic id in a form is ignored, so a forged one cannot borrow another clinic's plan.
- **`createShare()` is the guarded write, and the check and the write are one moment.**
  Inside one transaction it reads the clinic and the video with a share lock (`lockClinicAccess()` and `lockVideoFacts()` in `lib/db/access.ts`, plain SQL with `FOR SHARE`, because Prisma's query builder cannot ask for a row lock), asks the rule, and throws a `ShareRefusedError` with a plain message (from `accessRefusalMessage()`) when the answer is no, writing nothing.
  The locks hold both rows against change until the transaction ends, so a plan removal, a pause, a placeholder-setting change or an unpublish that arrives while a link is being made either waits for the link to commit (and then applies, leaving the issued link usable, as issued links always are) or landed first and is seen by the locked read.
  Two links being made at once for the same clinic do not block each other.
  Both share-creating actions (the admin's Create link and the library's Send button) land there, so a hidden button or a filtered list is never the only thing standing between a clinic and a link, and a form drawn before a plan change is refused when it is sent.
- **The lists are filtered in the query, not after.**
  `listUsableVideosInCategory()` (the category page, and with a limit the home page's rows), `listUsableVideos()` (the `/admin/links` procedure picker), and `listFavoriteVideos()` and `listMostWatchedVideos()` in `lib/db/personal-videos.ts`, and `searchUsableVideos()` (the search box in the top bar; `%` and `_` are escaped so they are read as themselves), and `getUsableVideo()` and `listMoreInCategory()` (the watch page's video and its "More in" list) (through the relation to Video, with the same `usableClause()`) apply the same four conditions in the database, so an off-plan video's address never leaves the server.
  The library home and the category page decide their state with `categoryState()` from `countPublishedVideosByKind()`, one query for every category.
- **Issued patient links are not governed by this.**
  See "Nothing breaks while the library fills up": a link keeps working after its category leaves the plan, after a payment lapse or a pause, until its own expiry, its cancellation, or the video being unpublished.
  `app/watch` and its first-play handler read no clinic plan, on purpose.
  A printed QR code is checked at the moment it hands out a new link, by the same rule, in `issueShareFromQrCode()` (lib/db/shares.ts), which locks the clinic, the code and the video just as `createShare()` does.
  Turning a paused link back on (`renewShareForClinic()`) is checked by the same rule as well, because it gives the patient new time (decided by Evan on 2026-10-08; see "How a link expires, pauses, and is turned back on").

## Nothing breaks while the library fills up

Finished animations arrive slowly and placeholders stand in until they do, while clinics use the app the whole time.
Every change has to be safe to ship with the library half full.

- **A migration only adds.**
  Every new column has a default or is optional.
  Never delete or rename.
- **Anything shown to a person has a fallback for when its data is missing.**
  No logo: show the clinic name.
  No poster: the branded fallback (or, for a Mux video, its signed still).
  No Mux id: the CDN file.
  Neither (a video whose upload has not finished): the player's calm "did not load" panel, and the form will not let it be published.
  A Mux id that cannot be signed (no key on this deployment): the same calm panel, and never the CDN file, because that video was moved to protected playback on purpose.
- **The catalogue is edited at `/pulse/videos`; the seed scripts are for a fresh database only.**
  Adding a video, publishing it, replacing a placeholder with the finished file, setting a poster, typing its chapters: all of it happens on that page, through `createVideo()` and `updateVideo()` in `lib/db/videos.ts`.
  `prisma/seed-video.ts` and `prisma/seed-placeholders.ts` still work and are **create-only**: a video that already has one of their titles in its category is reported and left exactly as it is, address, length and published flag included, so a rerun can never publish again a video that was unpublished to withdraw it.

- **Category names, categories as text, and adding or deleting a category** are in `docs/areas/categories.md`.

- **Replacing an animation is an edit to the same `Video` row, never a new row**, so every Share and every QR code that points at it keeps working.
  Moving it to Mux is the same kind of edit (its signed playback id lands on the row, written by the upload flow when Mux says the new asset is ready, or pasted by hand; see "The video boundary"), and so is moving it back (clear the id, for a video that still has a CDN address to go back to).
- **Unpublishing a video is the one control for withdrawing content, and it stops every link to it, old ones included**: the patient page shows the calm "not available right now" page, views are not counted, `createShare()` refuses new links, and the overview's newest links say "Not working".
  Publishing it again makes them all work again.
  Nothing else withdraws a video that has already been sent.
  Unticking Published on `/pulse/videos/[id]` asks for a yes that says how many links stop right now, and the change goes in the server log under the staff member's name (see "Guard rails against a slip").
- **Patient links already issued outlive the clinic-side changes around them.**
  Taking a category off a clinic's plan, pausing or closing the clinic, running out of seats, or a category no longer being for sale: none of these cancels a link a patient already has.
  An issued link follows its own rules only: its expiry, or the video being unpublished.
  (Once a played link has PAUSED, turning it back on gives it new time, so that follows the plan like making a link: see "How a link expires, pauses, and is turned back on".)
  (Clinics could cancel a link until the list of past links was removed; the clinic side no longer offers it. `deleteShareForClinic()` in `lib/db/shares.ts` stays, unused, for whenever a way to withdraw one link is decided.)
  (The patient page does not check the clinic's status, on purpose.)
  This policy changes only when a prompt says so in as many words, and any page copy that suggests otherwise is wrong and should be fixed to match.
- **Sale eligibility is about new purchases.**
  Turning a category's `sellable` switch off, or it having no published video, changes what a new plan may include.
  It never silently removes a category from a clinic that already has it.
- **A library category is in one of four states for a clinic, decided by `categoryState()` in `lib/access.ts`, and the home page and the category's own page always agree.**
  The home page puts the categories on the plan first, as rows, and the rest below (`app/library/page.tsx`; layout only, the rule is unchanged).
  A category with no published video at all is **Coming soon** (a row with one quiet line and no "View category" when it is on the plan, left off the home page when it is not, the same message on its own page, and the category is not offered for sale; the sentence is the category's `comingSoonText` from `CategoryConfig`, or the default).
  A category with published content that is not on the clinic's plan is **Locked** (one row with a padlock, in a one-column list under the home page's closed "More categories" section, saying "Not on your plan" or, for an office admin when the category is for sale, carrying the "Add to your plan" link to Billing; the same on its own page; and nothing playable sent to the browser, even when the address is typed).
  A category on the plan whose only published videos are placeholders this clinic is not shown is **Nothing yet** (an honest empty state, not "coming soon").
  Otherwise it is available: a row of its newest videos and "View category".
  A category is offered for sale only while its `sellable` switch is on; `listSellableCategories()` in `lib/db/category-config.ts` is the one list billing and the plan screens should offer, and whether a category is for sale plays no part in the four states.
- **A placeholder video carries its mark everywhere it appears**: the library card, the player, the Send result, the printed pamphlet, the patient page, the admin lists, and any surface added later.
  Swapping in the real file is an edit to the same row, never a new row, so share links and QR codes keep working.
  Unticking "Placeholder" on `/pulse/videos` asks for a yes first, because links already sent start playing the new file at once.
- **A video with a `posterUrl` shows it on the library card**; without one, the card shows the video's own first frame, and the branded fallback if that cannot load.
- **Settings come from `getSettings()` in `lib/db/settings.ts`, never constants.**
  Expiry days and limits are one AppSettings row, read at request time.
  Prices are not settings: they are pricing versions, read through `getActivePricing()` (see Pricing shape).
  `getSettings()` returns the code defaults when the row does not exist, so nothing depends on it having been saved.
  A clinic can carry its own override for a setting (`Clinic.viewDaysOverride` today); read the clinic's value first, then the platform's.
  Never put one of these numbers in a page or a constant.
  The expiry numbers are read when a link is made and copied onto it (`getShareTerms()` and `createShare()` in `lib/db/shares.ts` resolve them the same way), so a settings edit changes links made from then on and never a link a patient already has; see "How a link expires".
  **A save and a link being made never cross:** `createShare()` reads the settings inside its own transaction through `lockSettings()`, which holds the settings lock shared, and `saveSettings()` takes the same lock exclusively, so a save either landed before the link read the settings or waits until the link is written.
  Any future write to the settings row goes through `saveSettings()` for that reason.
  **The one setting that is deliberately not copied onto a link is `maxRenewals`**: how many times a paused link may be turned back on is read at the moment it is needed, so a change applies to every link at once, links already sent included (decided by Evan on 2026-09-25; see "How a link expires, pauses, and is turned back on").
- **Access is decided in one function each, on the server, and every mutation rechecks it.**
  Whether a clinic may use the app at all: `clinicIsOpen(clinic)` in `lib/clinic-status.ts`, which reads the clinic's status and its grace deadline: ACTIVE is open, PAST_DUE is open until the exact moment `graceEndsAt` (and closed when no deadline is stored), everything else is closed.
  The library, `createShare()` and a printed code's `issueShareFromQrCode()` all reach it (the last two through the access rule), so they cannot disagree.
  Whether a person is an admin: `isClinicAdmin()`. What a clinic may use, and whether it may use one video: `getClinicAccess()` and `canUseVideo()` in `lib/db/access.ts`, both answering with the rule in `lib/access.ts` (see Category entitlements).
  Whether someone can open `/pulse`: `isPulseStaff()`. Pages call these and never re-implement any check, and a Server Action calls the same function again rather than trusting that the page did.

**Placeholder videos.**
A video with `isPlaceholder` true carries a real procedure name but plays a sample animation, so the library can be tested before the finished animations exist.
This is not the same as unpublished: placeholders are visible on purpose.
The app marks them everywhere they appear: an amber "Placeholder" mark on the library card, in the player and beside the length on the watch page (and on its "More in" list), across the top of the patient page, and in the admin lists.
The Send panel carries the selected video's placeholder mark, and so does the printed pamphlet (in black and white, so it survives any printer).
**If you show a video somewhere new, carry the mark with it.**
Placeholders are added, edited and replaced on `/pulse/videos` like any other video; `prisma/seed-placeholders.ts` only fills a fresh database, and `prisma/seed-video.ts` (the first real animation) never touches them.
