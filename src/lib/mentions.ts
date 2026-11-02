/**
 * Mentions in a comment.
 *
 * A mention is stored as `@[<membership id>]` inside the comment's plain text, and
 * drawn as that person's current name. The id is the reference: renaming someone
 * later renames them in every comment that mentions them, and a mention can never
 * point at the wrong person because two people share a name.
 */

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MARKER = new RegExp(`@\\[(${ID})\\]`, "gi");

/** A name the composer inserted, and the member it stands for. */
export type MentionPick = { id: string; label: string };

export type BodyPart = { type: "text"; text: string } | { type: "mention"; id: string; name: string };

export function isUuid(value: string): boolean {
  return new RegExp(`^${ID}$`, "i").test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn the `@Name` text a person typed into stored markers. A pick whose name was
 * edited out of the text again is dropped, and a repeated pick marks the next
 * occurrence, so two people called "Sam" stay two people when both are mentioned.
 */
export function markMentions(body: string, picks: MentionPick[]): { body: string; ids: string[] } {
  let marked = body;
  const ids: string[] = [];

  for (const pick of picks) {
    const pattern = new RegExp(`@${escapeRegExp(pick.label)}(?![\\p{L}\\p{N}_])`, "gu");
    pattern.lastIndex = 0;
    const found = pattern.exec(marked);
    if (!found) continue;

    const marker = `@[${pick.id}]`;
    marked = marked.slice(0, found.index) + marker + marked.slice(found.index + found[0].length);
    if (!ids.includes(pick.id)) ids.push(pick.id);
  }

  return { body: marked, ids };
}

/** Every membership id a stored body mentions, once each, in order. */
export function mentionIds(body: string): string[] {
  const ids: string[] = [];
  for (const match of body.matchAll(MARKER)) {
    const id = match[1].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** A stored body as text and mention parts, with each mention resolved to a name. */
export function bodyParts(body: string, names: Map<string, string>, unknown: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(MARKER)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", text: body.slice(last, index) });
    const id = match[1].toLowerCase();
    parts.push({ type: "mention", id, name: names.get(id) ?? unknown });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ type: "text", text: body.slice(last) });
  return parts;
}

/** The body as one line of text: mentions become `@Name`. For quotes and emails. */
export function plainBody(body: string, names: Map<string, string>, unknown: string): string {
  return bodyParts(body, names, unknown)
    .map((part) => (part.type === "text" ? part.text : `@${part.name}`))
    .join("");
}

/** The first `max` characters, cut on a word where there is one. */
export function excerpt(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
