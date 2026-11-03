"use client";

import { useEffect } from "react";

/**
 * Sets the tab title (and so the name of a saved PDF) from data a metadata export
 * cannot see. Renders no element, so the page never carries two <title> tags.
 */
export function DocumentTitle({ value }: { value: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = value;
    return () => { document.title = previous; };
  }, [value]);
  return null;
}
