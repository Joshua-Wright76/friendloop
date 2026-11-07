const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?member=` in the rounds list: a membership id, or nothing. Safe for the browser. */
export function parseMemberFilter(value: string | string[] | null | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return UUID.test(raw) ? raw.toLowerCase() : null;
}
