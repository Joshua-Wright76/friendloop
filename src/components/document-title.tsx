"use client";

import { useEffect } from "react";

/**
 * Sets the tab title (and so the name of a saved PDF) from data a metadata export
 * cannot see. Renders no element, so the page never carries two <title> tags. It
 * does not restore the old title on unmount: the router sets the next page's own.
 */
export function DocumentTitle({ value }: { value: string }) {
  useEffect(() => {
    document.title = value;
  }, [value]);
  return null;
}
