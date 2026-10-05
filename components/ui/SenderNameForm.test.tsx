import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SendPanel } from "@/app/library/[category]/SendPanel";
import { SenderNameForm } from "./SenderNameForm";

/**
 * The name and credential editor, and the Send panel's "Sent as" line, as the
 * browser first draws them, with the Server Actions as stand-ins (no Clerk,
 * no database). What these prove: the editor opens on what patients see now,
 * read back into a name and a credential; nobody is given a credential in
 * advance; and the Send panel names the surgeon the link is from, with a way
 * to change it. Typing, saving and "Make this link again" are checked in a
 * browser; the rules are in lib/sender-name.test.ts and the saves in
 * lib/seat-changes.test.ts and the action tests.
 */

vi.mock("@/app/library/[category]/actions", () => ({ setMyPatientNameAction: vi.fn() }));

const form = (current: string | null) =>
  renderToStaticMarkup(<SenderNameForm idPrefix="t" current={current} heading="Name patients see on links from Jane Smith" onSave={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />);

/** The option the select starts on. */
const selected = (html: string) => /<option value="([^"]*)" selected="">/.exec(html)?.[1];

describe("SenderNameForm", () => {
  it("opens on a saved name and credential, with the words patients will see", () => {
    const html = form("Dr. Jane Smith, DO");
    expect(html).toContain('id="t-name"');
    expect(html).toContain('value="Jane Smith"');
    expect(selected(html)).toBe("DO");
    expect(html).toContain("Patients will see: <span");
    expect(html).toContain("Dr. Jane Smith, DO</span>");
    // Read back exactly, so no "choose the credential" note.
    expect(html).not.toContain("Choose the credential and save");
    // The typed-credential box only appears for Other.
    expect(html).not.toContain('id="t-other"');
  });

  it("opens on the Dr. First Last default with the name filled in and NO credential chosen for them", () => {
    const html = form("Dr. Jane Smith");
    expect(html).toContain('value="Jane Smith"');
    expect(selected(html)).toBe("");
    expect(html).toContain("Patients see “Dr. Jane Smith” now. Choose the credential and save to set it.");
    expect(html).not.toContain("Patients will see:");
  });

  it("shows the typed credential box for Other, filled in", () => {
    const html = form("Jane Smith, LAc");
    expect(selected(html)).toBe("other");
    expect(html).toContain('id="t-other"');
    expect(html).toContain('value="LAc"');
  });

  it("lists every credential, with Dr. said where it is added", () => {
    const html = form(null);
    for (const label of ["Choose...", "MD (adds Dr.)", "DO (adds Dr.)", "DPM (adds Dr.)", "PA-C", "NP", "Other (type it)", "None"]) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain('value=""');
  });
});

describe("the Send panel's 'Sent as' line", () => {
  const ok = (senderName: string | null) =>
    renderToStaticMarkup(
      <SendPanel
        title="Total Knee Replacement"
        result={{ ok: true, code: "k7m2xq", link: "http://localhost:3000/watch/k7m2xq", qrImage: "data:image/svg+xml;utf8,", unclaimedUntil: "2027-01-01T00:00:00.000Z", daysAfterFirstPlay: 10, senderName }}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  it("names the surgeon the link is from, with Change", () => {
    const html = ok("Dr. Jane Smith, DO");
    expect(html).toContain('Sent as <span class="font-medium text-ink">Dr. Jane Smith, DO</span>');
    expect(html).toContain('aria-label="Change the name patients see on links you send"');
    // The editor stays closed until Change is tapped.
    expect(html).not.toContain('id="my-name-name"');
  });

  it("says so when the link names only the clinic, still with Change", () => {
    const html = ok(null);
    expect(html).toContain("This link names only your clinic, because you have no name for patients yet.");
    expect(html).toContain(">Change</button>");
  });
});
