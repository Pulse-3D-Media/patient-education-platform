# Pricing

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## Pricing shape

Pricing is a **ladder by number of categories, per surgeon seat**: one monthly price per seat for one category, another for two, and so on, whichever categories they are (defaults $59 / $89 / $109 / $125 / $139 for one to five).
A clinic is charged the ladder price for the number of categories it takes, times its surgeon seats; a year is charged as a set number of months.
Office staff are never charged.
**Decided by Evan on 2026-09-11 (the record is at the top of `lib/pricing.test.ts`): the rounded ladder is the product, to the cent.**
There are no per-category prices: a count-based price makes the identity of the categories irrelevant, and a price of a category's own would be a second pricing mode to decide on before it is built.
**The ladder never goes down** (decided by Evan on 2026-09-12): each rung is at least the rung before it, equal rungs allowed, and `validatePricingConfig()` refuses a ladder that breaks this, so it can be neither saved nor activated.
The numbers are placeholders to edit on `/pulse/pricing`; the model is settled.

- **The engine is `lib/pricing.ts`**, pure and safe for the browser.
  `quote(config, input)` returns exact whole cents.
  The one rounding is the per-seat amount for the interval, after the founding offer if there is one, and the total is that times the seats; Stripe will be given that per-seat amount as the unit price.
  The monthly equivalent of a yearly price is for display only and is never charged.
- **The numbers live in `PricingVersion` rows, never in code.**
  `getActivePricing()` in `lib/db/pricing.ts` is the only way to read them, and `getPricingForClinic(clinicId)` uses the clinic's pin when it has one.
  With no active version it returns `DEFAULT_PRICING_CONFIG` marked as an estimate; checkout refuses an estimate and insists on a saved, active version, so nothing is for sale until Pulse staff have made one active.
  Never write a price literal anywhere but those defaults.
- **The full library** (taking `fullLibraryFrom` categories, 5 by default) is charged at that count's ladder price and includes every category.
  It is only offered while every category is for sale; otherwise a clinic taking that many pays that count's price for, and gets, just those, and the quote says so.
  `selectedCategories`, `chargedCount` with `chargedCategories`, and `entitledCategories` are separate things and stay that way.
- **The full library grows with the library (Option A, decided by Evan on 2026-10-26).**
  Every quote is handed the library as it is now (`QuoteInput.library`, from `libraryForQuote()` in `lib/db/category-config.ts`: every category that exists, and which are Coming soon), so a category added on `/pulse/videos` can be bought on its own like any other, counted on the ladder, and the full library (5 or more, the threshold unchanged) includes every category there is, added ones and Coming soon ones too, at the same price.
  **A Coming soon category does not hold the full library back** (also decided that day): it is included and opens up once a video in it is published; a category Pulse staff switched off sale on purpose still keeps the full library off sale, as before.
  **A plan bought as the full library remembers it** (`BillingPlan.fullLibrary`, migration `20261026144353_add_billing_plan_full_library`, approved that day), so it includes categories added after it was bought: `includedNow()` in `lib/db/billing.ts` reads every such plan (`getCheckoutFacts()`, `getClinicBilling()`) as including every category there is today, while the stored `entitledCategories` keep what it included the day it was accepted, as history.
  Nothing is ever charged differently: the full library's price does not depend on how many categories there are.
  **A count past the end of the ladder** (more categories than the six prices, which only happens with the full-library threshold turned off) is charged the top price (decided that day).
  Without a library, the engine is exactly what it was: the six starting categories.
  Stripe descriptions still use the starting names (see "A category's name").
- **Solo, Clinic and Enterprise** come from the seat limits on the config (defaults 1 and 10) and the practice type the quote is asked with.
  A hospital is always Enterprise, with no self-serve amount; it is never guessed from a name, and it is never asked: only Pulse staff mark one.
- **The founding offer is 0 by default, and checkout never applies one.**
  A number modelled on the calculator is not an offer to a customer.
  A real one needs a written rule for who qualifies and for how long.
  Until that rule is approved and built, checkout always quotes with `founding: false`, whatever the active version's number is; the picker is not even sent that number; and nothing a browser sends can ask for it.
  When a rule exists, the accepted plan gains a column recording the terms (additive, 0 for every earlier plan, which is the truth), and if Stripe coupons carry it they are keyed by those immutable terms, never one coupon id edited in place.
- `listSellableCategories()` decides what a NEW purchase may include.
  It never removes a category a clinic already has; Pulse staff can grant one early on the clinic's Plan form, where a category that cannot be bought is labelled Not for sale or Coming soon.
- **A quote shown to a clinic is recomputed on the server** from the clinic's own plan and the pricing version the server chooses (rule 8).
  Nothing the browser sends decides a price.

**Clinic plan.**
`Clinic.categories` and `Clinic.surgeonSeats` are the plan.
Set on `/pulse` or with `npm run db:set-plan -- <clinicId> --categories all --seats 10`.
The categories are enforced: they decide what the library shows and what `createShare()` allows (see Category entitlements).
The seats are enforced too: they are how many people may hold a surgeon seat, and lowering them below the number in use needs an explicit override (see Surgeon seats).
On the clinic side the plan is shown in one place, `/admin/billing`, read through `getClinicPlan()` (categories, seats, managed by Pulse, and nothing internal).
Do not put plan or pricing information on `/admin` (the overview) or `/admin/links`.

**Pricing versions.**
Saving on `/pulse/pricing` adds a `PricingVersion` row; nothing ever edits one.
Making a version active is the only update the table sees, done in one transaction under the unique constraint on `active`, so two activations at once still end with one active version.
The page asks before it does so (the confirmation names the version and says that new quotes and unpinned clinics move to it); that is a courtesy, and the server gate plus the constraint are the protection.
The history list is bounded, so the page hands the editor the active config on its own, from `getActivePricing()`, never by looking for it in the list: the editor must open on the version the page says is active.
A stored config that fails `validatePricingConfig()` (a hand edit in Neon) cannot be activated, and reading it as the active or a pinned version is a loud `PricingError`, never a quiet switch to other prices.
A clinic's pin (`Clinic.pricingVersionId`) is set by billing, when a self-serve clinic's first payment is confirmed (from the accepted plan); nothing on `/pulse` sets one.
