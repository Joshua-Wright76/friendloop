import type { Interaction } from "../lib/types";
import { newLoopInteractions } from "./new-loop";
import { peopleInteractions } from "./people";
import { publicInteractions } from "./public";
import { questionInteractions } from "./questions";
import { readingInteractions } from "./reading";
import { replyInteractions } from "./reply";
import { roundInteractions } from "./rounds";
import { settingsInteractions } from "./settings";
import { siteInteractions } from "./site";
import { tabInteractions } from "./tabs";
import { youInteractions } from "./you";

/** Every interaction the lab times. Grouped by surface; ids are forever. */
export const INTERACTIONS: Interaction[] = [
  ...publicInteractions,
  ...youInteractions,
  ...newLoopInteractions,
  ...tabInteractions,
  ...peopleInteractions,
  ...questionInteractions,
  ...roundInteractions,
  ...settingsInteractions,
  ...replyInteractions,
  ...readingInteractions,
  ...siteInteractions,
];

const seen = new Set<string>();
for (const interaction of INTERACTIONS) {
  if (seen.has(interaction.id)) throw new Error(`Duplicate interaction id: ${interaction.id}`);
  seen.add(interaction.id);
}
