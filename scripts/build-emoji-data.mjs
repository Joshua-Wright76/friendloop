#!/usr/bin/env node
/**
 * Builds public/emoji-picker.json, the list behind the reaction picker.
 *
 * The picker needs every emoji with a name to search by, but the data package is
 * 50 MB on disk, so it is not a dependency: unpack it anywhere and point this at it.
 *
 *   npm pack emojibase-data@18 && tar xzf emojibase-data-18.0.0.tgz
 *   node scripts/build-emoji-data.mjs ./package
 *
 * Only emoji up to version 15.1 are kept: newer ones show as an empty box on many
 * phones, and the server's check (`\p{RGI_Emoji}`) moves with the Node it runs on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-emoji-data.mjs <path to unpacked emojibase-data>");
  process.exit(1);
}

const MAX_VERSION = 15.1;
/** Emojibase's own numbering. Skin tones and hair parts (2) are not emoji anyone reacts with. */
const GROUPS = [[0, "smileys"], [1, "people"], [3, "nature"], [4, "food"], [5, "travel"], [6, "activities"], [7, "objects"], [8, "symbols"], [9, "flags"]];
const ONE_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

const read = (file) => JSON.parse(readFileSync(resolve(join(source, file)), "utf8"));
const versions = new Map(read("en/data.json").map((entry) => [entry.hexcode, entry.version]));
const pack = read("package.json");

const emoji = read("en/compact.json")
  .filter((entry) => GROUPS.some(([group]) => group === entry.group))
  .filter((entry) => (versions.get(entry.hexcode) ?? Infinity) <= MAX_VERSION)
  .filter((entry) => ONE_EMOJI.test(entry.unicode))
  .sort((a, b) => a.order - b.order)
  .map((entry) => {
    const skins = (entry.skins ?? []).map((skin) => skin.unicode).filter((unicode) => ONE_EMOJI.test(unicode));
    return {
      e: entry.unicode,
      n: entry.label,
      g: GROUPS.find(([group]) => group === entry.group)[1],
      t: (entry.tags ?? []).join(" "),
      // Only the plain five tones: a pair of people has 25, which a row of swatches can't offer.
      ...(skins.length === 5 ? { s: skins } : {}),
    };
  });

const out = { source: `${pack.name}@${pack.version} (${pack.license})`, emoji };
writeFileSync("public/emoji-picker.json", `${JSON.stringify(out)}\n`);
console.log(`${emoji.length} emoji from ${out.source}`);
