import copy from "../content/copy.json" with { type: "json" };

export { copy };

/** Fill named placeholders in editable copy, e.g. "Round {number}". */
export function text(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}
