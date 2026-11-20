import { auth } from "@clerk/nextjs/server";
import { getBillingView } from "@/app/admin/billing/billing";
import { getCheckoutView } from "@/app/admin/billing/checkout-view";
import { errorKind } from "@/lib/error-kind";
import { checkSeats, type SeatBoard } from "@/lib/seat-changes";
import { SetupFrame } from "../SetupFrame";
import { cameBack, requireSetup } from "../setup-view";
import { TeamStepForm } from "./TeamStepForm";

/**
 * Setup step 3 of 4: "Invite your team" (screens 04-setup-3-team and 3b).
 *
 * "3 seats on your plan: you and 2 more": the person setting up holds one of
 * the seats (they were given it when the clinic opened: the person who signs
 * up takes a seat, decided by Evan on 2026-11-19), and there is one email box
 * for each seat nobody holds and no invitation holds. Invitations already
 * sent are listed, so coming back shows where things stand. Nothing about
 * admins is asked here: everyone invited is a member with a seat.
 *
 * The seats are brought into line with Clerk first (checkSeats, as the People
 * page does), so an accepted or revoked invitation is counted as it now is.
 *
 * "Add another" (a seat bought on the spot, with its price shown first) is
 * offered only where Billing would let the plan be changed right now (the
 * same getCheckoutView: test mode, a live subscription, nothing waiting),
 * which is never on the production deployment.
 */
export const dynamic = "force-dynamic";

export default async function SetupTeamPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { clinic, progress } = await requireSetup("team");
  const { userId } = await auth();
  const [board, canAddSeat, welcomeBack] = await Promise.all([readBoard(clinic.id), addSeatOffered(clinic.id), cameBack(searchParams)]);

  const me = board?.people.find((person) => person.userId === userId) ?? null;
  const invited = (board?.invitations ?? []).filter((invitation) => invitation.holdsSeat).map((invitation) => invitation.email);

  return (
    <SetupFrame clinic={clinic} progress={progress} step="team">
      <TeamStepForm
        seats={board?.summary.seats ?? 0}
        free={board?.summary.free ?? 0}
        me={me ? { email: me.email, seated: me.seat === "held" } : null}
        invited={invited}
        canAddSeat={canAddSeat}
        unreadable={board === null}
        welcomeBack={welcomeBack}
      />
    </SetupFrame>
  );
}

/** The clinic's people and seats, checked against Clerk. Null when Clerk could not be asked: the page says so and offers Skip. */
async function readBoard(clinicId: string): Promise<SeatBoard | null> {
  try {
    return await checkSeats(clinicId);
  } catch (error) {
    console.error("Setup: the seats could not be read", errorKind(error));
    return null;
  }
}

/** May a seat be added here right now? Exactly where Billing would show its "Change your plan" form. */
async function addSeatOffered(clinicId: string): Promise<boolean> {
  try {
    const billing = await getBillingView(clinicId);
    const view = billing ? await getCheckoutView(clinicId, billing.plan) : null;
    return view?.offer.kind === "subscribed" && view.offer.change.kind === "changer";
  } catch (error) {
    console.error("Setup: whether a seat can be added could not be read", errorKind(error));
    return false;
  }
}
