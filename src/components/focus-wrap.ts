import type { KeyboardEvent } from "react";

// What Tab can land on: not disabled, not taken out of the tab order. (A roving-tabindex grid cell
// that holds focus is "-1", so it is handled separately below.)
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(item: HTMLElement): boolean {
  if (item.closest("[inert], [hidden]")) return false;
  if (typeof item.checkVisibility === "function") return item.checkVisibility({ visibilityProperty: true });
  return item.getClientRects().length > 0;
}

/**
 * Tab and Shift+Tab go round inside a modal dialog. A native modal already keeps
 * focus off the page behind, but tabbing past its last control otherwise leaves for
 * the browser's own toolbar, which reads as focus escaping. The stops are worked out
 * at keydown time (search results come and go), and focus that sits on something
 * outside the tab order, like an emoji reached with the arrow keys, still wraps.
 */
export function wrapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const root = event.currentTarget;
  const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(visible);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const index = active ? items.indexOf(active) : -1;
  const first = items[0];
  const last = items[items.length - 1];

  if (index === -1) {
    // Focus is on the dialog itself or on a control Tab skips: continue from where it is, wrapping at the ends.
    event.preventDefault();
    const after = (item: HTMLElement) => Boolean(active && root.contains(active) && active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
    const before = (item: HTMLElement) => Boolean(active && root.contains(active) && active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING);
    if (event.shiftKey) (items.filter(before).pop() ?? last).focus();
    else (items.find(after) ?? first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
