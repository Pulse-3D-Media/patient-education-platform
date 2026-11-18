"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The "are you sure?" popup the dashboard asks with before a save that
 * reaches links or clinics everywhere: unpublishing a video, a settings
 * change, and the other yes-or-no questions on the video form.
 *
 * The same popup as the clinic side's "Cancel link" and People questions
 * (ConfirmButton in app/admin/people): the same look, No first with focus
 * on it so a stray Enter does nothing, and Escape, No and the dark backdrop
 * all close it and change nothing. Two things more, for the keyboard: Tab
 * stays inside the popup while it is open, and when it closes, by any way,
 * focus goes back to the button that was pressed. (That file is in the
 * clinic's area and is left as it is; it could later move onto this one.)
 *
 * It is a courtesy against a slip of the hand, never the protection: every
 * action still checks for Pulse staff and checks every value on the server.
 *
 * Use it through useConfirmedSubmit() below, which puts it in front of a
 * form's own submit, so the form still goes through useKeptForm() and keeps
 * what was typed whatever happens.
 */

/** What the popup asks: a heading, one plain sentence per thing that changes, and the words on the Yes button. */
export type Question = { title: string; sentences: string[]; yes: string; danger?: boolean };

export function ConfirmPopup({ question, onYes, onNo }: { question: Question; onYes: () => void; onNo: () => void }) {
  const noButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const bodyId = useId();

  // The latest onNo, so the effect below runs once when the popup opens rather than again on every redraw (which would pull focus back to No).
  const latestNo = useRef(onNo);
  useEffect(() => {
    latestNo.current = onNo;
  }, [onNo]);

  useEffect(() => {
    noButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latestNo.current();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  // Tab and Shift+Tab go round the popup's own buttons and never out behind it.
  function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panel.current) return;
    const stops = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-5" onClick={(event) => event.target === event.currentTarget && onNo()}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={bodyId}
        onKeyDown={keepFocusInside}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-panel sm:p-8"
      >
        <h2 id={headingId} className="text-xl font-semibold">
          {question.title}
        </h2>
        <div id={bodyId} className="mt-4 flex flex-col gap-3 text-base leading-relaxed text-ink-soft">
          {question.sentences.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            ref={noButton}
            type="button"
            onClick={onNo}
            className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-base font-medium text-ink-soft transition hover:border-brand hover:text-ink"
          >
            No, go back
          </button>
          <button
            type="button"
            onClick={onYes}
            className={`inline-flex h-11 items-center rounded-lg px-5 text-base font-medium transition ${
              question.danger ? "bg-[#a33a3a] text-white hover:bg-[#872e2e]" : "bg-brand text-on-brand hover:bg-brand-hover"
            }`}
          >
            {question.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Save button is disabled ("Saving...") while the server works, and a
 * disabled button drops the keyboard's focus. Once it is enabled again, put
 * focus back on it, unless the person has moved on to something else
 * meanwhile. Gives up after a minute.
 */
function refocusWhenEnabled(button: HTMLButtonElement) {
  const observer = new MutationObserver(() => {
    if (button.disabled) return;
    observer.disconnect();
    if (!document.activeElement || document.activeElement === document.body) button.focus();
  });
  observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  setTimeout(() => observer.disconnect(), 60_000);
}

/**
 * Put the popup in front of a form's submit. `ask` looks at the form as it
 * is about to be sent and answers:
 *   - null: nothing to ask, the form is sent at once;
 *   - false: do not send (the form found a problem of its own and said so);
 *   - a Question, or a promise of one (when the server has to be asked
 *     first, such as how many links an unpublish stops): the popup opens,
 *     and only Yes sends the form, from the same button that was pressed.
 *
 *   const { onSubmit, popup } = useConfirmedSubmit(ask);
 *   <form {...form} onSubmit={onSubmit}> ... </form>
 *   {popup}
 */
export function useConfirmedSubmit(ask: (form: HTMLFormElement) => Question | null | false | Promise<Question | null>) {
  const [question, setQuestion] = useState<Question | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pressed = useRef<HTMLElement | null>(null);
  // Set just before the form is sent again after a Yes, so the second pass goes straight through.
  const confirmed = useRef(false);

  function send() {
    confirmed.current = true;
    const button = pressed.current;
    const submitButton = button instanceof HTMLButtonElement && button.type === "submit" ? button : undefined;
    formRef.current?.requestSubmit(submitButton);
    if (submitButton) refocusWhenEnabled(submitButton);
  }

  function close(thenSend: boolean) {
    setQuestion(null);
    // Back to the button that was pressed, whichever way the popup closed.
    pressed.current?.focus();
    if (thenSend) send();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    formRef.current = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    pressed.current = submitter instanceof HTMLElement ? submitter : (document.activeElement as HTMLElement | null);
    const answer = ask(event.currentTarget);
    if (answer === null) return;
    event.preventDefault();
    if (answer === false) return;
    Promise.resolve(answer).then((asked) => (asked ? setQuestion(asked) : send()));
  }

  const popup = question ? <ConfirmPopup question={question} onYes={() => close(true)} onNo={() => close(false)} /> : null;
  return { onSubmit, popup };
}
