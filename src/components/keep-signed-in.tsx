"use client";

import { useEffect } from "react";

const KEY = "fl_session_renewed";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Someone who keeps using Friendloop should never be signed out. Once a day, a
 * signed-in page renews the session; storage only decides whether a day has passed.
 */
export function KeepSignedIn() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY)) || 0;
    } catch {
      // Storage can be off. Asking every visit is harmless; the server writes at most daily.
    }
    if (Date.now() - last < DAY_MS) return;
    void fetch("/api/session", { method: "POST", keepalive: true })
      .then((response) => {
        if (!response.ok) return;
        try {
          localStorage.setItem(KEY, String(Date.now()));
        } catch {
          // As above.
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
