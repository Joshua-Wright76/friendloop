import { addMember, seedLoop } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { seedWorld } from "../../e2e/support/identity.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { card, cssVar, setScheme } from "../lib/flow-helpers.mjs";

const AREA = "N · Loop identity and lifecycle";
const OWNER = "owner@friendloop.test";
const PAPER = {
  gingham: { light: "#fff3f5", dark: "#241a20" },
  bluebell: { light: "#eef3fb", dark: "#18202c" },
  meadow: { light: "#f0f6ec", dark: "#18211b" },
  marmalade: { light: "#fff3e0", dark: "#231b12" },
  lilac: { light: "#f5f0fb", dark: "#1e1826" },
};
const PHOTO_INPUT = 'input[aria-label="Choose a photo of yourself"]';
const axeSource = () => {
  const require = createRequire(path.join(import.meta.dirname, "../../package.json"));
  return readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
};
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function axeViolations(t) {
  await t.page("Runtime.evaluate", { expression: axeSource() });
  return t.eval(`(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const result = await axe.run({ exclude: [["[data-flrec]"], ["[data-flrec-panel]"]] }, { runOnly: ${JSON.stringify(TAGS)} });
    return result.violations.map((v) => v.id + " (" + v.nodes.length + ")");
  })()`);
}
const stationeryRules = (t) => t.eval(`[...document.querySelectorAll("style")].filter((s) => s.textContent.includes('data-theme="light"]{')).length`);
const banners = (t) => t.eval(`document.querySelectorAll("img.loop-banner").length`);

export const flows = {
  N1: { title: "Choose a theme", area: AREA,
    staged: "The cron sweep is triggered by hand. The accessibility audit is axe-core really running in the page, on the dashboard for each preset; the e2e suite covers the other surfaces. Presets are switched in the database between audit pages.",
    seed: async () => seedWorld("n1-share-token"),
    run: async (t, { loop, delivered, alice }) => {
      const surfaces = [
        ["The dashboard", `/g/${loop.groupId}`],
        ["The reply sheet", `/r/${alice.token}`],
        ["The web issue", `/i/${delivered.issueId}?m=${alice.token}`],
        ["The share view", "/s/n1-share-token"],
      ];
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      const settings = `/g/${loop.groupId}/settings`;
      await t.open(settings);
      await t.say("The owner picks a paper, and sees it live in light and dark");
      await t.see("Stationery");
      t.check_(await t.eval(`[...document.querySelectorAll("input[name=preset]")].find((r) => r.value === "gingham").checked`), "Gingham should start chosen");
      await t.clickRole("radio", "Meadow Postcard");
      await t.see("Light");
      await t.eval(`document.querySelector('[data-testid="stationery-preview-light"]').scrollIntoView({ block: "center", behavior: "smooth" })`);
      await t.pause(1600);
      const bg = (scheme) => t.eval(`getComputedStyle(document.querySelector('[data-testid="stationery-preview-${scheme}"]')).backgroundColor`);
      t.check_((await bg("light")) === "rgb(240, 246, 236)", `Light preview is ${await bg("light")}`);
      t.check_((await bg("dark")) === "rgb(24, 33, 27)", `Dark preview is ${await bg("dark")}`);
      await t.button("Save stationery");
      await t.see("Stationery saved.");
      const [saved] = await rows("select theme_preset, theme_accent from groups where id = $1", [loop.groupId]);
      t.check_(saved.theme_preset === "meadow" && saved.theme_accent === null, `Saved ${JSON.stringify(saved)}`);
      for (const scheme of ["light", "dark"]) {
        await t.say(`Every surface wears it, in ${scheme}`);
        for (const [name, surface] of surfaces) {
          await t.open(surface);
          await setScheme(t, scheme);
          const page = await cssVar(t, "--page");
          t.check_(page === PAPER.meadow[scheme], `${name} in ${scheme}: ${page}`);
          await t.pause(600);
        }
      }
      await setScheme(t, "light");
      await t.say("So does the email, from the same tokens");
      await t.sweep(DELIVERY_DAY, { show: false });
      const mail = await t.openMail({ subject: "Friday Loop", to: "alice@friendloop.test" }, { inbox: false });
      t.check_(mail.HTML.includes(PAPER.meadow.light) && !mail.HTML.includes("#cc3456"), "The email isn't on the meadow paper");
      const hex = async (value) => {
        await t.click('input[aria-label="Accent color as a hex code"]');
        await t.selectAllAndClear();
        await t.typeKeys(value);
      };
      await t.say("A hard-to-read accent gets nudged so it passes AA");
      await t.open(settings);
      await t.clickRole("radio", "Lilac Linen");
      await hex("#ffee00");
      await t.see("a little hard to read, so we nudged it");
      await hex("yellow-ish");
      await t.see("Use a hex code like #3366cc.");
      await hex("#ffee00");
      await t.button("Save stationery");
      await t.see("We nudged the accent a little");
      await t.say("A header picture sits above the loop's pages");
      await t.upload('input[aria-label="Choose a header picture"]', "header.jpg");
      await t.see("Header picture saved.");
      for (const [name, surface] of surfaces.slice(0, 3)) {
        await t.open(surface);
        t.check_((await banners(t)) === 1, `No banner on ${name}`);
        await t.pause(500);
      }
      await t.say("Only the owner can set the picture");
      await t.signInAs(null);
      const form = new FormData();
      form.append("photo", new Blob([readFileSync(path.join(import.meta.dirname, "../fixtures/header.jpg"))], { type: "image/jpeg" }), "x.jpg");
      const stranger = await fetch(`${t.stack.app}/api/loop/${loop.groupId}/header-image`, { method: "POST", body: form });
      t.check_(stranger.status === 403, `Stranger got ${stranger.status}`);
      await t.panel("POST header-image, not the owner", `HTTP ${stranger.status}\n${(await stranger.text()).slice(0, 200)}`);
      await t.say("Every preset passes the axe audit in both schemes");
      await t.signInAs(OWNER);
      const report = [];
      for (const preset of ["bluebell", "meadow", "marmalade", "lilac"]) {
        await rows("update groups set theme_preset = $2, theme_accent = null, header_image_url = null where id = $1", [loop.groupId, preset]);
        for (const scheme of ["light", "dark"]) {
          await t.open(`/g/${loop.groupId}`);
          await setScheme(t, scheme);
          const violations = await axeViolations(t);
          report.push(`${preset.padEnd(10)} ${scheme.padEnd(6)} ${violations.length ? violations.join(", ") : "0 violations"}`);
          t.check_(!violations.length, `axe: ${preset} ${scheme}: ${violations.join(", ")}`);
        }
      }
      await t.panel("axe-core, dashboard", report.join("\n"), { hold: 4500 });
    } },

  N2: { title: "Default stays Gingham", area: AREA,
    staged: "The cron sweep is triggered by hand. The lilac paper for the sign-in check is set in the database.",
    seed: async () => seedWorld("n2-share-token"),
    run: async (t, { loop, delivered, alice }) => {
      const surfaces = [`/g/${loop.groupId}`, `/r/${alice.token}`, `/i/${delivered.issueId}?m=${alice.token}`, "/s/n2-share-token"];
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      for (const scheme of ["light", "dark"]) {
        await t.say(`A loop that never chose a theme looks the same as ever, in ${scheme}`);
        for (const surface of surfaces) {
          await t.open(surface);
          await setScheme(t, scheme);
          t.check_((await cssVar(t, "--page")) === PAPER.gingham[scheme], `${surface} ${scheme} page ${await cssVar(t, "--page")}`);
          t.check_((await cssVar(t, "--accent")) === (scheme === "light" ? "#cc3456" : "#ff8ba4"), `${surface} ${scheme} accent ${await cssVar(t, "--accent")}`);
          t.check_((await stationeryRules(t)) === 0, `${surface}: a stationery rule was injected`);
          t.check_((await banners(t)) === 0, `${surface}: a banner appeared`);
          await t.pause(500);
        }
      }
      await setScheme(t, "light");
      await t.say("The email keeps the original colours, with no picture");
      await t.sweep(DELIVERY_DAY, { show: false });
      const mail = await t.openMail({ subject: "Friday Loop", to: "alice@friendloop.test" }, { inbox: false });
      t.check_(mail.HTML.includes("#fff3f5") && mail.HTML.includes("#cc3456") && !mail.HTML.includes("<img"), "The email isn't plain Gingham");
      await t.say("Choosing another paper, then Gingham again, stores nothing");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.clickRole("radio", "Bluebell Notebook");
      await t.button("Save stationery");
      await t.see("Stationery saved.");
      await t.pause(600);
      t.check_((await cssVar(t, "--page")) === PAPER.bluebell.light, "Bluebell didn't apply");
      await t.clickRole("radio", "Gingham Picnic");
      await t.button("Save stationery");
      for (let i = 0; i < 40 && (await cssVar(t, "--page")) !== PAPER.gingham.light; i++) await t.pause(150);
      t.check_((await cssVar(t, "--page")) === PAPER.gingham.light, "Gingham didn't come back");
      const [row] = await t.sql("select theme_preset, theme_accent from groups where id = $1", [loop.groupId]);
      t.check_(row.theme_preset === null && row.theme_accent === null, `Stored ${JSON.stringify(row)}`);
      await t.panel("groups row", `theme_preset = ${row.theme_preset}\ntheme_accent = ${row.theme_accent}`);
      await t.say("Sign-in never wears a loop's paper, even with lilac saved");
      await rows("update groups set theme_preset = 'lilac' where id = $1", [loop.groupId]);
      await t.signInAs(null);
      await t.open("/signin");
      await t.see("Your email");
      t.check_((await cssVar(t, "--page")) === PAPER.gingham.light, `Sign-in paper ${await cssVar(t, "--page")}`);
      await t.pause(600);
      await t.say("In dark as well");
      await setScheme(t, "dark");
      t.check_((await cssVar(t, "--page")) === PAPER.gingham.dark, `Sign-in paper ${await cssVar(t, "--page")}`);
      await t.pause(1000);
    } },

  N3: { title: "Transfer ownership", area: AREA,
    staged: "One tab plays both people. A second admin is revoked in the database while the question is open, to show a stale handover.",
    seed: async () => {
      const loop = await seedLoop();
      const gone = await addMember(loop, { email: "gone@friendloop.test", access: "admin" });
      await addMember(loop, { email: "heir@friendloop.test", access: "admin" });
      await addMember(loop, { email: "pending@friendloop.test", access: "admin", accepted: false });
      return { loop, gone };
    },
    run: async (t, { loop, gone }) => {
      const people = `/g/${loop.groupId}/members`;
      const roleOf = async (email) => (await t.sql("select access from memberships where email = $1", [email]))[0].access;
      const tokens = () => t.sql("select email, reply_token from memberships where group_id = $1 order by email", [loop.groupId]);
      await t.signInAs(OWNER);
      await t.say("Only an admin who has joined can inherit the loop");
      await t.open(people);
      const offers = () => t.eval(`[...document.querySelectorAll("button")].map((b) => b.textContent).filter((text) => /^Make .* the owner$/.test(text))`);
      t.check_(JSON.stringify(await offers()) === JSON.stringify(["Make gone the owner", "Make heir the owner"]), `Offers: ${await offers()}`);
      await t.see("Make heir the owner");
      await t.say("The role menu doesn't offer “Owner”");
      await t.button("Member type for Alice");
      const options = await t.eval(`[...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())`);
      t.check_(options.length > 0 && !options.includes("Owner"), `Options: ${options}`);
      await t.pause(900);
      if (t.isMobile) await t.button("Close"); else await t.press("Escape");
      await t.say("A handover that went stale changes nothing");
      await t.button("Make gone the owner");
      await rows("update memberships set revoked_at = now() where id = $1", [gone.id]);
      await t.button("Yes, make gone the owner");
      await t.expectUrl(/transferError=1/);
      await t.see("That didn't go through");
      t.check_((await roleOf(OWNER)) === "owner", "A stale handover changed the owner");
      await t.say("The real one: the question names heir, and what Sam gives up");
      await t.open(people);
      const before = await tokens();
      await t.button("Make heir the owner");
      await t.see("heir becomes the owner and you become an admin. Only heir can hand it back.");
      await t.button("Not yet");
      t.check_((await roleOf(OWNER)) === "owner", "Not yet changed the owner");
      await t.say("Change of mind is fine. This time, yes");
      await t.button("Make heir the owner");
      await t.button("Yes, make heir the owner");
      await t.expectUrl(/transferred=1/);
      await t.see("the loop has a new owner");
      t.check_((await roleOf("heir@friendloop.test")) === "owner" && (await roleOf(OWNER)) === "admin", "Roles did not swap");
      t.check_(JSON.stringify(before) === JSON.stringify(await tokens()), "Reply tokens changed");
      const [{ n: sessions }] = await t.sql("select count(*)::int as n from sessions");
      await t.panel("after the handover", `heir  = ${await roleOf("heir@friendloop.test")}\nSam   = ${await roleOf(OWNER)}\nreply tokens: unchanged\nsessions: ${sessions} still valid`);
      await t.say("Sam, still signed in, has no owner actions and can't hand it back");
      await t.open(people);
      t.check_((await offers()).length === 0, "Sam can still hand the loop over");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.expectUrl(new RegExp(`/g/${loop.groupId}$`));
      await t.dontSee("Delete forever");
      await t.say("The new owner holds the keys, and only they can hand it back");
      await t.signInAs("heir@friendloop.test");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.see("Delete forever");
      await t.open(people);
      await t.see("Make Sam the owner");
    } },

  N4: { title: "Rename an issue", area: AREA,
    staged: "The cron sweep is triggered by hand.",
    seed: async () => {
      const world = await seedWorld("n4-share-token");
      await addMember(world.loop, { email: "admin@friendloop.test", access: "admin" });
      return world;
    },
    run: async (t, { loop, delivered, open, alice, shareToken }) => {
      const rounds = `/g/${loop.groupId}/issues`;
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.say("Unnamed rounds carry their numbers");
      await t.open(rounds);
      await t.see("Round 1");
      await t.see("Round 2");
      await t.say("The owner names the open round");
      const target = await card(t, "Round 2", { within: "main li.card" });
      await t.click(`${target} summary`);
      await t.click(`${target} input[name="name"]`);
      await t.typeKeys("Spring cleaning");
      await t.click(`${target} button[type="submit"]`);
      await t.see("Round named.");
      await t.see("Spring cleaning is open now.");
      await t.say("And names the delivered round too");
      const older = await card(t, "Round 1", { within: "main li.card" });
      await t.click(`${older} summary`);
      await t.click(`${older} input[name="name"]`);
      await t.typeKeys("Camping weekend");
      await t.click(`${older} button[type="submit"]`);
      await t.see("Camping weekend");
      await t.say("The name shows on the dashboard");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Spring cleaning");
      await t.say("On the reply sheet");
      await t.open(`/r/${alice.token}`);
      await t.see("Spring cleaning");
      await t.say("On the web issue, with its number kept as a chip");
      await t.open(`/i/${delivered.issueId}`);
      await t.see("Camping weekend");
      await t.see("Round 1");
      await t.say("And in the share view");
      await t.open(`/s/${shareToken}`);
      await t.see("Camping weekend");
      await t.say("Delivery carries the name into the email's subject and heading");
      await t.sweep(new Date(DELIVERY_DAY), { show: false });
      const mail = await t.openMail({ subject: "Spring cleaning", to: "alice@friendloop.test" });
      t.check_(/ · Spring cleaning$/.test(mail.Subject), `Subject: ${mail.Subject}`);
      await t.see("Spring cleaning");
      await t.say("Clearing a name brings the number back");
      await t.open(rounds);
      const named = await card(t, "Camping weekend", { within: "main li.card" });
      await t.click(`${named} summary`);
      await t.click(`${named} input[name="name"]`);
      await t.selectAllAndClear();
      await t.click(`${named} button[type="submit"]`);
      await t.see("The name is gone and the round is back to its number.");
      await t.see("Round 1");
      await t.say("An admin reads the rounds but isn't offered the rename");
      await t.signInAs("admin@friendloop.test");
      await t.open(rounds);
      await t.see("Round 1");
      await t.dontSee("Name this round");
      await t.dontSee("Rename");
      await t.pause(800);
    } },

  N5: { title: "Profile photos", area: AREA,
    staged: "Comments are seeded. The refused requests are made outside the page.",
    seed: async () => {
      const world = await seedWorld();
      const bob = world.loop.members.find((member) => member.email.startsWith("bob"));
      await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Honk.')", [world.delivered.issueId, world.alice.id]);
      await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Quack.')", [world.delivered.issueId, bob.id]);
      const quiet = await seedLoop({ name: "Quiet Loop", members: [
        { email: "alice@friendloop.test", name: "Alice" },
        { email: "rae@friendloop.test", name: "Rae", participation: "reader" },
      ] });
      return { ...world, quiet };
    },
    run: async (t, { loop, delivered, alice, quiet }) => {
      const photoCount = (selector = ".avatar img") => t.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
      const photoOf = async (email, groupId) => (await t.sql("select photo_url from memberships where email = $1 and group_id = $2", [email, groupId]))[0].photo_url;
      await t.clock(AFTER_FIRST_SLOT);
      await t.say("Alice adds a photo right from her reply link");
      await t.open(`/r/${alice.token}`);
      await t.see("Shown next to your answers and comments in this loop, and nowhere else.");
      await t.upload(PHOTO_INPUT, "avatar.jpg");
      await t.see("Photo saved.");
      t.check_((await photoOf("alice@friendloop.test", loop.groupId))?.includes("/uploads/"), "No photo stored");
      await t.say("Reload: the sheet remembers it");
      await t.reload();
      t.check_((await photoCount()) >= 1, "The photo didn't survive a reload");
      await t.pause(800);
      await t.say("It rides on her answer and her comment. Bob keeps his initial");
      await t.open(`/i/${delivered.issueId}?m=${alice.token}`);
      await t.see("Quack.");
      t.check_((await photoCount()) === 2, `Saw ${await photoCount()} photos on the issue`);
      await t.say("Removing it brings her initial back");
      await t.open(`/r/${alice.token}`);
      await t.button("Remove photo");
      await t.see("Photo removed.");
      await t.open(`/i/${delivered.issueId}?m=${alice.token}`);
      await t.see("Quack.");
      t.check_((await photoCount()) === 0, "The photo is still on the issue");
      const inQuiet = (email) => quiet.members.find((member) => member.email === email);
      await t.say("Alice's other loop has no round open yet: the quiet page has the same control");
      await t.open(`/r/${inQuiet("alice@friendloop.test").token}`);
      await t.see("Nothing open right now");
      await t.upload(PHOTO_INPUT, "avatar.jpg");
      await t.see("Photo saved.");
      t.check_((await photoOf("alice@friendloop.test", quiet.groupId))?.includes("/uploads/"), "No photo stored in the quiet loop");
      t.check_((await photoOf("alice@friendloop.test", loop.groupId)) === null, "The photo leaked to her other loop");
      await t.panel("memberships.photo_url, Alice", `Quiet Loop:  set\nFriday Loop: null (a photo belongs to one loop)`);
      await t.say("A reader's link lands on the reader page, with the same control");
      await t.open(`/r/${inQuiet("rae@friendloop.test").token}`);
      await t.see("You're a reader");
      await t.upload(PHOTO_INPUT, "avatar.jpg");
      await t.see("Photo saved.");
      await t.say("Signed in, the people page offers it on your own card only");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/members`);
      t.check_((await photoCount('input[type="file"]')) === 1, "More than one photo control on the people page");
      await t.upload(PHOTO_INPUT, "avatar.jpg");
      await t.see("Photo saved.");
      t.check_((await photoCount()) === 2, `Saw ${await photoCount()} photos on the people page`);
      await t.say("The photo routes answer only the person they belong to");
      const form = () => {
        const body = new FormData();
        body.append("photo", new Blob([readFileSync(path.join(import.meta.dirname, "../fixtures/avatar.jpg"))], { type: "image/jpeg" }), "x.jpg");
        return body;
      };
      const strangerToken = await fetch(`${t.stack.app}/api/reply/not-a-real-token/profile-photo`, { method: "POST", body: form() });
      const strangerLoop = await fetch(`${t.stack.app}/api/loop/${loop.groupId}/profile-photo`, { method: "POST", body: form() });
      t.check_(strangerToken.status === 403 && strangerLoop.status === 403, `Statuses ${strangerToken.status}, ${strangerLoop.status}`);
      await t.panel("POST photo as nobody", `/api/reply/not-a-real-token/profile-photo → HTTP ${strangerToken.status}\n/api/loop/<id>/profile-photo → HTTP ${strangerLoop.status}`);
    } },
};
