"use client";

import { useEffect, useRef } from "react";

/** Fills the timezone field with the browser's zone the first time it renders. */
export function TimezoneField({ name = "timezone" }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (input && !input.value) {
      try {
        input.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      } catch {
        input.value = "UTC";
      }
    }
  }, []);

  return (
    <input
      ref={ref}
      name={name}
      list="timezones"
      placeholder="Europe/Amsterdam"
      autoComplete="off"
      className="field h-[46px] py-0"
    />
  );
}
