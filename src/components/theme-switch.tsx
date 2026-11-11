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
      {/* Both are rendered and CSS shows one: the server can't know the theme, so state alone would paint the wrong word first. Each names the mode the tap switches to. */}
      <span className="theme-switch-label theme-switch-label-light">{copy.common.theme.darkMode}</span>
      <span className="theme-switch-label theme-switch-label-dark">{copy.common.theme.lightMode}</span>
    </button>
  );
}
