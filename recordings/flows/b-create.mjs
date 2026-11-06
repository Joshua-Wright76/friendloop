import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { addMember, seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";

const AREA = "B · Create and invite";
const SAM = "sam@friendloop.test";
const OWNER = "owner@friendloop.test";
const NEXT = "Continue to the next setup step";
const BACK = "Go to the previous setup step";

const next = (t) => t.button(NEXT);
const groupIdFrom = (url) => url.match(/\/g\/([0-9a-f-]+)/)[1];
const inviteCount = async (t) => (await t.sql(`select count(*)::int as n from outbox where kind = 'invite'`))[0].n;

export const flows = {
  B1: { title: "Create a loop", area: AREA, run: async (t) => {
    await t.signInAs(SAM);
    await t.open("/you");
    await t.say("Sam starts a new loop");
    await t.link("New loop");
    await t.expectUrl(/\/g\/new$/);
    await t.see("Loop title");
    await t.say("The first step won't move on without a name");
    await next(t);
    await t.see("Choose its paper and picture", { timeout: 300 }).then(() => t.check_(false, "Step one should hold without a name"), () => {});
    await t.say("Name, cadence, day, hour and timezone");
    await t.fillLabel("Loop title", "The Sunday Loop");
    await t.button("Quarterly (13 weeks)");
    await t.pick("Day", "Sunday");
    await t.pick("Time", "18:00");
    await t.pick("Timezone", "Europe/Amsterdam");
    await t.say("Going back never costs any typing");
    await next(t);
    await t.see("Choose its paper and picture");
    await t.button(BACK);
    const kept = await t.eval(`document.querySelector("#loop-name").value`);
    t.check_(kept === "The Sunday Loop", `Name should survive going back, got "${kept}"`);
    await t.say("Through the other steps, and create it");
    await next(t);
    await next(t);
    await t.see("What should everyone answer?");
    await next(t);
    await t.see("Invite your people");
    await next(t);
    await t.button("Create loop");
    await t.expectUrl(/\/g\/[0-9a-f-]+\?welcome=1/);
    await t.say("The new loop's dashboard, with Sam as its owner");
    await t.see("The Sunday Loop");
    await t.see("Loop created");
    const [group] = await t.sql(`select g.mode, g.cadence_weeks, g.prompt_weekday, g.prompt_hour, g.timezone, m.access, m.participation
      from groups g join memberships m on m.group_id = g.id where g.name = 'The Sunday Loop'`);
    t.check_(group.mode === "group" && group.cadence_weeks === 13 && group.access === "owner" && group.participation === "contributor", `Unexpected loop: ${JSON.stringify(group)}`);
    t.check_(group.prompt_weekday === 0 && group.prompt_hour === 18 && group.timezone === "Europe/Amsterdam", `Schedule not saved: ${JSON.stringify(group)}`);
    await t.panel("groups + memberships", JSON.stringify(group, null, 1));
    t.note("specs/flows.md says the owner picks a mode, but the wizard has no mode choice: every loop created here is mode = group.");
  } },

  B2: { title: "Pick starting questions", area: AREA, run: async (t) => {
    await t.signInAs(SAM);
    await t.open("/g/new");
    await t.fillLabel("Loop title", "Book Club");
    await next(t);
    await next(t);
    await t.say("Two questions come ticked; the rest are in packs");
    await t.see("What should everyone answer?");
    await t.see("What made you laugh this week?");
    await t.say("Untick one, and pick from another pack");
    await t.clickRole("checkbox", "What are you looking forward to?");
    await t.button("Tiny joys");
    const { QUESTION_PACKS } = await import("../../src/lib/question-packs.ts");
    const tiny = QUESTION_PACKS.find((pack) => pack.name === "Tiny joys").questions[0];
    await t.clickRole("checkbox", tiny);
    await t.say("Or tap one of the quick ideas");
    await t.button("What was one good moment from your week?");
    await t.see("3 selected");
    await next(t);
    await next(t);
    await t.say("Preview what people will get");
    await t.button("Preview the first issue");
    await t.see("A first look");
    await t.see("What was one good moment from your week?");
    await t.button("Close issue preview");
    await t.button("Create loop");
    const url = await t.expectUrl(/\/g\/[0-9a-f-]+\?welcome=1/);
    await t.say("Those three are the loop's questions, in that order");
    await t.open(`/g/${groupIdFrom(url)}/questions`);
    await t.see("What was one good moment from your week?");
    const pool = (await t.sql(`select q.text from questions q join groups g on g.id = q.group_id where g.name = 'Book Club' order by q.position`)).map((row) => row.text);
    const want = ["What made you laugh this week?", tiny, "What was one good moment from your week?"];
    t.check_(JSON.stringify(pool) === JSON.stringify(want), `Pool order: ${JSON.stringify(pool)}`);
    await t.panel("questions, by position", pool.map((text, index) => `${index}. ${text}`).join("\n"));
  } },

  B3: { title: "Invite several members", area: AREA,
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/members`);
      await t.say("Paste a messy list: one owner, one repeat");
      await t.fill('#invite-people input:not([type="hidden"])', "ana@friendloop.test, ben@friendloop.test; cleo@friendloop.test owner@friendloop.test ana@friendloop.test");
      await t.press("Enter");
      await t.say("Three people are new");
      await t.button("Send invitations");
      await t.see("3 invitations sent. 1 already in the loop.");
      await t.see("ben@friendloop.test");
      await t.say("Three emails arrive, each naming the loop");
      await t.waitForMail({ subject: "" }, { count: 3 });
      const links = [];
      const ana = await t.openMail({ to: "ana@friendloop.test" });
      links.push(t.mailLink("/r/"));
      await t.see("Friday Loop");
      await t.say("Ben's has his own link, not Ana's");
      await t.openMail({ to: "ben@friendloop.test" }, { inbox: false });
      links.push(t.mailLink("/r/"));
      await t.see("Friday Loop");
      await t.openMail({ to: "cleo@friendloop.test" }, { inbox: false });
      links.push(t.mailLink("/r/"));
      await t.see("Friday Loop");
      t.check_(ana.HTML.includes("Friday Loop"), "Invite should name the loop");
      t.check_(new Set(links).size === 3, "Each invite should carry its own link");
      const rows = await t.sql(`select email, left(reply_token, 8) || '…' as token, accepted_at is null as pending from memberships where email in ('ana@friendloop.test','ben@friendloop.test','cleo@friendloop.test') order by email`);
      t.check_(rows.length === 3 && rows.every((row) => row.pending) && new Set(rows.map((row) => row.token)).size === 3, `Memberships: ${JSON.stringify(rows)}`);
      t.check_(await inviteCount(t) === 3, "Expected three invite rows");
      await t.panel("memberships + outbox", `${rows.map((row) => `${row.email}  token ${row.token}  pending`).join("\n")}\ninvite rows in outbox: 3`);
    } },

  B4: { title: "Accept an invitation", area: AREA,
    staged: "The clock is pinned to a round that is already open, so there is something to answer. Ana's pending invite is seeded; the email is really sent by the owner's Resend button.",
    seed: async () => {
      const loop = await seedLoop({ members: [
        { email: "alice@friendloop.test", name: "Alice" },
        { email: "bob@friendloop.test", name: "Bob", participation: "reader" },
      ] });
      await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      const ana = await addMember(loop, { email: "ana@friendloop.test", name: "Ana", accepted: false });
      return { loop, ana, bob: loop.members.find((member) => member.email.startsWith("bob")) };
    },
    run: async (t, { loop, ana, bob }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/members`);
      await t.say("The owner sends Ana her invitation");
      await t.button("Resend invite");
      await t.see("Invitation sent again.");
      await t.signInAs(null);
      await t.say("Ana opens the email. She has no account and isn't signed in.");
      await t.openMail({ to: ana.email });
      await t.followMailLink(`/r/${ana.token}`);
      await t.say("She lands straight on this round's questions, greeted by name");
      await t.see("What made you laugh this week?");
      await t.see("Ana, only the people in Friday Loop");
      await t.dontSee("Email me a link");
      const box = await t.eval(`document.querySelectorAll("textarea").length`);
      t.check_(box > 0, "Contributor should get a form");
      await t.say("A reader's link opens the loop too, but with nothing to fill in");
      await t.open(`/r/${bob.token}`);
      await t.see("reader");
      const none = await t.eval(`document.querySelectorAll("textarea").length`);
      t.check_(none === 0, "A reader should get no form");
    } },

  B5: { title: "Resend an invitation", area: AREA,
    staged: "The clock is pinned and the pending member is seeded.",
    seed: async () => {
      const loop = await seedLoop();
      const pending = await addMember(loop, { email: "pending@friendloop.test", accepted: false });
      return { loop, pending };
    },
    run: async (t, { loop, pending }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/members`);
      await t.say("One person hasn't opened their invite");
      await t.see("pending@friendloop.test");
      await t.see("invite not opened yet");
      await t.say("Resend it");
      await t.button("Resend invite");
      await t.see("Invitation sent again.");
      await t.say("It arrives with the same link as before");
      await t.openMail({ to: pending.email });
      t.mailLink(`/r/${pending.token}`);
      await t.see("Friday Loop");
      const [row] = await t.sql(`select count(*)::int as n, min(reply_token) as token from memberships where email = $1`, [pending.email]);
      t.check_(row.n === 1, "Resending must not duplicate the membership");
      t.check_(row.token === pending.token, "Resending must not rotate the token");
      t.check_(await inviteCount(t) === 1, "Expected one invite row");
      await t.panel("memberships", `rows for ${pending.email}: ${row.n}\ntoken unchanged: ${row.token === pending.token}\ninvite rows in outbox: 1`);
    } },

  B6: { title: "Expired invitation", area: AREA,
    staged: "The clock is pinned and the invitation is seeded as sent 30 days earlier. Invitations last two weeks.",
    seed: async () => {
      const loop = await seedLoop();
      return addMember(loop, { email: "slow@friendloop.test", invitedDaysAgo: 30, accepted: false });
    },
    run: async (t, stale) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(null);
      await t.open(`/r/${stale.token}`);
      await t.say("Someone opens an invitation that sat for 30 days");
      await t.see("This invitation has expired");
      await t.say("It says who to ask, shows no form, and signs nobody in");
      await t.see("Ask whoever runs the loop to send you a new one");
      const forms = await t.eval(`document.querySelectorAll("textarea").length`);
      t.check_(forms === 0, "An expired invitation should show no form");
      const [{ sessions }] = await t.sql(`select count(*)::int as sessions from sessions`);
      const [{ replies }] = await t.sql(`select count(*)::int as replies from replies`);
      t.check_(sessions === 0 && replies === 0, `Expected nothing written, got ${sessions} sessions, ${replies} replies`);
      await t.panel("database", `sessions: ${sessions}\nreplies: ${replies}`);
    } },

  B7: { title: "Choose a look while creating", area: AREA,
    staged: "The oversize picture is a generated 4 MB file that can't be decoded, matching the e2e test.",
    run: async (t) => {
      await t.signInAs(SAM);
      await t.open("/g/new");
      await t.fillLabel("Loop title", "Meadow Mornings");
      await next(t);
      await t.say("The wizard's optional step: paper, accent and header picture");
      await t.see("Choose its paper and picture");
      await t.say("Pick a paper, with a live light and dark preview");
      await t.clickRole("radio", "Meadow Postcard");
      await t.fill('input[aria-label="Accent color as a hex code"]', "#2a6b3c");
      await t.see("Light");
      await t.say("Add a header picture");
      await t.upload('input[type="file"][aria-label="Choose a header picture"]', "header.jpg");
      await t.see("Picture ready.");
      await t.say("Move on and come back: nothing is lost");
      await next(t);
      await t.see("What should everyone answer?");
      await t.button(BACK);
      await t.see("Choose its paper and picture");
      const kept = await t.eval(`({ paper: document.querySelector('input[name="preset"]:checked')?.value, accent: document.querySelector('input[aria-label="Accent color as a hex code"]').value, banner: Boolean(document.querySelector("img.loop-banner")) })`);
      t.check_(kept.paper === "meadow" && kept.accent === "#2a6b3c" && kept.banner, `Choices lost: ${JSON.stringify(kept)}`);
      await t.see("Picture ready.");
      await next(t);
      await next(t);
      await next(t);
      await t.button("Create loop");
      const url = await t.expectUrl(/\/g\/[0-9a-f-]+\?welcome=1/);
      await t.say("The very first page already wears them");
      await t.see("Meadow Mornings");
      await t.toTop();
      await t.pause(1000);
      const banner = await t.eval(`Boolean(document.querySelector("img.loop-banner"))`);
      t.check_(banner, "The loop's first page should show its banner");
      const [saved] = await t.sql(`select theme_preset, theme_accent, header_image_url is not null as has_picture from groups where id = $1`, [groupIdFrom(url)]);
      t.check_(saved.theme_preset === "meadow" && saved.theme_accent === "#2a6b3c" && saved.has_picture, `Not saved: ${JSON.stringify(saved)}`);
      await t.panel("groups", JSON.stringify(saved, null, 1), { hold: 2500 });

      await t.open("/g/new");
      await t.fillLabel("Loop title", "Plain Loop");
      await next(t);
      await t.say("A made-up accent holds the step, with a plain message");
      await t.fill('input[aria-label="Accent color as a hex code"]', "yellow-ish");
      await next(t);
      await t.see("That paper or accent color wasn't recognized.");
      await t.button("Use the paper's own");
      await t.say("A picture too big to read is refused before anything is sent");
      const huge = path.join(tmpdir(), `flrec-huge-${t.session}.png`);
      writeFileSync(huge, Buffer.alloc(4 * 1024 * 1024 + 1));
      await t.upload('input[type="file"][aria-label="Choose a header picture"]', huge);
      await t.see("We couldn't read that picture.");
      const noBanner = await t.eval(`!document.querySelector("img.loop-banner")`);
      t.check_(noBanner, "A refused picture should not show");
      await t.say("Skipping the step stores nothing");
      await next(t);
      await next(t);
      await next(t);
      await t.button("Create loop");
      await t.expectUrl(/\/g\/[0-9a-f-]+\?welcome=1/);
      await t.see("Plain Loop");
      const [plain] = await t.sql(`select theme_preset, theme_accent, header_image_url from groups where name = 'Plain Loop'`);
      t.check_(plain.theme_preset === null && plain.theme_accent === null && plain.header_image_url === null, `Should store nothing: ${JSON.stringify(plain)}`);
      await t.panel("groups", JSON.stringify(plain, null, 1));
    } },
};
