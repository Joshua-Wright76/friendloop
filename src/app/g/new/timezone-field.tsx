"use client";

import { useEffect, useSyncExternalStore } from "react";
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
export function TimezoneField({
  name = "timezone",
  defaultValue,
  value,
  onValueChange,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const detected = useSyncExternalStore(subscribe, browserTimezone, () => "");
  const initialValue = defaultValue ?? detected;
  useEffect(() => {
    if (value === undefined && initialValue) onValueChange?.(initialValue);
  }, [initialValue, onValueChange, value]);

  return (
    <Picker
      key={initialValue || "timezone"}
      name={name}
      defaultValue={initialValue || DEFAULT_TIMEZONE}
      value={value}
      onValueChange={onValueChange}
      options={OPTIONS}
      ariaLabel={copy.newLoop.timezone}
      searchable
    />
  );
}
