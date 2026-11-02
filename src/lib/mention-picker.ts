/** The composer's side of mentions: finding the `@word` being typed and offering names for it. */

export type Mentionable = { id: string; name: string };

export const MENTION_RESULTS = 6;

/** The `@query` right before the caret, if the caret is in the middle of one. */
export function activeMention(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > 30) return null;
  return { start: at, query };
}

/** Names that start with the query (or any word of them does), best matches first. */
export function matchMentionables(people: Mentionable[], query: string): Mentionable[] {
  const needle = query.toLowerCase();
  const starts: Mentionable[] = [];
  const words: Mentionable[] = [];
  for (const person of people) {
    const name = person.name.toLowerCase();
    if (name.startsWith(needle)) starts.push(person);
    else if (name.split(/\s+/).some((word) => word.startsWith(needle))) words.push(person);
  }
  return [...starts, ...words].slice(0, MENTION_RESULTS);
}

/** Swap the `@query` for the chosen name and a space; the caret lands after it. */
export function insertMention(
  value: string,
  start: number,
  caret: number,
  label: string,
): { value: string; caret: number } {
  const inserted = /^\s/.test(value.slice(caret)) ? `@${label}` : `@${label} `;
  return { value: value.slice(0, start) + inserted + value.slice(caret), caret: start + inserted.length };
}
