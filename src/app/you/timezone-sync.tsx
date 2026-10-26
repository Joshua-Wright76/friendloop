"use client";

import { useEffect, useSyncExternalStore } from "react";
import { syncTimezoneAction } from "./actions";

function subscribeToNothing() {
  return () => {};
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Existing sessions predate the capture at sign-in, and browsers travel. One
 * quiet POST keeps "where you are" honest without ever asking the person.
 */
export function TimezoneSync({ stored }: { stored: string }) {
  const zone = useSyncExternalStore(subscribeToNothing, browserTimezone, () => "");

  useEffect(() => {
    if (!zone || zone === stored) return;
    void syncTimezoneAction(zone);
  }, [stored, zone]);

  return null;
}
