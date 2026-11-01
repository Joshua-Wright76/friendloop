"use client";

import { copy } from "@/lib/copy";

/**
 * Opens the browser's print window. Only ever on a click: a page that printed
 * itself on arrival would also print itself for a mail scanner's preview.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-primary"
    >
      {copy.print.button}
    </button>
  );
}
