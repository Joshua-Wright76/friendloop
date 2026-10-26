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
