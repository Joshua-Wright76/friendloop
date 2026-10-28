function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      const point = Number.parseInt(lower.slice(2), 16);
      if (point === 0) return "";
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    if (lower.startsWith("#")) {
      const point = Number.parseInt(lower.slice(1), 10);
      if (point === 0) return "";
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return named[lower] ?? entity;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<blockquote\b[\s\S]*$/i, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:address|blockquote|div|h[1-6]|li|p|pre|section|table|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

/** Keep the sender's new text, not the quoted issue or their mail signature. */
export function commentFromEmail(input: { text?: string | null; html?: string | null }): string {
  const source = input.text?.trim() ? input.text : htmlToText(input.html ?? "");
  const normalized = source
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const cutoffs = [
    /^On [^\n]+(?:\n[^\n]+)?wrote:\s*$/im,
    /^From:\s.*\nSent:\s/im,
    /^-----Original Message-----/im,
    /^>+\s?/m,
    /^--\s*$/m,
    /^Sent from my /im,
    /^Get Outlook for /im,
  ];

  let end = normalized.length;
  for (const pattern of cutoffs) {
    const match = pattern.exec(normalized);
    if (match?.index !== undefined) end = Math.min(end, match.index);
  }

  return normalized
    .slice(0, end)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
