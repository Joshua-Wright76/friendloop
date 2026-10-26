"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";

type CopyState = "idle" | "copied" | "failed";

/** For the browsers without the async clipboard API (and for plain http origins). */
function legacyCopy(value: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * One tap instead of a fiddly text selection on a phone — which is where this
 * link gets sent from.
 */
export function CopyLink({ url, className = "" }: { url: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copyUrl() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = legacyCopy(url);

    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2400);
  }

  return (
    <button
      type="button"
      onClick={() => void copyUrl()}
      title={state === "failed" ? copy.common.copyFailed : undefined}
      className={`btn btn-quiet h-9 min-h-9 flex-none whitespace-nowrap px-3 text-[13px] ${className}`}
    >
      <span aria-live="polite">
        {state === "copied"
          ? copy.common.copied
          : state === "failed"
            ? copy.common.copyFailedShort
            : copy.common.copyLink}
      </span>
    </button>
  );
}
