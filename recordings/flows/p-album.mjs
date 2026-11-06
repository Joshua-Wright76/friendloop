import { rows } from "../../e2e/support/db.ts";
import { enableShare } from "../../e2e/support/audio.ts";
import { seedAlbum } from "../../e2e/support/album.ts";
import { dressUploads, playFirstNote } from "../lib/real-media.mjs";

const AREA = "P · The Album";
const OWNER = "owner@friendloop.test";
const NOT_FOUND = "This page isn't here";
const STAGED = "The rounds, photos and voice notes are seeded (two delivered rounds, one still open, a draft and an owners-only section); stock pictures and a test tone stand in for what people would upload.";
const seed = async () => {
  const world = await seedAlbum();
  await dressUploads(rows);
  return world;
};
/** What the address bar says, for a video that has no address bar. */
const query = async (t) => decodeURIComponent(new URL(await t.currentUrl()).search || "(no filters)");
const clearInto = async (t, selector, text) => {
  await t.click(selector);
  await t.selectAllAndClear();
  await t.typeKeys(text);
};

export const flows = {
  P1: { title: "Browse the album", area: AREA, staged: STAGED, seed,
    run: async (t, world) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${world.loop.groupId}`);
      await t.say("The Album is a tab of the loop");
      await t.link("Album", { exact: true });
      await t.expectUrl(/\/album$/);
      await t.say("Every photo and voice note, grouped by round, newest first");
      await t.see("8 photos and voice notes");
      const groups = await t.eval(`[...document.querySelectorAll("h2")].map((h) => h.innerText.trim())`);
      t.check_(groups.indexOf("Camping weekend") === 0 && groups.indexOf("Round 1") === 1, `Rounds in order: ${groups}`);
      await t.dontSee("Surprise party plans");
      await t.dontSee("Never submitted");
      await t.panel("not shown", "the open round's photo: absent\nthe unsent draft's photo: absent", { hold: 2200 });
      await t.say("Voice notes play right here");
      await playFirstNote(t, ".album-grid audio");
      await t.say("A photo opens fullscreen");
      await t.button("Open photo from Bob: Tent at dawn");
      await t.see("Photo 1 of 6");
      await t.see("Tent at dawn");
      await t.see("Download");
      if (t.isMobile) { // a phone has no arrow keys, and the viewer has no swipe: the buttons are the touch path
        await t.say("Move with the buttons");
        await t.button("Next photo");
      } else {
        await t.say("Move with the arrow keys or the buttons");
        await t.press("ArrowRight");
      }
      await t.see("Photo 2 of 6");
      await t.button("Next photo");
      await t.see("Photo 3 of 6");
      await t.see("Marshmallows, obviously");
      await t.button("Previous photo");
      await t.see("Photo 2 of 6");
      if (t.isMobile) {
        await t.say("Close it, and you're back on the photo");
        await t.button("Close");
      } else {
        for (let step = 0; step < 6; step += 1) await t.ab("press", "Tab");
        t.check_(await t.eval(`Boolean(document.activeElement?.closest("dialog"))`), "Tab left the viewer");
        await t.say("Escape closes it, and focus returns to the photo");
        await t.press("Escape");
      }
      await t.dontSee("Photo 2 of 6");
      const focused = await t.eval(`document.activeElement?.getAttribute("aria-label")`);
      t.check_(focused === "Open photo from Bob: Tent at dawn", `Focus went to: ${focused}`);
      await t.say("View in the round lands on that very answer");
      await t.button("Open photo from Bob: Tent at dawn");
      await t.see("Photo 1 of 6", { hold: 300 });
      await t.link("View in the round");
      await t.expectUrl(new RegExp(`/i/${world.round2}#answer-`));
      await t.pause(900);
      const landed = await t.eval(`(() => {
        const el = document.getElementById(location.hash.slice(1));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { text: el.innerText, inView: r.top < innerHeight && r.bottom > 0 };
      })()`);
      t.check_(landed?.text.includes("Tent at dawn") && landed.inView, `Landed on: ${JSON.stringify(landed)}`);
      await t.see("Tent at dawn");
      await t.say("From an inbox link: the round links to the same Album");
      await t.signInAs(null);
      await t.open(`/i/${world.round2}?m=${world.alice.token}`);
      await t.link("See the album");
      await t.expectUrl(new RegExp(`/album/${world.loop.groupId}\\?m=`));
      await t.say("Seven here, not eight: the owners-only photo stays hidden");
      await t.see("7 photos and voice notes");
      await t.dontSee("Budget receipt");
      await t.see("You");
    } },

  P2: { title: "Filter and search", area: AREA, staged: `${STAGED} Thirty extra captioned photos are added mid-take to show the paging.`, seed,
    run: async (t, world) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${world.loop.groupId}/album`);
      await t.say("Choose one person");
      await t.select('select[name="member"]', world.bob.id);
      await t.button("Show", { exact: true });
      await t.expectUrl(new RegExp(`member=${world.bob.id}`));
      await t.see("2 photos and voice notes");
      await t.see("Tent at dawn");
      await t.dontSee("The lake swim");
      await t.say("The address carries the filter");
      await t.panel("the address", await query(t), { hold: 2000 });
      await t.link("Clear filters");
      await t.expectUrl(/\/album$/);
      await t.say("Search a word: answers, captions, the question asked");
      await clearInto(t, 'input[name="q"]', "MARSHMALLOWS");
      await t.button("Show", { exact: true });
      await t.see("1 photo or voice note");
      await t.see("Marshmallows, obviously");
      await t.say("Every word must turn up, here from the question itself");
      await clearInto(t, 'input[name="q"]', "looking forward");
      await t.button("Show", { exact: true });
      await t.see("3 photos and voice notes");
      await t.say("Person and word together");
      await t.select('select[name="member"]', world.alice.id);
      await t.button("Show", { exact: true });
      await t.see("2 photos and voice notes");
      await t.panel("the address", (await query(t)).replace(world.alice.id, "<Alice>"), { hold: 2000 });
      await t.say("Nothing matching says so, with a way out");
      await clearInto(t, 'input[name="q"]', "zebra");
      await t.button("Show", { exact: true });
      await t.see("Nothing matches that.");
      await t.link("Clear filters");
      await t.see("8 photos and voice notes");
      await t.say("A long album grows a page at a time");
      const [{ id: replyId }] = await rows("select id from section_replies limit 1");
      await rows(`insert into section_media (section_reply_id, url, caption, position)
        select $1, u.url, 'Extra ' || n, 10 + n from (select url from section_media limit 1) u, generate_series(1, 30) n`, [replyId]);
      await t.reload();
      await t.see("24 of 38");
      await t.link("Show more");
      await t.expectUrl(/pages=2$/);
      await t.see("38 photos and voice notes");
      t.check_((await t.eval(`document.querySelectorAll(".album-grid > li").length`)) === 38, "All 38 should be showing");
      await t.say("And it keeps the filter as it grows");
      await t.open(`/g/${world.loop.groupId}/album?q=extra`);
      await t.see("24 of 30");
      await t.link("Show more");
      await t.expectUrl(/q=extra&pages=2/);
      await t.see("30 photos and voice notes");
      await t.panel("the address", await query(t), { hold: 2000 });
    } },

  P3: { title: "Privacy holds", area: AREA, staged: `${STAGED} Sharing and revoking are set directly in the database. Each page's raw HTML is also fetched outside the browser and checked for leaks.`,
    seed: async () => {
      const world = await seed();
      await enableShare({ groupId: world.loop.groupId, issueId: world.round2, shareToken: "album-share-token" });
      return world;
    },
    run: async (t, world) => {
      const album = `/album/${world.loop.groupId}`;
      /** Show the visit, and check the bytes too: a streamed page can answer 200 before it misses. */
      const refused = async (path) => {
        const { text } = await t.request("GET", path, { show: false });
        for (const leak of ["Tent at dawn", "/uploads/", "album-grid"]) t.check_(!text.includes(leak), `${path} leaks ${leak}`);
        await t.open(path);
        await t.see(NOT_FOUND);
        await t.dontSee("Tent at dawn");
      };
      await t.say("A share-link visitor has no door to the Album");
      await t.open("/s/album-share-token");
      await t.see("Camping weekend");
      await t.dontSee("See the album");
      t.check_((await t.eval(`document.querySelectorAll('a[href*="/album/"]').length`)) === 0, "The shared round links to the album");
      await t.say("The share token opens nothing there");
      await refused(`${album}?m=album-share-token`);
      await t.say("Nor does no token, or a made-up one");
      await refused(album);
      await refused(`${album}?m=${world.alice.token}x`);
      await t.say("Bob is removed from the loop: his link stops working");
      await rows("update memberships set revoked_at = now() where id = $1", [world.bob.id]);
      await refused(`${album}?m=${world.bob.token}`);
      await t.say("Signed out, the loop's own route goes to sign-in");
      await t.open(`/g/${world.loop.groupId}/album`);
      await t.expectUrl(/\/signin/);
      await t.see("Sign in");
      await t.say("Signed in to a different loop: not found");
      await t.signInAs("stranger@friendloop.test");
      await t.open(`/g/${world.loop.groupId}/album`);
      await t.see(NOT_FOUND);
      await t.dontSee("Tent at dawn");
      await t.open(album);
      await t.see(NOT_FOUND);
      await t.dontSee("Tent at dawn");
      await t.say("A member gets in. The media addresses are long and unguessable");
      await t.signInAs(null);
      await t.open(`${album}?m=${world.alice.token}`);
      await t.see("7 photos and voice notes");
      const sources = await t.eval(`[...document.querySelectorAll(".album-grid img, .album-grid audio")].map((n) => n.getAttribute("src"))`);
      t.check_(sources.length === 7 && sources.every((src) => /^\/uploads\/[a-f0-9]{64}\.(png|webm)$/.test(src)), `Addresses: ${sources}`);
      const guess = await t.request("GET", `/uploads/${"0".repeat(64)}.png`, { show: false });
      t.check_(guess.status === 404, `A guessed address answered ${guess.status}`);
      await t.panel("media addresses", `${sources.length} of ${sources.length} are /uploads/<64 hex>\ne.g. ${sources[0].slice(0, 26)}…\nguessed neighbour: HTTP ${guess.status}`);
    } },
};
