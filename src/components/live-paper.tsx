"use client";

import { useEffect } from "react";
import { stationeryCss, type StationerySettings } from "@/lib/stationery";

/**
 * A paper tried on for the page you're on. It goes in through an effect, not a
 * rendered <style>: the router keeps left pages alive but hidden, and a style tag in
 * a hidden page still applies, which would dress other pages in a paper never saved.
 * Effects are cleaned up when a page is hidden, so this leaves with the page.
 */
export function LivePaper({ settings }: { settings: StationerySettings }) {
  const css = stationeryCss(settings);
  useEffect(() => {
    if (!css) return;
    const style = document.createElement("style");
    style.dataset.livePaper = "";
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [css]);
  return null;
}
