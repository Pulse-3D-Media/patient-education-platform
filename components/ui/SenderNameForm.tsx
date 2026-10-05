"use client";

import { useState, useTransition, type FormEvent } from "react";
import { safeSave } from "@/lib/form-save";
import { CREDENTIAL_CHOICES, MAX_OTHER_CREDENTIAL, parseNameChoice, readSenderName, type CredentialPick, type NameChoice } from "@/lib/sender-name";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

/**
 * The name and credential editor: how a surgeon's name appears to patients
 * on the links they send. One form, used in two places: an office admin's
 * Change on /admin/people (for anyone holding a seat), and a surgeon's own
 * Change in the library's Send panel.
 *
 * A name box that holds only the name, and a credential from the list (MD,
 * DO, DPM, PA-C, NP, Other, None). The "Dr." and the credential come from
 * the list and are never typed. It opens on what patients see now, read
 * back into a name and a credential by the same rule that builds them
 * (lib/sender-name.ts); for someone nobody has chosen for yet, the name is
 * filled in from their account and the credential is left to choose, so
 * nobody is given a credential they do not hold.
 *
 * The words under the boxes ("Patients will see ...") are worked out here
 * only to show them. What is saved is worked out again on the server from
 * the name and credential sent, never from those words (rule 8).
 *
 * The draft stays in the boxes when the server says no, or the save cannot
 * be confirmed, with a plain sentence; the form closes only after the
 * server has saved.
 */
export function SenderNameForm({
  idPrefix,
  current,
  heading,
  onSave,
  onSaved,
  onCancel,
}: {
  /** Makes the boxes' ids unique on a page with several forms. */
  idPrefix: string;
  /** What patients see now, or null when there is no name at all. */
  current: string | null;
  /** The line at the top: "Name patients see on links from Jane Smith". */
  heading: string;
  /** Sends the choice to the server. Answers with a refusal, or a sentence on success. */
  onSave: (choice: NameChoice) => Promise<{ error?: string; message?: string }>;
  /** Called with the server's sentence once the name is saved. */
  onSaved: (message: string | undefined) => void;
  onCancel: () => void;
}) {
  const start = readSenderName(current);
  const [name, setName] = useState(start.choice.name);
  const [credential, setCredential] = useState<CredentialPick>(start.choice.credential);
  const [other, setOther] = useState(start.choice.other);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const draft: NameChoice = { name, credential, other };
  const checked = parseNameChoice(draft);

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const answer = await safeSave(async () => {
        const result = await onSave(draft);
        return result.error ? { error: result.error } : { ok: result.message ?? "" };
      });
      if (answer?.error) setError(answer.error);
      else onSaved(answer?.ok || undefined);
    });
  }

  return (
    <form onSubmit={save} className="mt-2 flex max-w-md flex-col gap-3">
      <p className="text-sm text-ink-soft">{heading}</p>
      {current && !start.exact && (
        <p className="text-sm text-ink-muted">
          Patients see &ldquo;{current}&rdquo; now. Choose the credential and save to set it.
        </p>
      )}

      <div>
        <label htmlFor={`${idPrefix}-name`} className={LABEL}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Jane Smith"
          className={INPUT}
        />
        <p className="mt-1 text-xs text-ink-muted">Only the name. &ldquo;Dr.&rdquo; and the credential come from the list below.</p>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-credential`} className={LABEL}>
          Credential
        </label>
        <select
          id={`${idPrefix}-credential`}
          value={credential}
          onChange={(event) => setCredential(event.target.value as CredentialPick)}
          className={INPUT}
        >
          <option value="">Choose...</option>
          {CREDENTIAL_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>

      {credential === "other" && (
        <div>
          <label htmlFor={`${idPrefix}-other`} className={LABEL}>
            Credential, as patients should see it
          </label>
          <input
            id={`${idPrefix}-other`}
            type="text"
            autoComplete="off"
            maxLength={MAX_OTHER_CREDENTIAL}
            value={other}
            onChange={(event) => setOther(event.target.value)}
            placeholder="LAc"
            className={INPUT}
          />
          <p className="mt-1 text-xs text-ink-muted">Letters and hyphens. It goes after the name, with no &ldquo;Dr.&rdquo;</p>
        </div>
      )}

      {checked.ok && (
        <p className="text-sm text-ink-soft">
          Patients will see: <span className="font-medium text-ink">{checked.words}</span>
        </p>
      )}
      <p className="text-xs text-ink-muted">Links already sent keep the name they were made with.</p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? "Saving..." : "Save name"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={`${SECONDARY_BUTTON} disabled:opacity-60`}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}
    </form>
  );
}
