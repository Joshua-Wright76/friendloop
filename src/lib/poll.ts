import { copy } from "./copy.ts";

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_PROMPT_MAX = 200;
export const POLL_OPTION_MAX = 80;

export type PollDraft = { prompt: string; options: string[]; multiple: boolean };

export type PollCheck =
  | { ok: true; poll: PollDraft }
  | { ok: false; error: string };

/**
 * Tidy what an owner typed into the option fields: trimmed, blanks dropped, and a
 * repeated option kept once (case aside), so two fields can't make a vote ambiguous.
 */
export function normalizePollOptions(raw: string[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const value of raw) {
    const option = value.trim();
    const key = option.toLowerCase();
    if (!option || seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  return options;
}

/** A poll is a prompt plus two to six distinct options of reasonable length. */
export function checkPoll(input: { prompt: string; options: string[]; multiple: boolean }): PollCheck {
  const prompt = input.prompt.trim();
  const options = normalizePollOptions(input.options);
  if (!prompt || prompt.length > POLL_PROMPT_MAX) {
    return { ok: false, error: copy.polls.errors.prompt };
  }
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
    return { ok: false, error: copy.polls.errors.optionCount };
  }
  if (options.some((option) => option.length > POLL_OPTION_MAX)) {
    return { ok: false, error: copy.polls.errors.optionLength };
  }
  return { ok: true, poll: { prompt, options, multiple: input.multiple } };
}

/**
 * The option indexes a voter may save: whole numbers inside the poll, no repeats,
 * and only one of them unless the poll is multiple-choice. Anything else is
 * rejected whole rather than quietly trimmed. An empty pick clears the vote.
 */
export function checkPollChoices(raw: unknown, optionCount: number, multiple: boolean): number[] | null {
  if (!Array.isArray(raw)) return null;
  const choices: number[] = [];
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value >= optionCount) return null;
    if (choices.includes(value)) return null;
    choices.push(value);
  }
  if (!multiple && choices.length > 1) return null;
  return choices.sort((a, b) => a - b);
}

export type PollTallyRow = { option: string; votes: number };

/** One row per option, in the poll's own order, with how many people picked it. */
export function tallyPoll(options: string[], picks: number[][]): PollTallyRow[] {
  return options.map((option, index) => ({
    option,
    votes: picks.filter((choices) => choices.includes(index)).length,
  }));
}
