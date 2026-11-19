import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitView } from "./SplitView";

/**
 * The list-and-detail layout of Overview, Shared links and People, drawn the
 * way the server first draws it. Choosing an item in the browser is state,
 * checked on the preview; this proves which detail a first draw shows.
 */

const groups = [
  {
    heading: "New",
    items: [
      { key: "a", title: "First item", dot: true, detail: <p>Detail of the first</p> },
      { key: "b", title: "Second item", detail: <p>Detail of the second</p> },
    ],
  },
];

describe("SplitView", () => {
  it("opens on the first item when the address names none, with the list showing on a phone", () => {
    const html = renderToStaticMarkup(<SplitView title="Overview" param="item" groups={groups} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Detail of the first");
    expect(html).not.toContain("Detail of the second");
    // Both items are in the list; the open one is marked.
    expect(html).toMatch(/aria-current="true"[^>]*>[\s\S]*?First item/);
    // On a phone the list shows first and the detail waits (hidden until an item is tapped).
    expect(html).toMatch(/<section aria-label="Overview" class="flex /);
  });

  it("opens on the item the address names, and on a phone shows its detail with the way back to the list", () => {
    const html = renderToStaticMarkup(<SplitView title="Overview" param="item" groups={groups} initialKey="b" />);
    expect(html).toContain("Detail of the second");
    expect(html).not.toContain("Detail of the first");
    expect(html).toMatch(/<section aria-label="Overview" class="hidden md:flex/);
  });

  it("ignores an item the address names that is not there (removed, retired, or made up)", () => {
    const html = renderToStaticMarkup(<SplitView title="Overview" param="item" groups={groups} initialKey="nope" />);
    expect(html).toContain("Detail of the first");
  });

  it("offers the header button's own detail, and shows it when there is nothing in the list", () => {
    const html = renderToStaticMarkup(
      <SplitView title="People" param="person" groups={[{ items: [] }]} headerAction={{ key: "invite", label: "Invite", primary: true, detail: <p>The invite form</p> }} />,
    );
    expect(html).toContain(">Invite<");
    expect(html).toContain("The invite form");
  });

  it("says what the empty list and the empty detail say", () => {
    const html = renderToStaticMarkup(<SplitView title="Overview" param="item" groups={[{ items: [] }]} empty={<p>Nothing here</p>} emptyDetail={<p>Nothing to show</p>} />);
    expect(html).toContain("Nothing here");
    expect(html).toContain("Nothing to show");
  });
});
