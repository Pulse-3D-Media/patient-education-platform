import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShowQrPanel } from "./ShowQrPanel";

/**
 * "Show QR on screen" as it first draws: creating, the code once the link is
 * made, and a refusal. The link itself is made by the same Send action as
 * the Send panel (app/library/[category]/actions.test.ts covers who may make
 * one); this is what the patient in the room is shown. No database.
 */

// The panel's name editor (inside the Send panel it imports from) reaches a Server Action; nothing here calls it.
vi.mock("../../[category]/actions", () => ({ setMyPatientNameAction: vi.fn() }));

const made = {
  ok: true as const,
  code: "k7m2xq9p4a",
  link: "https://example.com/watch/k7m2xq9p4a",
  qrImage: "data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E",
  unclaimedUntil: "2027-01-13T12:00:00.000Z",
  daysAfterFirstPlay: 10,
  senderName: "Dr. Jane Smith, DO",
};

function render(props: Partial<Parameters<typeof ShowQrPanel>[0]> = {}) {
  return renderToStaticMarkup(<ShowQrPanel title="Total Knee Replacement" result={made} onRetry={() => {}} onClose={() => {}} {...props} />);
}

describe("Show QR on screen", () => {
  it("shows the code large, on white, with the procedure and one sentence for the patient", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain(">Total Knee Replacement</h2>");
    expect(html).toMatch(/<div class="mt-5 rounded-2xl bg-white[^"]*"><img src="data:image\/svg\+xml;utf8,[^"]*"[^>]*class="h-\[min\(72vw,46vh,30rem\)\] w-\[min\(72vw,46vh,30rem\)\]"/);
    expect(html).toContain("Point your phone&#x27;s camera at the code");
    // What the link will do, for the surgeon, with who it is from.
    expect(html).toContain("From Dr. Jane Smith, DO.");
    expect(html).toContain("it works for 10 days");
    // The code only: the address itself is not printed for anyone to copy off the screen.
    expect(html).not.toContain(">https://example.com/watch/");
  });

  it("says it is making the link until the server answers", () => {
    const html = render({ result: null });
    expect(html).toContain("Creating link...");
    expect(html).not.toContain("<img");
  });

  it("carries the placeholder mark for a placeholder", () => {
    expect(render({ placeholder: true })).toContain("Placeholder animation. This plays a sample, not this procedure.");
  });

  it("shows a refusal in plain words with Try again, and no code", () => {
    const html = render({ result: { ok: false, error: "Sending links to patients needs a surgeon seat." } });
    expect(html).toContain("Sending links to patients needs a surgeon seat.");
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("<img");
  });
});
