"use client";

import { useEffect, useSyncExternalStore } from "react";
import { copy } from "@/lib/copy";
import { themeColorFor, type ThemeName } from "@/lib/theme";

type Theme = ThemeName;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", themeColorFor(theme)));
  try {
    localStorage.setItem("friendloop-theme", theme);
  } catch {
    // The switch still works when storage is unavailable.
  }
  window.dispatchEvent(new Event("friendloop-theme-change"));
}

function transitionTheme(theme: Theme) {
  const update = () => applyTheme(theme);
  const documentWithViewTransitions = document as ViewTransitionDocument;

  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof documentWithViewTransitions.startViewTransition !== "function"
  ) {
    update();
    return;
  }

  documentWithViewTransitions.startViewTransition(update);
}

function subscribe(onChange: () => void) {
  window.addEventListener("friendloop-theme-change", onChange);
  return () => window.removeEventListener("friendloop-theme-change", onChange);
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);

  useEffect(() => {
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", themeColorFor(theme)));
  }, [theme]);

  const toggle = () => transitionTheme(theme === "light" ? "dark" : "light");

  return (
    <button
      type="button"
      className="theme-switch"
      aria-label={theme === "light" ? copy.common.theme.switchToDark : copy.common.theme.switchToLight}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="theme-switch-icon">
        <g className={`theme-switch-sun${theme === "light" ? " is-visible" : ""}`}>
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
        <path className={`theme-switch-moon${theme === "dark" ? " is-visible" : ""}`} d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" fill="currentColor" />
      </svg>
      <span className="theme-switch-label">{theme === "light" ? copy.common.theme.light : copy.common.theme.dark}</span>
      <span className="theme-switch-track" aria-hidden="true"><span /></span>
    </button>
  );
}
