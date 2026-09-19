"use client";

import { useEffect, type RefObject } from "react";

/** Keep an expanded player usable with a keyboard, zoom and mobile browser bars.
 * Inert siblings also keep a screen reader out of the page behind the dialog.
 * The existing video stays mounted, so opening the overlay never restarts it.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const x = window.scrollX;
    const y = window.scrollY;
    const body = document.body;
    const previousBody = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow };
    const previousPanel = { top: panel.style.top, left: panel.style.left, width: panel.style.width, height: panel.style.height };
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = panel;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.setAttribute("inert", "");
        }
      }
      branch = branch.parentElement;
      if (branch === body) break;
    }
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    const fit = () => {
      const viewport = window.visualViewport;
      Object.assign(panel.style, {
        top: `${viewport?.offsetTop ?? 0}px`, left: `${viewport?.offsetLeft ?? 0}px`,
        width: `${viewport?.width ?? window.innerWidth}px`, height: `${viewport?.height ?? window.innerHeight}px`,
      });
    };
    fit();
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    const focusFirst = () => (panel.querySelector<HTMLElement>("button, [href], video[controls], [tabindex='0']") ?? panel).focus({ preventScroll: true });
    const keepInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener("focusin", keepInside);
    return () => {
      document.removeEventListener("focusin", keepInside);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      siblings.forEach(({ element, inert }) => { element.toggleAttribute("inert", inert); });
      Object.assign(body.style, previousBody);
      Object.assign(panel.style, previousPanel);
      window.scrollTo(x, y);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [ref, open]);
}
