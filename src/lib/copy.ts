import copy from "../content/copy.json" with { type: "json" };

export { copy };

const reported = new Set<string>();

/**
 * Fill named placeholders in editable copy, e.g. "Round {number}".
 *
 * A missing value used to render as a literal `{count}` on the page. In
 * development that is now also a console error, so a copy edit that forgets a
 * value is caught by whoever made it rather than by a reader.
 */
export function text(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => {
    const value = values[key];
    if (value === undefined) {
      if (process.env.NODE_ENV !== "production" && !reported.has(placeholder)) {
        reported.add(placeholder);
        console.error(`[copy] No value for ${placeholder} in "${template}"`);
      }
      return placeholder;
    }
    return String(value);
  });
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern that matches editable copy as it appears on the page, so a test can
 * find "Role for Bob" or the start of a long hint without repeating the words.
 * Placeholders take the given values (a RegExp is used as a pattern), or match
 * any text when left out.
 */
export function copyPattern(
  template: string,
  options: { values?: Record<string, string | number | RegExp>; start?: boolean; end?: boolean; flags?: string } = {},
): RegExp {
  const { values = {}, start = false, end = false, flags } = options;
  const source = template
    .split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/)
    .map((part) => {
      const key = /^\{([a-zA-Z][a-zA-Z0-9]*)\}$/.exec(part)?.[1];
      if (!key) return escapeRegExp(part);
      if (!(key in values)) return ".+?";
      const value = values[key];
      return value instanceof RegExp ? `(?:${value.source})` : escapeRegExp(String(value));
    })
    .join("");
  return new RegExp(`${start ? "^" : ""}${source}${end ? "$" : ""}`, flags);
}
