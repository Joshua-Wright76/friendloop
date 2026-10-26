export const MAX_DISPLAY_NAME = 60;

/** "  Ada   Lovelace " -> "Ada Lovelace"; blank or control-only input is "no name". */
export function cleanDisplayName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
