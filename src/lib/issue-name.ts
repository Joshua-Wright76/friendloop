import { copy, text } from "./copy.ts";

export const MAX_ISSUE_NAME = 60;

/** Trim, flatten whitespace and control characters, cap the length. Nothing left means "unnamed". */
export function cleanIssueName(raw: string | null | undefined): string | null {
  const name = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ISSUE_NAME)
    .trim();
  return name === "" ? null : name;
}

/** "Camping weekend", or the numbered default from whichever surface's own template is passed. */
export function issueTitle(template: string, number: number, name: string | null | undefined): string {
  return name?.trim() ? name : text(template, { number });
}

/** The same, for the middle of a sentence ("a comment on round 12"). */
export function issueRef(number: number, name: string | null | undefined): string {
  return name?.trim() ? name : text(copy.emails.roundRef, { number });
}

/** The same, for a heading ("Round 12"). */
export function issueHeading(number: number, name: string | null | undefined): string {
  return name?.trim() ? name : text(copy.emails.roundHeading, { number });
}
