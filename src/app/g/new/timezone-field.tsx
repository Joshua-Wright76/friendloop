"use client";

import { useSyncExternalStore } from "react";
import { Picker } from "@/components/picker";
import { copy } from "@/lib/copy";

const DEFAULT_TIMEZONE = copy.common.timezones[copy.common.timezones.length - 1];
const OPTIONS = copy.common.timezones.map((timezone) => ({ value: timezone, label: timezone }));

function browserTimezone(): string {
  if (typeof window === "undefined") return "";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function subscribe() {
  return () => {};
}

/** New loops start with the browser's zone; settings pass their saved zone. */
export function TimezoneField({ name = "timezone", defaultValue }: { name?: string; defaultValue?: string }) {
  const detected = useSyncExternalStore(subscribe, browserTimezone, () => "");
  const initialValue = defaultValue ?? detected;
  return (
    <Picker
      key={initialValue || "timezone"}
      name={name}
      defaultValue={initialValue}
      options={OPTIONS}
      ariaLabel={copy.newLoop.timezone}
      searchable
    />
  );
}
