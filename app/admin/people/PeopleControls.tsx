"use client";

import { useState, useTransition, type FormEvent } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ROLE_WORDS, type Role } from "@/lib/role-names";
import { ConfirmButton } from "./ConfirmButton";
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
import { MAX_DISPLAY_NAME } from "@/lib/sender-name";

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

/** "Member" or "Member with admin", as two buttons. The owner's is fixed at admin. */
export function AdminSwitch({ userId, name, role, isOwner }: { userId: string; name: string; role: Role; isOwner: boolean }) {
  const [current, setCurrent] = useState<Role>(role);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: Role) {
    if (pending || next === current) return;
    setResult(null);
    startTransition(async () => {
      const answer = await setAdminAction(userId, next === "admin");
      setResult(answer);
      if (!answer.error) setCurrent(next);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div role="group" aria-label={`What ${name} can do`} className="flex overflow-hidden rounded-lg border border-line-strong">
        {(["member", "admin"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={current === option}
            // The owner always has admin: switching it off is refused on the server, so it is not offered here.
            disabled={pending || (isOwner && option === "member")}
            onClick={() => choose(option)}
            className={`h-10 px-4 text-sm font-medium transition disabled:opacity-60 ${
              current === option ? "bg-brand text-on-brand" : "text-ink-soft hover:bg-wash hover:text-ink"
            }`}
          >
            {ROLE_WORDS[option]}
          </button>
        ))}
      </div>
      {isOwner && !pending && !result && <p className="text-xs text-ink-muted">The account owner always has admin.</p>}
      <Note pending={pending} result={result} />
    </div>
  );
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
    startTransition(async () => setResult(mode === "release" ? await releaseMySeatAction() : await giveSeatAction(userId)));
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
export function RemoveButton({ userId, name, holdsSeat }: { userId: string; name: string; holdsSeat: boolean }) {
  return (
    <ConfirmButton
      label="Remove"
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
export function RevokeButton({ invitationId, email, holdsSeat }: { invitationId: string; email: string; holdsSeat: boolean }) {
  return (
    <ConfirmButton
      label="Revoke"
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
      const answer = await inviteAction(email, role);
      setResult(answer);
      if (!answer.error) setEmail("");
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:flex-wrap sm:items-end">
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
 * "Patients see: Dr. Jane Smith" on a seated person's row, with Change. The
 * box opens with the name typed for them (empty when they use the default);
 * saving it empty goes back to "Dr. First Last" from their account. The
 * draft stays in the box when the server says no, with its sentence, and
 * the box closes only after the server has saved. The server checks the
 * name again (lib/sender-name.ts) and that the person holds a seat.
 */
export function PatientNameEditor({
  userId,
  personName,
  patientName,
  typedName,
  defaultName,
}: {
  userId: string;
  /** Their name for the office, for the labels. */
  personName: string;
  /** What patients see now, or null when there is no name at all. */
  patientName: string | null;
  /** The name typed for them, or null when they use the default. */
  typedName: string | null;
  /** "Dr. First Last" from their account, or null. Shown as the box's hint. */
  defaultName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(typedName ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = `patient-name-${userId}`;

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const answer = await setPatientNameAction(userId, draft);
      setResult(answer);
      if (!answer.error) setOpen(false);
    });
  }

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
              setDraft(typedName ?? "");
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
    <form onSubmit={save} className="mt-2 flex max-w-md flex-col gap-2">
      <label htmlFor={inputId} className="text-sm text-ink-soft">
        Name patients see on links from {personName}
      </label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        maxLength={MAX_DISPLAY_NAME}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={defaultName ?? "Jane Smith, PA-C"}
        className={INPUT}
      />
      <p className="text-xs text-ink-muted">
        {defaultName ? `Leave it empty to use "${defaultName}".` : "Their account has no name, so type one, for example Jane Smith, PA-C."} Links already sent keep
        the name they were made with.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-10 disabled:opacity-60`}>
          {pending ? "Saving..." : "Save name"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={`${SECONDARY_BUTTON} disabled:opacity-60`}>
          Cancel
        </button>
      </div>
      {result?.error && (
        <p role="alert" className="text-sm text-warn">
          {result.error}
        </p>
      )}
    </form>
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
