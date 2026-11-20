import { headers } from "next/headers";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { labelOf } from "@/lib/categories";
import { getCategoryList } from "@/lib/db/category-config";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { ShareTermsError, type ShareTerms } from "@/lib/expiry";
import { getClinicAccess } from "@/lib/db/access";
import { listLiveQrCodesForClinic } from "@/lib/db/qr-codes";
import { getShareTerms } from "@/lib/db/shares";
import { listUsableVideos } from "@/lib/db/videos";
import { errorKind } from "@/lib/error-kind";
import { qrOriginFor } from "@/lib/qr-code";
import { listSenders, type Sender } from "@/lib/senders";
import { AdminFrame } from "../AdminFrame";
import { DetailHeader, Facts, Rule, shortDate } from "../DetailParts";
import { SplitView, type SplitItem } from "../SplitView";
import { LINKS_TAB_HREF, readLinksTab, type LinksTab } from "./links-tab";
import { CodeActions, NewCodeForm, NewLinkForm, type ProcedureChoice } from "./LinkForms";

/**
 * Shared links, at /admin/links: where the office makes a link for a
 * patient, and keeps its printed QR codes (the approved design, screen 09).
 *
 * Two equal tabs across the top (Evan, 2026-11-20), each a real link with
 * the tab in the address (?tab=qr), so a refresh, the Back button and a page
 * without scripts all behave:
 *
 *   - TEMPORARY PATIENT LINK, open first: pick a procedure and the doctor it is
 *     from (nothing picked in advance, decided by Evan on 2026-09-25), press
 *     Create link, and the link appears with its QR code and Copy, QR on
 *     screen, Print (the pamphlet, /admin/print/<code>) and Download
 *     (/admin/qr/<code>). The procedures are the videos this clinic may share
 *     (published, in a category on its plan, placeholders only while the
 *     clinic is shown them), by the same rule createShare() applies.
 *   - PERMANENT QR CODE: the clinic's live printed codes (Prompt 9) as a list
 *     with the chosen code's detail beside it (SplitView): Print, Download,
 *     Replace and Retire. "+ New code" at the top makes one. Bounded: at most
 *     a hundred are read (listLiveQrCodesForClinic), and the list says so
 *     when there are more. An address that names a code (?code=<id>, which
 *     the overview links to) opens this tab.
 *
 * THERE IS NO LIST OF PAST LINKS, on purpose (Evan's build plan of
 * 2026-09-21, Prompt 4): the app does not know which patient got which link,
 * so the office never needs to find one again. A printed code is the
 * exception because it has to be retirable; it is a code, not a patient link.
 *
 * How long a link works is said in the words it is made with: the page reads
 * the clinic's share terms (getShareTerms) from the same settings
 * createShare copies onto a new link.
 *
 * Admins only (org:admin, see lib/roles.ts), and only for an open clinic.
 * The Server Actions behind every button check both again.
 */
export const dynamic = "force-dynamic";

type LinksProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function LinksPage(props: LinksProps = {}) {
  // Signed out, or no clinic: sent to the right step (proxy.ts already sends
  // signed-out visitors away, but every page reading protected data keeps its own check).
  const clinic = await requireClinicPage();

  // A member, not an admin: say so. This is the check that counts.
  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // A clinic that is not open (not on a plan yet): no links can be made.
  // The frame and its navigation stay, so Billing is one tap away.
  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="Shared links">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  const access = await getClinicAccess(clinic.id);
  // The address every link on this page starts with. Null only on a deployment that does not know its own address.
  const where = qrOriginFor((await headers()).get("host"), process.env);
  const [videos, terms, senders, printed, list, params] = await Promise.all([
    access ? listUsableVideos(access) : [],
    readShareTerms(clinic.id),
    readSenders(clinic.id),
    listLiveQrCodesForClinic(clinic.id),
    getCategoryList(),
    props.searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

  const procedures: ProcedureChoice[] = videos.map((video) => ({
    id: video.id,
    title: video.title,
    categoryLabel: labelOf(list, video.category),
    isPlaceholder: video.isPlaceholder,
  }));

  // Why nothing can be made right now, if that is so. The forms say it when their button is pressed, and the detail says it up front.
  const blocked =
    terms === null
      ? TERMS_PROBLEM
      : where === null
        ? ADDRESS_PROBLEM
        : senders === null
          ? "We could not read your clinic's people just now. Reload this page in a moment."
          : senders.length === 0
            ? "Nobody in your clinic holds a seat yet. Give someone a seat on People first."
            : procedures.length === 0
              ? !access || access.categories.length === 0
                ? "No procedures to list yet: your clinic's plan has no categories on it. See Billing."
                : "Nothing to list right now: the categories on your clinic's plan have no animations you can share yet."
              : null;

  const choices = { procedures, senders: senders ?? [], blocked };
  const now = new Date();
  const days = terms ? `${terms.daysAfterFirstPlay} ${terms.daysAfterFirstPlay === 1 ? "day" : "days"}` : null;


  const codes: SplitItem[] = printed.rows.map((code) => {
    const needsLook = !code.surgeonSeated || !code.isPublished;
    return {
      key: `code-${code.id}`,
      dot: needsLook,
      title: code.videoTitle,
      sub: `${code.surgeonName ?? "No surgeon name"} · ${needsLook ? "needs a look" : "stays up"}`,
      meta: shortDate(code.createdAt, now),
      detail: (
        <>
          <DetailHeader
            title={
              <span className="inline-flex flex-wrap items-center gap-3">
                {code.videoTitle}
                {code.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
              </span>
            }
            sub="Printed code. Every patient who scans it gets a link of their own."
          />
          <div className="mt-8 flex max-w-2xl flex-col gap-6 sm:flex-row sm:items-start">
            <div className="shrink-0 self-start rounded-lg border border-line bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
              <img src={`/admin/qr-codes/${code.id}/image`} alt="" width={128} height={128} className="h-32 w-32" />
            </div>
            <div className="min-w-0 flex-1">
              <Facts
                rows={[
                  { label: "From", value: code.surgeonName ?? "No surgeon name set" },
                  { label: "Made", value: code.createdAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver" }) },
                ]}
              />
              {!code.surgeonSeated && (
                <p className="mt-4 text-[15px] text-warn">
                  {code.surgeonName ?? "This surgeon"} no longer holds a seat. The code still works, but the links it gives patients now name only the clinic. Retire it, and make a new one from a
                  surgeon who holds a seat.
                </p>
              )}
              {!code.isPublished && <p className="mt-4 text-[15px] text-warn">This video is not available right now, so the code gives patients nothing until it is back.</p>}
            </div>
          </div>
          <Rule />
          <CodeActions id={code.id} title={code.videoTitle} surgeonName={code.surgeonName} surgeonSeated={code.surgeonSeated} />
        </>
      ),
    };
  });

  const asked = typeof params.code === "string" ? `code-${params.code}` : typeof params.item === "string" ? params.item : null;
  const tab = readLinksTab(params);

  const newCode = (
    <>
      <DetailHeader title="New printed code" sub="For a pamphlet or a poster. It does not run out, and each patient who scans it gets a link of their own." />
      <Blocked words={blocked} />
      <NewCodeForm {...choices} />
    </>
  );

  return (
    <AdminFrame clinic={clinic} title="Shared links" bare>
      <h1 className="sr-only">Shared links</h1>
      <LinksTabs open={tab} />
      {tab === "link" ? (
        <section id="links-tab-panel" aria-labelledby="links-tab-link" className="px-4 py-6 md:px-9 md:py-8">
          <div className="max-w-3xl">
            <DetailHeader title="New patient link" sub={days ? `For one patient. Stops working ${days} after the first play.` : "For one patient."} />
            <Blocked words={blocked} />
            <NewLinkForm {...choices} baseUrl={where?.origin ?? ""} />
          </div>
        </section>
      ) : (
        <section id="links-tab-panel" aria-labelledby="links-tab-qr">
          <SplitView
            title="Printed codes"
            param="item"
            initialKey={asked}
            headerAction={{ key: "new-code", label: "New code", detail: newCode }}
            groups={[{ items: codes }]}
            empty={<p className="mt-4 px-2 text-[15px] text-ink-soft">No printed codes yet.</p>}
            emptyDetail={newCode}
            footer={
              printed.total > printed.rows.length && (
                <p className="mt-3 px-2 text-sm text-ink-muted">
                  Showing the newest {printed.rows.length} of {printed.total} printed codes. Retire codes you no longer use to see the rest.
                </p>
              )
            }
          />
        </section>
      )}
    </AdminFrame>
  );
}

/**
 * The two equal tabs across the top (Evan, 2026-11-20): "Temporary patient
 * link" and "Permanent QR code". Each is a real link to the page with the tab
 * in the address, so it works without scripts, and a refresh or the Back
 * button lands on the same tab. Choosing one asks the server for the page
 * again, which checks everything as before.
 */
function LinksTabs({ open }: { open: LinksTab }) {
  const tabs: { key: LinksTab; label: string; href: string }[] = [
    { key: "link", label: "Temporary patient link", href: LINKS_TAB_HREF.link },
    { key: "qr", label: "Permanent QR code", href: LINKS_TAB_HREF.qr },
  ];
  return (
    <nav aria-label="Shared links" className="border-b border-line px-4 pt-4 md:px-9 md:pt-6">
      <ul className="grid grid-cols-2 gap-2">
        {tabs.map((tab) => {
          const isOpen = tab.key === open;
          return (
            <li key={tab.key}>
              <Link
                id={`links-tab-${tab.key}`}
                href={tab.href}
                aria-current={isOpen ? "page" : undefined}
                className={`flex min-h-12 items-center justify-center rounded-t-xl border-b-[3px] px-3 text-center text-[15px] font-semibold sm:text-base ${
                  isOpen ? "border-brand bg-brand/10 text-ink" : "border-transparent text-ink-soft hover:bg-wash hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Why no link can be made right now, said once at the top of the form, with a way to fix it where there is one. */
function Blocked({ words }: { words: string | null }) {
  if (!words) return null;
  const fix = words.includes("People") ? { href: "/admin/people", label: "Go to People" } : words.includes("Billing") ? { href: "/admin/billing", label: "Go to Billing" } : null;
  return (
    <p role="alert" className="mt-6 max-w-2xl rounded-xl border border-line-strong bg-surface px-4 py-3 text-[15px] text-ink-soft">
      {words}
      {fix && (
        <>
          {" "}
          <Link href={fix.href} className="font-medium text-brand-bright underline underline-offset-2">
            {fix.label}
          </Link>
        </>
      )}
    </p>
  );
}

/** What the page says when a link setting is out of range. createShare refuses for the same reason, so no link can be made. */
const TERMS_PROBLEM = "Links cannot be made right now: a link setting is out of range. Ask Pulse 3D to check the platform settings.";

/** What the page says when the deployment does not know its own address, so a link could not be written out. */
const ADDRESS_PROBLEM = "Links cannot be made here: this deployment does not know its own address. Ask Pulse 3D.";

/**
 * The clinic's share terms, or null when they cannot be worked out: a
 * setting outside the limits in lib/expiry.ts (only a hand edit can do
 * that). The page then says so in place of the numbers instead of failing,
 * and the detail goes to the server log.
 */
async function readShareTerms(clinicId: string): Promise<ShareTerms | null> {
  try {
    return await getShareTerms(clinicId);
  } catch (error) {
    if (!(error instanceof ShareTermsError)) throw error;
    console.error("Shared links could not read the clinic's share terms.", errorKind(error));
    return null;
  }
}

/**
 * The people a link can be from, or null when Clerk could not be read just
 * now. The page then says so and makes no link, rather than failing; the
 * detail (the kind of error only) goes to the server log.
 */
async function readSenders(clinicId: string): Promise<Sender[] | null> {
  try {
    return await listSenders(clinicId);
  } catch (error) {
    console.error("Shared links could not read the clinic's people", errorKind(error));
    return null;
  }
}
