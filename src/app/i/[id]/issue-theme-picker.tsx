"use client";

import { useState, useTransition } from "react";
import { copy } from "@/lib/copy";
import type { IssueTheme } from "@/lib/issue-experience";
import { setIssueTheme as saveIssueTheme } from "./actions";

export function IssueThemePicker({
  issueId,
  theme,
  viewerToken,
}: {
  issueId: string;
  theme: IssueTheme | null;
  viewerToken: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <div className="issue-theme-picker">
      <label htmlFor="issue-theme" className="text-[12px] font-bold text-ink-soft">{copy.issue.issueTheme}</label>
      <select
        id="issue-theme"
        className="field mt-1 h-11 min-h-11 py-0 text-[14px]"
        value={theme ?? ""}
        disabled={pending}
        onChange={(event) => {
          const nextTheme = event.target.value || null;
          setMessage("");
          setFailed(false);
          startTransition(async () => {
            const result = await saveIssueTheme({ issueId, theme: nextTheme, viewerToken });
            setMessage(result.ok ? copy.issue.themeSaved : (result.error ?? copy.issue.errors.themeError));
            setFailed(!result.ok);
          });
        }}
      >
        <option value="">{copy.themes.issueDefault}</option>
        {copy.themes.packs.map((option) => (
          <option key={option.value} value={option.value}>{option.emoji} {option.label}</option>
        ))}
      </select>
      <p
        role={failed ? "alert" : "status"}
        aria-live="polite"
        className={`mt-1 min-h-5 text-[12px] ${failed ? "text-danger" : "text-ink-muted"}`}
      >
        {pending ? copy.issue.themeSaving : message}
      </p>
    </div>
  );
}
