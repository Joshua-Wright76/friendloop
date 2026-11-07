import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { TINY_PNG } from "../../e2e/support/comments.ts";
import { addMember, seedLoop } from "../../e2e/support/seed.ts";
import { createSection } from "../../src/lib/sections.ts";
import { clickIn, find, postForm, retype, until } from "../lib/scoped.mjs";

const AREA = "K · Sections (and music picks)";
const OWNER = "owner@friendloop.test";
const OPEN = new Date("2026-01-02T08:00:00Z");
const DELIVER = new Date("2026-01-09T09:00:00Z");
const member = (loop, prefix) => loop.members.find((person) => person.email.startsWith(prefix));
const ROW = '[aria-label="Sections in order"] li';
const EXTRA = 'section[aria-label="And a little extra"]';
const SPOTIFY = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";
const ARTWORK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4a261"/><stop offset="1" stop-color="#264653"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/></svg>')}`;

/** A section already in the loop, and the round that carries it already open. */
async function sectionInOpenRound(t, input) {
  const loop = await seedLoop();
  const made = await createSection({ groupId: loop.groupId, kind: "standard", emoji: null, description: null, adminOnly: false, at: new Date("2026-01-01T12:00:00Z"), ...input });
  if (!made.ok) throw new Error(made.error);
  await t.sweep(OPEN, { show: false });
  return { loop, groupId: loop.groupId, alice: member(loop, "alice"), bob: member(loop, "bob"), ownerToken: loop.ownerToken };
}

async function addSection(t, title, { kind, emoji, adminOnly } = {}) {
  await t.fillPlaceholder("The potluck corner", title);
  if (emoji) await t.fillLabel("Emoji", emoji);
  if (kind) await t.select("#section-kind", kind);
  if (adminOnly) await t.clickRole("checkbox", "Owner and admins only");
  await t.button("Add section");
  await t.see("Section added.");
}

const firstIssue = async (t) => (await t.sql("select id from issues order by number asc limit 1"))[0].id;

export const flows = {
  K1: { title: "Manage sections", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      return { groupId: loop.groupId, alice: member(loop, "alice") };
    },
    run: async (t, { groupId, alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.say("The owner adds a section");
      await addSection(t, "The potluck corner", { emoji: "🍲" });
      await t.say("And a second, for music");
      await addSection(t, "Music picks", { kind: "music" });
      await t.say("Music moves to the top");
      await t.button("Move section up: Music picks");
      await t.see("Section order updated.");
      await until(t, `document.querySelector('${ROW}').innerText.includes("Music picks")`, "Music picks should be first");
      await t.say("Editing a title sticks");
      await t.click(await find(t, ROW, "The potluck corner", "summary"));
      await retype(t, await find(t, ROW, "The potluck corner", 'input[name="title"]'), "The potluck corner, revisited");
      await t.click(await find(t, ROW, "The potluck corner", "button", "Save section"));
      await t.see("Section updated.");
      await t.see("The potluck corner, revisited");
      await t.say("Round 1 opens with both sections, and Alice answers");
      await t.sweep(OPEN);
      await t.signInAs(null);
      await t.open(`/r/${alice.token}`);
      await t.see("The potluck corner, revisited");
      await t.click('textarea[aria-label="The potluck corner, revisited"]');
      await t.typeKeys("Banana bread, again.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("The owner archives the potluck corner");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.click(await find(t, ROW, "The potluck corner, revisited", "button", "Archive"));
      await t.click(await find(t, ROW, "The potluck corner, revisited", "button", "Yes, archive"));
      await t.see("Section archived.");
      await t.dontSee("The potluck corner, revisited");
      await t.say("Round 1 goes out and round 2 opens");
      await t.sweep(DELIVER);
      const [{ id: first }] = await t.sql("select id from issues order by number asc limit 1");
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.signInAs(null);
      await t.say("Round 2's sheet has only Music picks");
      await t.open(`/r/${alice.token}`);
      await t.see("Music picks");
      await t.dontSee("The potluck corner");
      await t.say("Round 1 keeps the section it was sent with");
      await t.open(`/i/${first}?m=${alice.token}`);
      await t.see("The potluck corner, revisited");
      await t.see("Banana bread, again.");
    } },

  K2: { title: "Sections reach an issue", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const rita = await addMember(loop, { email: "rita@friendloop.test", name: "Rita", participation: "reader" });
      return { groupId: loop.groupId, alice: member(loop, "alice"), rita };
    },
    run: async (t, { groupId, alice, rita }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.say("The owner adds a section before the round opens");
      await addSection(t, "The potluck corner");
      await t.say("The sweep copies it into the new round");
      await t.sweep(OPEN);
      await t.signInAs(null);
      await t.say("On Alice's sheet it sits after the questions");
      await t.open(`/r/${alice.token}`);
      await t.see("And a little extra");
      await t.see("The potluck corner");
      await t.click('textarea[aria-label="The potluck corner"]');
      await t.typeKeys("Never too many dips.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("Rita is a reader: no prompt email, and no box on her link");
      const prompts = await t.mailCount({ to: rita.email });
      t.check_(prompts === 0, `Reader got ${prompts} emails before delivery`);
      await t.open(`/r/${rita.token}`);
      await t.dontSee("Never too many dips.");
      await until(t, `!document.querySelector('textarea[aria-label="The potluck corner"]')`, "A reader should have no answer box");
      await t.pause(800);
      await t.say("The round goes out");
      await t.sweep(DELIVER);
      const issueId = await firstIssue(t);
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.say("Rita reads the section, read-only");
      await t.open(`/i/${issueId}?m=${rita.token}`);
      await t.see("The potluck corner");
      await t.see("Never too many dips.");
      await t.say("Her delivery email has it too");
      await t.openMail({ to: rita.email, subject: "round 1" });
      t.check_(t.lastMail.HTML.includes("The potluck corner"), "The delivery email should carry the section");
      await t.tour({ max: 4 });
    } },

  K3: { title: "Standard section reply", area: AREA,
    staged: "The section and the open round are set up off camera. The second-photo refusal is a real POST, shown because the form is gone at the cap.",
    seed: (t) => sectionInOpenRound(t, { title: "The potluck corner" }),
    run: async (t, { alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice answers a standard section with text");
      await t.see("The potluck corner");
      await t.click('textarea[aria-label="The potluck corner"]');
      await t.typeKeys("Banana bread, again.");
      await t.say("And one photo");
      await t.upload(`${EXTRA} input[type=file]`, "photo1.jpg");
      await t.see("Photo added.");
      await t.say("Standard sections take one: a second is refused");
      const [section] = await t.sql("select id from issue_sections where title = 'The potluck corner' limit 1");
      const refused = await postForm(t, `/api/reply/${alice.token}/section-media`, { issueSectionId: section.id, caption: "", position: "1" },
        { at: AFTER_FIRST_SLOT, file: { field: "photo", name: "second.png", type: "image/png", bytes: TINY_PNG } });
      t.check_(refused.status === 409 && refused.text.includes("Standard sections"), `Second photo got ${refused.status} ${refused.text}`);
      await t.panel(`POST /api/reply/…/section-media`, `HTTP ${refused.status}\n${refused.text}`);
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("The round goes out with both");
      await t.sweep(DELIVER);
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.open(`/i/${await firstIssue(t)}?m=${alice.token}`);
      await t.see("Banana bread, again.");
      await until(t, `[...document.querySelectorAll('img')].some((img) => img.src.includes('/uploads/') && img.naturalWidth > 0)`, "The section photo should render");
      await t.scroll(280);
      await t.pause(800);
    } },

  K4: { title: "Photo wall reply", area: AREA,
    seed: (t) => sectionInOpenRound(t, { title: "The wall", kind: "photo_wall" }),
    run: async (t, { alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("A photo wall. A photo joins it with no caption at all");
      const file = `${EXTRA} input[type=file]`;
      const caption = `${EXTRA} input[placeholder="Caption (optional)"]`;
      await t.upload(file, "photo1.jpg");
      await t.see("Photo added.");
      const [{ count: one }] = await t.sql("select count(*)::int as count from section_media");
      t.check_(one === 1, "A photo with no caption should be stored");
      await t.say("Or with a caption, up to six");
      const captions = ["The leftovers", "Dessert first", "Grandma's chair", "The long walk", "Everyone asleep"];
      for (const [index, line] of captions.entries()) {
        await retype(t, caption, line);
        await t.upload(file, `photo${index + 2}.jpg`);
        await t.see(line, { hold: 150 });
      }
      await until(t, `!document.querySelector('${file}')`, "The add-photo slot should go away at six");
      await t.say("At six the add button is gone");
      await t.pause(600);
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("Delivered: edge to edge, each with its author and any caption");
      await t.sweep(DELIVER, { show: false });
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.open(`/i/${await firstIssue(t)}?m=${alice.token}`);
      await t.see("The leftovers");
      await t.see("Everyone asleep");
      await t.say("Tapping one opens the same viewer as the Album");
      await t.button("The wall");
      await t.see("Photo 1 of 6");
      const download = await t.eval(`document.querySelector('dialog[open] a[download]')?.getAttribute("download")`);
      t.check_(/^friendloop-.+-1\.jpe?g$/.test(download ?? ""), `Download attribute was ${download}`);
      await t.see("Download");
      await t.say("Next and previous step through the wall");
      await t.click(await find(t, "dialog[open]", "Photo 1 of 6", "button", "Next"));
      await t.see("Photo 2 of 6");
      await t.see("The leftovers");
      await t.say("Escape closes it and returns focus to the photo");
      await t.press("Escape");
      await until(t, `!document.querySelector('dialog[open]')`, "The viewer should close");
      await until(t, `(document.activeElement?.getAttribute("aria-label") ?? "").includes("The wall")`, "Focus should return to the photo that opened the viewer");
      await t.pause(800);
    } },

  K5: { title: "Paste a music link", area: AREA,
    staged: "The provider's metadata is cached off camera, so saving doesn't reach Spotify.",
    seed: async (t) => {
      const data = await sectionInOpenRound(t, { title: "Music picks", kind: "music" });
      await rows("insert into music_links (url, provider, title, fetched_at) values ($1, 'spotify', 'Our road trip record', now())", [SPOTIFY]);
      return data;
    },
    run: async (t, { alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice pastes a link that isn't music");
      await t.fillPlaceholder("Paste a Spotify, Bandcamp, or Qobuz link", "https://example.com/album/123");
      await t.button("Save pick");
      await t.see("That link isn't a Spotify, Bandcamp, or Qobuz page.");
      const none = await t.sql("select count(*)::int as count from section_replies where link_url is not null");
      t.check_(none[0].count === 0, "An invalid link should not be stored");
      await t.panel("section_replies", `rows with a link: ${none[0].count}`, { hold: 1800 });
      await t.say("A Spotify link with a caption saves");
      await t.fillPlaceholder("Paste a Spotify, Bandcamp, or Qobuz link", SPOTIFY);
      await t.click(`${EXTRA} input[placeholder="One line about it"]`);
      await t.typeKeys("Our road trip record");
      await t.button("Save pick");
      await t.see("Saved.");
      const saved = await t.sql("select link_url, link_provider from section_replies where link_url is not null");
      t.check_(saved[0]?.link_provider === "spotify", `Saved ${JSON.stringify(saved)}`);
      await t.panel("section_replies", `link_provider: ${saved[0].link_provider}\nlink_url: ${saved[0].link_url}`, { hold: 2200 });
    } },

  K6: { title: "Music renders", area: AREA,
    staged: "The provider's metadata and artwork are cached off camera, so rendering doesn't reach Spotify. The artwork is a stand-in image.",
    seed: async (t) => {
      const data = await sectionInOpenRound(t, { title: "Music picks", kind: "music" });
      await rows("insert into music_links (url, provider, title, artwork_url, fetched_at) values ($1, 'spotify', 'Our road trip record', $2, now())", [SPOTIFY, ARTWORK]);
      return data;
    },
    run: async (t, { alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice saves a pick");
      await t.fillPlaceholder("Paste a Spotify, Bandcamp, or Qobuz link", SPOTIFY);
      await t.click(`${EXTRA} input[placeholder="One line about it"]`);
      await t.typeKeys("Windows down, volume up");
      await t.button("Save pick");
      await t.see("Saved.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("The round goes out");
      await t.sweep(DELIVER, { show: false });
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.open(`/i/${await firstIssue(t)}?m=${alice.token}`);
      await t.say("A card: artwork, title, provider badge");
      await t.see("Our road trip record");
      await t.see("Spotify");
      const card = await t.eval(`(() => { const a = document.querySelector("a.music-card-head"); return a && { href: a.href, target: a.target, art: a.querySelector("img")?.naturalWidth ?? 0 }; })()`);
      t.check_(card?.href === SPOTIFY, `Card links to ${card?.href}`);
      t.check_(card.art > 0, "The card should show its artwork");
      await t.panel("the card's link", `href: ${card.href}\ntarget: ${card.target}`, { hold: 2200 });
      await t.say("The delivery email carries the pick and its link");
      await t.openMail({ to: alice.email, subject: "round 1" });
      t.check_(t.lastMail.HTML.includes(SPOTIFY), "The email should carry the link");
      const hasTitle = `${t.lastMail.HTML} ${t.lastMail.Text}`.includes("Our road trip record");
      t.check_(hasTitle, 'K6 asks for title + link in the delivery email');
      await t.panel("delivery email", `metadata title present: ${hasTitle ? "yes" : "NO"}\ncaption present: ${t.lastMail.HTML.includes("Windows down, volume up") ? "yes" : "NO"}\nlink: ${SPOTIFY}`, { hold: 2600 });
    } },

  K7: { title: "Admin-only sections", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      return { groupId: loop.groupId, alice: member(loop, "alice"), ownerToken: loop.ownerToken };
    },
    run: async (t, { groupId, alice, ownerToken }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.say("The owner adds a section only owner and admins can see");
      await addSection(t, "Committee notes", { adminOnly: true });
      await t.sweep(OPEN);
      await t.signInAs(null);
      await t.say("The owner gets a box for it");
      await t.open(`/r/${ownerToken}`);
      await t.see("Committee notes");
      await t.click('textarea[aria-label="Committee notes"]');
      await t.typeKeys("Budget looks fine.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("Alice's sheet doesn't show it");
      await t.open(`/r/${alice.token}`);
      await t.see("What made you laugh this week?");
      await t.dontSee("Committee notes");
      await t.say("Nor does her prompt email");
      const [section] = await t.sql("select id from issue_sections limit 1");
      await t.openMail({ to: alice.email }, { inbox: false });
      t.check_(!t.lastMail.HTML.includes("Committee notes"), "The prompt email should not name the section");
      await t.say("The API refuses a write to it");
      const refused = await t.request("POST", `/api/reply/${alice.token}`, { body: { action: "sectionDraft", issueSectionId: section.id, body: "sneaky" } });
      t.check_(refused.status === 403, `Member write returned ${refused.status}`);
      await t.say("The round goes out");
      await t.sweep(DELIVER, { show: false });
      const issueId = await firstIssue(t);
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.say("Alice's issue: no sign of it");
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("Round 1");
      await t.dontSee("Committee notes");
      await t.dontSee("Budget looks fine.");
      await t.say("The owner's issue has it");
      await t.open(`/i/${issueId}?m=${ownerToken}`);
      await t.see("Committee notes");
      await t.see("Budget looks fine.");
    } },

  K8: { title: "Snapshot truth", area: AREA,
    seed: (t) => sectionInOpenRound(t, { title: "The potluck corner" }),
    run: async (t, { groupId, alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.say("Round 1 is open with the section as it reads now");
      await t.open(`/r/${alice.token}`);
      await t.see("The potluck corner");
      await t.say("The owner rewords it while round 1 is open");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.click(await find(t, ROW, "The potluck corner", "summary"));
      await retype(t, await find(t, ROW, "The potluck corner", 'input[name="title"]'), "The potluck corner, revisited");
      await t.click(await find(t, ROW, "The potluck corner", "button", "Save section"));
      await t.see("Section updated.");
      await t.see("The potluck corner, revisited");
      await t.signInAs(null);
      await t.say("Alice's open sheet keeps the old wording");
      await t.open(`/r/${alice.token}`);
      await t.see("The potluck corner");
      await t.dontSee("revisited");
      await t.click('textarea[aria-label="The potluck corner"]');
      await t.typeKeys("Banana bread, again.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("So does the delivered issue");
      await t.sweep(DELIVER, { show: false });
      const issueId = await firstIssue(t);
      await t.clock(new Date("2026-01-09T09:05:00Z"));
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("The potluck corner");
      await t.dontSee("revisited");
      await t.say("Round 2 carries the new wording");
      await t.open(`/r/${alice.token}`);
      await t.see("The potluck corner, revisited");
      const titles = await t.sql("select i.number, s.title from issue_sections s join issues i on i.id = s.issue_id order by i.number");
      t.check_(titles[0].title === "The potluck corner" && titles.slice(1).every((row) => row.title.endsWith("revisited")), `Titles ${JSON.stringify(titles)}`);
      await t.panel("issue_sections", titles.map((row) => `round ${row.number}: ${row.title}`).join("\n"), { hold: 2400 });
    } },
};
