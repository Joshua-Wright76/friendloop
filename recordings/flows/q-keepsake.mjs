import { rows } from "../../e2e/support/db.ts";
import { seedOpenIssue } from "../../e2e/support/seed.ts";
import { PQ1, PQ2, seedKeepsake } from "../../e2e/support/print.ts";
import { dressUploads } from "../lib/real-media.mjs";

const AREA = "Q · Keepsake export";
const LATE = "Added late, after the round went out";
const seed = async () => {
  const world = await seedKeepsake();
  await dressUploads(rows);
  return world;
};
const media = (t, value, scheme = "dark") => t.page("Emulation.setEmulatedMedia", {
  media: value, features: [{ name: "prefers-color-scheme", value: scheme }],
});
const countText = (t, needle) => t.eval(`(document.body.innerText.toLowerCase().match(new RegExp(${JSON.stringify(needle.toLowerCase())}, "g")) || []).length`);

export const flows = {
  Q1: { title: "Print an issue", area: AREA,
    staged: "Paper can't be shown: this is the ?print page on screen, then the same page under the browser's print media. window.print is replaced with a counter, so the print dialog is counted rather than opened. The PDF page count comes from the browser's own print-to-PDF of this page. The round is seeded, with stock pictures.",
    seed: async () => {
      const world = await seed();
      const open = await seedOpenIssue(world.loop, { openedAt: new Date("2026-11-06T08:00:00Z") });
      return { ...world, openIssueId: open.issueId };
    },
    run: async (t, world) => {
      await t.initScript(`window.__prints = 0; window.print = () => { window.__prints += 1; };`);
      const web = `/i/${world.issueId}?m=${world.alice.token}`;
      await media(t, "", "dark");
      await t.open(web);
      await t.say("A delivered round offers Print this round");
      await t.see("Print this round");
      await t.link("Print this round");
      await t.expectUrl(new RegExp(`/i/${world.issueId}\\?print&m=`));
      await t.see("Camping weekend");
      await t.say("The same address with ?print. Nothing prints by itself");
      await t.see("Print or save as PDF");
      t.check_((await t.eval("window.__prints")) === 0, "Arriving should not open the print dialog");
      await t.panel("print dialog opened on arrival", "0 times", { hold: 1600 });
      await t.say("Only a click does");
      await t.button("Print or save as PDF");
      t.check_((await t.eval("window.__prints")) === 1, "A click should open the print dialog once");
      await t.panel("print dialog after the click", "1 time", { hold: 1600 });
      await t.say("Named authors, never You. Answers, photos, voice-note cards");
      await t.dontSee("Budget stays secret.");
      t.check_(!(await t.eval(`[...document.querySelectorAll(".print-sheet *")].some((el) => el.children.length === 0 && el.textContent.trim() === "You")`)), "The print view says You");
      await t.see("A goose on the towpath", { hold: 500 });
      await t.see("Reactions: ❤️ 2", { hold: 500 });
      await t.see("Best goose ever", { hold: 500 });
      await t.see("Voice note, 0:04. Listen on the web round.", { hold: 500 });
      await t.see("asked by Maya", { hold: 500 });
      await t.say("Poll picks and tallies, credits and sections");
      await t.see("Results · 2 votes", { hold: 500 });
      await t.see("Marshmallows, obviously", { hold: 500 });
      await t.see("Rain Song, by The Keepsakes", { hold: 500 });
      await t.see("What a round!", { hold: 500 });
      await t.say("As paper: the toolbar is gone, from a dark screen, on light");
      await t.toTop();
      await media(t, "print", "dark");
      await t.pause(900);
      await t.dontSee("Print or save as PDF");
      await t.dontSee("Back to the round");
      const paper = await t.eval(`(() => {
        const css = getComputedStyle(document.querySelector(".print-sheet"));
        const before = [...document.querySelectorAll(".print-question")].map((el) => getComputedStyle(el).breakBefore);
        const avoid = [".print-answer", ".print-figure", ".print-card", ".print-comment"].every((sel) => [...document.querySelectorAll(sel)].every((el) => getComputedStyle(el).breakInside === "avoid"));
        return { background: css.backgroundColor, scheme: css.colorScheme, heading: getComputedStyle(document.querySelector("h1")).color, before, avoid,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          theme: document.documentElement.getAttribute("data-theme") };
      })()`);
      t.check_(paper.background === "rgb(255, 255, 255)" && paper.scheme === "light", `Paper: ${JSON.stringify(paper)}`);
      t.check_(paper.before.slice(1).every((value) => value === "page") && paper.before.length >= 5, `Question breaks: ${paper.before}`);
      t.check_(paper.avoid, "Something can split across pages");
      t.check_(paper.overflow <= 0, `Overflows sideways by ${paper.overflow}px`);
      const { data } = await t.page("Page.printToPDF", { printBackground: false, paperWidth: 8.27, paperHeight: 11.69 });
      const pdf = Buffer.from(data, "base64").toString("latin1");
      const pages = pdf.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
      t.check_(pdf.startsWith("%PDF-") && pages >= 5, `The PDF has ${pages} pages`);
      await t.panel("under print media", `screen theme ${paper.theme}, paper ${paper.background}\neach new question starts a page (${paper.before.length} questions)\nanswers, photos, cards, comments never split\nsideways overflow ${Math.max(0, paper.overflow)}px\nsaved as A4 PDF: ${pages} pages`, { hold: 5000 });
      await t.say("A tinted loop on a dark screen still prints on white");
      await rows("update groups set theme_preset = 'bluebell' where id = $1", [world.loop.groupId]);
      await t.open(`/i/${world.issueId}?print&m=${world.sam.token}`);
      await t.see("Budget stays secret.");
      const tint = await t.eval(`(() => { const css = getComputedStyle(document.querySelector(".print-sheet")); return { page: css.getPropertyValue("--page").trim(), accent: css.getPropertyValue("--accent").trim() }; })()`);
      t.check_(tint.page === "#ffffff" && tint.accent.toLowerCase() === "#2f5fb5", JSON.stringify(tint));
      await media(t, "", "dark");
      await t.say("A round that hasn't gone out has no print action");
      await t.open(`/i/${world.openIssueId}?m=${world.alice.token}`);
      await t.dontSee("Print this round");
      await t.open(`/i/${world.openIssueId}?print&m=${world.alice.token}`);
      await t.pause(500);
      t.check_(!(await t.eval(`Boolean(document.querySelector(".print-sheet"))`)), "?print should change nothing on an open round");
      await t.dontSee("Print or save as PDF");
      await t.say("Share-link readers can print too, without anyone's comments");
      await t.signInAs(null);
      await t.open(`/s/${world.shareToken}`);
      await t.link("Print this round");
      await t.expectUrl(/\/s\/[^?]+\?print$/);
      await t.see("A goose on the towpath");
      await t.see("Back to the round");
      await t.dontSee("What a round!");
      await t.dontSee("Budget stays secret.");
      await t.say("Turning sharing off ends the paper as well");
      await rows("update groups set share_enabled = false where id = $1", [world.loop.groupId]);
      await t.reload();
      await t.see("This page isn't here");
      await t.dontSee("A goose on the towpath");
    } },

  Q2: { title: "Late edits stay true", area: AREA,
    staged: "The round is seeded. Alice's late edits go through the real reply sheet; the owner's comment takedown, switching comments off and the rename are written directly to the database, since this flow is about what the print view then reads.",
    seed,
    run: async (t, world) => {
      const print = `/i/${world.issueId}?print&m=${world.alice.token}`;
      await t.open(print);
      await t.say("The print view today");
      await t.see("A goose on the towpath");
      await t.see(LATE);
      t.check_((await countText(t, LATE)) === 2, "Two answers should start out marked late");
      await t.say("After delivery, Alice edits her answer and adds a new one");
      await t.open(`/r/${world.alice.token}`);
      await t.click(`textarea[aria-label="${PQ1}"]`);
      await t.selectAllAndClear();
      await t.typeKeys("A goose, and then a swan");
      await t.fill(`textarea[aria-label="${PQ2}"]`, "Seeing everyone in June");
      await t.pause(600);
      await t.button("Save changes");
      await t.pause(1000);
      const saved = await rows("select body, added_after_delivery from replies where body in ('A goose, and then a swan', 'Seeing everyone in June')");
      t.check_(saved.length === 2 && saved.every((row) => row.added_after_delivery), `Saved: ${JSON.stringify(saved)}`);
      await t.say("An owner takes a comment down");
      await rows("update comments set deleted_at = now() where body = 'Agreed!'");
      await t.panel("comments", "\"Agreed!\" taken down by an owner", { hold: 1800 });
      await t.say("Print again: the current words, marked added late");
      await t.open(print);
      await t.see("A goose, and then a swan");
      await t.dontSee("A goose on the towpath");
      await t.see("Seeing everyone in June");
      const marks = await t.eval(`[...document.querySelectorAll(".print-answer")].filter((el) => el.innerText.includes(${JSON.stringify(LATE)})).map((el) => el.innerText)`);
      t.check_(marks.some((m) => m.includes("A goose, and then a swan")) && marks.some((m) => m.includes("Seeing everyone in June")), `Marked late: ${marks.length}`);
      const printed = await countText(t, LATE);
      await t.see("What a round!");
      await t.dontSee("Agreed!");
      await t.say("The web round says the same");
      await t.open(`/i/${world.issueId}?m=${world.alice.token}`);
      await t.see("added after the round went out");
      const web = await countText(t, "added after the round went out");
      t.check_(web === printed, `Print marks ${printed} as late, the web round ${web}`);
      await t.panel("marked late", `print view ${printed}\nweb round ${web}`, { hold: 2000 });
      await t.say("Comments switched off: gone from paper too");
      await rows("update groups set comments_enabled = false where id = $1", [world.loop.groupId]);
      await t.open(print);
      await t.see("A goose, and then a swan");
      await t.dontSee("What a round!");
      await t.dontSee("Best goose ever");
      await t.say("The round is renamed: the next print has the new name");
      await rows("update issues set name = 'Camping weekend, again' where id = $1", [world.issueId]);
      await t.reload();
      await t.see("Camping weekend, again");
      const title = await t.eval("document.title");
      t.check_(title === "Camping weekend, again · Friday Loop", `Page title: ${title}`);
    } },
};
