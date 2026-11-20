"use client";

import { useState, useTransition, type FormEvent } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ROLE_WORDS, type Role } from "@/lib/role-names";
import { ConfirmButton, ConfirmDialog } from "./ConfirmButton";
import {
  giveSeatAction,
  handOffOwnerAction,
  inviteAction,
  releaseMySeatAction,
  removePersonAction,
  revokeInvitationAction,
  setAdminAction,
  setPatientNameAction,
  type ActionResult,
} from "./actions";
import { SenderNameForm } from "@/components/ui/SenderNameForm";

/**
 * The controls on the People page. Each one only ASKS: the Server Actions in
 * actions.ts check who is asking, and lib/seat-changes.ts decides, on the
 * server, whether a seat is free and whether the account owner is being
 * protected. A hidden or disabled button here is a courtesy, never the check.
 *
 * After a change the server refreshes the page, so each control starts again
 * from what the server says (the page gives it a new `key` when that changes).
 */

/** A small line under a control: the server's sentence, or "Saving...". */
function Note({ pending, result }: { pending: boolean; result: ActionResult | null }) {
  if (pending) return <p className="text-xs text-ink-muted">Saving...</p>;
  if (result?.error) {
    return (
      <p role="alert" className="max-w-xs text-sm text-warn sm:text-right">
        {result.error}
      </p>
    );
  }
  if (result?.message) return <p className="max-w-xs text-sm text-ink-soft sm:text-right">{result.message}</p>;
  return null;
}

/**
 * The "Admin" switch on a person's detail: on adds the admin pages, off takes
 * them away, and neither changes the seat count. It saves the moment it is
 * flipped (the server checks who is asking and protects the account owner);
 * a refusal flips it back and says why. The owner's switch stays on.
 *
 * TURNING OFF YOUR OWN ADMIN ASKS FIRST (Evan, 2026-11-20): only an office
 * admin can switch admin on, so someone who switches off their own cannot
 * switch it back; another admin would have to. The popup says exactly that,
 * and nothing changes until Yes. Who may do what is unchanged.
 */
export function AdminSwitch({ userId, name, role, isOwner, isSelf = false }: { userId: string; name: string; role: Role; isOwner: boolean; isSelf?: boolean }) {
  const [current, setCurrent] = useState<Role>(role);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const on = current === "admin";

  function flip() {
    if (pending || isOwner) return;
    if (isSelf && on) {
      setResult(null);
      setAsking(true);
      return;
    }
    const next: Role = on ? "member" : "admin";
    setResult(null);
    startTransition(async () => {
      const answer = await safeAction(() => setAdminAction(userId, next === "admin"));
      setResult(answer);
      if (!answer.error) setCurrent(next);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Toggle on={on} disabled={pending || isOwner} onFlip={flip} label="Admin" describedBy={name} />
      {asking && (
        <ConfirmDialog
          title="Turn off your own admin?"
          body={<p>You will lose the admin pages, and you cannot turn admin back on yourself. Another office admin would have to.</p>}
          yes="Turn it off"
          danger
          action={() => setAdminAction(userId, false)}
          onClose={() => setAsking(false)}
          onDone={(answer) => {
            setResult(answer);
            setCurrent("member");
          }}
        />
      )}
      {isOwner && !pending && !result && <p className="pl-[3.75rem] text-sm text-ink-muted">The account owner always has admin.</p>}
      <div className="pl-[3.75rem]">
        <Note pending={pending} result={result} />
      </div>
    </div>
  );
}

/** A switch with its words beside it, as in the approved design. A real checkbox underneath, so keyboards and screen readers know it. */
function Toggle({ on, disabled, onFlip, label, describedBy }: { on: boolean; disabled: boolean; onFlip: () => void; label: string; describedBy?: string }) {
  return (
    <label className={`flex min-h-11 items-center gap-3 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={onFlip} aria-label={describedBy ? `Admin, for ${describedBy}` : undefined} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-bright ${
          on ? "border-transparent bg-brand" : "border-line-strong bg-wash-strong"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <span className={`absolute h-5 w-5 rounded-full shadow transition-[left] ${on ? "left-[1.4rem] bg-on-brand" : "left-1 bg-ink-soft"}`} />
      </span>
      <span className="text-[16px] text-ink">{label}</span>
    </label>
  );
}

/** Run a Server Action; a request that fails outright (a lost connection) becomes a plain sentence, never an exception on screen. */
async function safeAction(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch {
    return { error: "We could not confirm the change. Check the connection, then try again." };
  }
}

/**
 * The seat buttons on one row: "Give a seat" for someone waiting, and for the
 * account owner's own row, "Take a seat" or "Give up my seat". The server
 * decides whether a seat is free.
 */
export function SeatButton({ userId, mode }: { userId: string; mode: "give" | "take" | "release" }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const label = mode === "give" ? "Give a seat" : mode === "take" ? "Take a seat" : "Give up my seat";

  function press() {
    if (pending) return;
    setResult(null);
    startTransition(async () => setResult(await safeAction(() => (mode === "release" ? releaseMySeatAction() : giveSeatAction(userId)))));
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button type="button" onClick={press} disabled={pending} className={`${SECONDARY_BUTTON} disabled:opacity-60`}>
        {label}
      </button>
      <Note pending={pending} result={result} />
    </div>
  );
}

/** "Remove", with a popup first. Not offered for the account owner or for yourself (both refused on the server too). */
export function RemoveButton({ userId, name, holdsSeat, label = "Remove" }: { userId: string; name: string; holdsSeat: boolean; label?: string }) {
  return (
    <ConfirmButton
      label={label}
      title={`Remove ${name}?`}
      body={
        <p>
          They will no longer be able to sign in to your clinic.{holdsSeat ? " Their seat becomes free for someone else." : ""} Links they already sent to
          patients keep working.
        </p>
      }
      yes="Yes, remove"
      danger
      action={() => removePersonAction(userId)}
    />
  );
}

/** "Revoke" on one open invitation, with a popup first. */
export function RevokeButton({ invitationId, email, holdsSeat, label = "Revoke" }: { invitationId: string; email: string; holdsSeat: boolean; label?: string }) {
  return (
    <ConfirmButton
      label={label}
      title="Revoke this invitation?"
      body={
        <p>
          {email} will no longer be able to use it to join.{holdsSeat ? " The seat it holds becomes free." : ""}
        </p>
      }
      yes="Yes, revoke it"
      danger
      action={() => revokeInvitationAction(invitationId)}
    />
  );
}

/**
 * The invite form: an email and Member or Member with admin. The draft stays
 * in the boxes when anything goes wrong, with the server's sentence; it is
 * cleared only after the server says the invitation went out.
 */
export function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const answer = await safeAction(() => inviteAction(email, role));
      setResult(answer);
      if (!answer.error) setEmail("");
    });
  }

  return (
    <form onSubmit={submit} className="mt-8 flex max-w-2xl flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1">
        <label htmlFor="invite-email" className={LABEL}>
          Email address
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@clinic.com"
          className={INPUT}
        />
      </div>
      <div className="sm:w-56">
        <label htmlFor="invite-role" className={LABEL}>
          What they can do
        </label>
        <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")} className={INPUT}>
          <option value="member">{ROLE_WORDS.member} (library)</option>
          <option value="admin">{ROLE_WORDS.admin} (library and admin)</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
        {pending ? "Sending..." : "Send invitation"}
      </button>
      {result?.error && (
        <p role="alert" className="basis-full text-sm text-warn">
          {result.error}
        </p>
      )}
      {result?.message && <p className="basis-full text-sm text-ink-soft">{result.message}</p>}
    </form>
  );
}

/**
 * "Patients see: Dr. Jane Smith, DO" on a seated person's row, with Change,
 * which opens the name and credential editor (SenderNameForm, the same one a
 * surgeon gets in the library's Send panel). The editor keeps its draft when
 * the server says no and closes only after the server has saved. The server
 * checks the name and credential again (lib/sender-name.ts) and that the
 * person holds a seat.
 */
export function PatientNameEditor({
  userId,
  personName,
  patientName,
}: {
  userId: string;
  /** Their name for the office, for the labels. */
  personName: string;
  /** What patients see now, or null when there is no name at all. */
  patientName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  if (!open) {
    return (
      <div className="mt-1 text-sm">
        <p className="text-ink-soft">
          {patientName ? (
            <>
              Patients see: <span className="font-medium text-ink">{patientName}</span>
            </>
          ) : (
            <span className="text-warn">No name for patients yet: links from them name only your clinic.</span>
          )}{" "}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setOpen(true);
            }}
            aria-label={`Change the name patients see for ${personName}`}
            className="font-medium text-brand-bright underline underline-offset-2 hover:text-ink"
          >
            Change
          </button>
        </p>
        {result?.message && <p className="mt-1 text-ink-muted">{result.message}</p>}
      </div>
    );
  }

  return (
    <SenderNameForm
      idPrefix={`patient-name-${userId}`}
      current={patientName}
      heading={`Name patients see on links from ${personName}`}
      onSave={(choice) => setPatientNameAction(userId, choice)}
      onSaved={(message) => {
        setResult(message ? { message } : null);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

/**
 * The account owner hands the account to another admin: a pick from the
 * people who already have admin, then a popup to confirm.
 */
export function OwnerHandoff({ admins }: { admins: { userId: string; name: string }[] }) {
  const [picked, setPicked] = useState(admins[0]?.userId ?? "");
  const [done, setDone] = useState<string | null>(null);
  // The list comes from the server and can change after the page refreshes
  // (someone was just given admin). A pick that is no longer in it falls back
  // to the first person listed, so the popup never names nobody.
  const chosen = admins.some((admin) => admin.userId === picked) ? picked : (admins[0]?.userId ?? "");
  const name = admins.find((admin) => admin.userId === chosen)?.name ?? "";

  if (admins.length === 0) {
    return (
      <p className="mt-2 max-w-2xl text-ink-soft">
        Nobody else has admin yet. Switch admin on for the person who should take over, then come back here.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-72">
        <label htmlFor="new-owner" className={LABEL}>
          New account owner
        </label>
        <select id="new-owner" value={chosen} onChange={(event) => setPicked(event.target.value)} className={INPUT}>
          {admins.map((admin) => (
            <option key={admin.userId} value={admin.userId}>
              {admin.name}
            </option>
          ))}
        </select>
      </div>
      <ConfirmButton
        label="Make account owner"
        title={`Make ${name} the account owner?`}
        body={
          <>
            <p>They will run the clinic&apos;s account, and you will not. You stay in the clinic with admin on.</p>
            <p className="mt-3">
              The owner is the one person who does not need a seat, so from now on you need one like everyone else. If {name} has a seat, it
              passes to you and the seat count stays the same. If not, you get a free seat if there is one, or wait for one.
            </p>
          </>
        }
        yes="Yes, hand it over"
        action={() => handOffOwnerAction(chosen)}
        onDone={(result) => setDone(result.message ?? null)}
      />
      {done && <p className="text-sm text-ink-soft">{done}</p>}
    </div>
  );
}
