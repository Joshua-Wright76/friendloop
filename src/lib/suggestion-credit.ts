export type AuthorDisplay = "name" | "anonymous";

/** Same cap the question pool uses, so an accepted suggestion fits anywhere a question goes. */
export const SUGGESTION_MAX_LENGTH = 200;

/**
 * The name an issue shows for a suggestion's author, or null for an anonymous
 * one. Pure so the snapshot rule stays testable without a database.
 */
export function suggestionCredit(authorDisplay: AuthorDisplay, displayName: string | null): string | null {
  if (authorDisplay !== "name") return null;
  const name = displayName?.trim();
  return name ? name : null;
}
