"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Picker } from "@/components/picker";
import { copy } from "@/lib/copy";
import { timezoneOptions } from "@/lib/timezone";

const OPTIONS = timezoneOptions().map((timezone) => ({ value: timezone, label: placeLabel(timezone) }));
const FALLBACK_TIMEZONE = copy.common.timezones[copy.common.timezones.length - 1];

/** "Los Angeles (America)": how a person looks a place up. The value stays the IANA name. */
function placeLabel(timezone: string): string {
  const parts = timezone.split("/");
  if (parts.length < 2) return timezone.replace(/_/g, " ");
  return `${parts[parts.length - 1].replace(/_/g, " ")} (${parts[0]})`;
}

function browserTimezone(): string {
  if (typeof window === "undefined") return "";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
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
  describedBy,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  describedBy?: string;
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
      defaultValue={initialValue || FALLBACK_TIMEZONE}
      value={value}
      onValueChange={onValueChange}
      options={OPTIONS}
      ariaLabel={copy.newLoop.timezone}
      searchable
      describedBy={describedBy}
    />
  );
}
