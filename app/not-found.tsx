import { CalmFrame } from "@/components/ui/CalmFrame";
import { SearchIcon } from "@/components/ui/icons";

/**
 * The page for an address the app does not have: a mistyped link, an old
 * bookmark, or /pulse opened by someone who is not Pulse staff (its layout
 * says not-found for them, on purpose, so the dashboard's existence is not
 * confirmed; this page is what they see, with nothing around it).
 *
 * Neutral and calm, because a patient who mistyped a link can land here as
 * easily as a staff member, and nothing to click: a patient has nowhere
 * else to go, and a staff member has the back button. The patient page
 * itself handles a link that does not exist with its own calm words
 * (app/watch/[code]); this one is for an address outside it.
 *
 * The staff surfaces have their own not-found pages, with a way back, for
 * the not-found their own pages raise (a category, a link or a clinic that
 * is not there).
 */
export default function NotFound() {
  return <CalmFrame icon={<SearchIcon className="h-8 w-8" />} heading="We couldn’t find that page" body="Please check the address you were given." />;
}
