import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SendPanel } from "@/app/library/[category]/SendPanel";
import { PatientMessageButtons } from "./PatientMessageButtons";

// A made-up link: a real one is a secret.
const LINK = "http://localhost:3000/watch/AbCdEfGh12";

describe("PatientMessageButtons", () => {
  it("draws Copy message, and no device button until the browser has been asked what it can do", () => {
    const html = renderToStaticMarkup(<PatientMessageButtons message={`Hello: ${LINK}`} buttonClass="b" doneClass="d" />);
    expect(html).toContain("Copy message");
    expect(html).not.toContain("Share message");
    expect(html).not.toContain("sms:");
    expect(html).not.toContain("mailto:");
    // The confirmation's live region is there from the start, so it is announced.
    expect(html).toContain('role="status"');
  });

  it("has no box for a patient's name, number or email (rule 2)", () => {
    const html = renderToStaticMarkup(<PatientMessageButtons message={`Hello: ${LINK}`} buttonClass="b" doneClass="d" />);
    expect(html).not.toMatch(/<input/);
    expect(html).not.toMatch(/<textarea/);
  });
});

describe("the Send panel", () => {
  const panel = (senderName: string | null) =>
    renderToStaticMarkup(
      <SendPanel
        title="Total Knee Replacement"
        clinicName="Example Orthopedics"
        result={{ ok: true, code: "AbCdEfGh12", link: LINK, qrImage: "data:image/svg+xml;utf8,", unclaimedUntil: "2027-01-01T00:00:00.000Z", daysAfterFirstPlay: 10, senderName }}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  it("keeps Copy link and adds Copy message beside the new link", () => {
    const html = panel("Dr. Jane Smith, DO");
    expect(html).toContain("Copy link");
    expect(html).toContain("Copy message");
  });

  it("offers no message while the link is still being made, or when it could not be made", () => {
    const base = { title: "Total Knee Replacement", clinicName: "Example Orthopedics", onRetry: vi.fn(), onClose: vi.fn() };
    expect(renderToStaticMarkup(<SendPanel {...base} result={null} />)).not.toContain("Copy message");
    expect(renderToStaticMarkup(<SendPanel {...base} result={{ ok: false, error: "No." }} />)).not.toContain("Copy message");
  });
});
