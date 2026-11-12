"use client";

import { useEffect } from "react";

/**
 * After a change, brings the place it happened into view and lights it for a moment,
 * so the result is never left somewhere off the top of the screen. Mounted fresh by
 * each return from an action, so it runs once per change. Reduced motion jumps
 * instead of gliding, and the light is still, not animated (see `.row-flash`).
 */
export function ScrollToDone({ target }: { target: string | null }) {
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(target);
    if (!element) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    element.classList.add("row-flash");
    const timer = setTimeout(() => element.classList.remove("row-flash"), 2600);
    return () => {
      clearTimeout(timer);
      element.classList.remove("row-flash");
    };
  }, [target]);
  return null;
}
