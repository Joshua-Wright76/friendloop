import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { rows } from "../../e2e/support/db.ts";
import { addMember, seedDeliveredIssue, seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";
import { QUESTION_PACKS } from "../../src/lib/question-packs.ts";
import { RECORDINGS } from "../lib/harness.mjs";
import { find, retype, until } from "../lib/scoped.mjs";

const AREA = "Journeys";
const NEXT = "Continue to the next setup step";
const SAM = "owner@friendloop.test";
const ALICE = "alice@friendloop.test";
const BOB = "bob@friendloop.test";
const CLEO = "cleo@friendloop.test";
const LAUGH = "What made you laugh this week?";
const FORWARD = "What are you looking forward to?";
const HEART = `[aria-label^="React with ❤️"]`;
const EXTRA = 'section[aria-label="And a little extra"]';
const SPOTIFY = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";
const INVITE = '#invite-people input:not([type="hidden"])';
const PHOTO_OF_ME = 'input[aria-label="Choose a photo of yourself"]';

const person = (loop, prefix) => loop.members.find((member) => member.email.startsWith(prefix));
const groupIdFrom = (url) => url.match(/\/g\/([0-9a-f-]{36})/)[1];
const photoFor = (n) => `input[aria-label="Add a photo, question ${n}"]`;

/** Type into the answer box a question's label points at. */
async function answer(t, question, text) {
  await t.fill(`textarea[aria-label=${JSON.stringify(question)}]`, text);
}
/** React hangs its props on a node when it hydrates; typing or choosing before that can be lost. */
async function hydrated(t, selector) {
  await until(t, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el && Object.keys(el).some((key) => key.startsWith("__reactProps")); })()`, `${selector} never hydrated`);
}
/** A plain input whose label lives in the DOM, set the way the browser's own date picker sets it. */
async function setValue(t, selector, value) {
  await t.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({ block: "center" });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await t.pause(500);
}
/** The instant a round is due, from the row the app wrote. */
async function dueAt(t, groupId) {
  const [row] = await t.sql("select delivers_at from issues where group_id = $1 order by number desc limit 1", [groupId]);
  return new Date(new Date(row.delivers_at).getTime() + 60_000);
}
async function lastIssue(t, groupId) {
  return (await t.sql("select id from issues where group_id = $1 order by number desc limit 1", [groupId]))[0].id;
}
/** Fetch from inside the page: it carries the session and shows what a download really holds. */
async function fetchFromPage(t, url) {
  return t.eval(`(async () => {
    const r = await fetch(${JSON.stringify(url)}, { redirect: "manual" });
    return { status: r.status, disposition: r.headers.get("content-disposition"), body: r.type === "opaqueredirect" ? "" : await r.text() };
  })()`);
}
/** Put a fixture photo where the app's storage would, as a past upload. */
function storedPhoto(fixture) {
  const source = path.join(RECORDINGS, "fixtures", fixture);
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
  const directory = path.join(process.cwd(), "public", "uploads");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, path.join(directory, `${hash}.jpg`));
  return `/uploads/${hash}.jpg`;
}
async function pastPhoto(issueId, questionText, membershipId, body, fixture) {
  const [question] = await rows("select id from issue_questions where issue_id = $1 and text = $2", [issueId, questionText]);
  await rows(`insert into replies (issue_id, issue_question_id, membership_id, body, photo_url, status, submitted_at)
    values ($1, $2, $3, $4, $5, 'submitted', now())`, [issueId, question.id, membershipId, body, storedPhoto(fixture)]);
}

export const flows = {
  W01: { title: "New owner", area: AREA, run: async (t) => {
    const owner = "sam@friendloop.test";
    await t.say("Sam has never used Friendloop. They ask for a sign-in link");
    await t.signInByMail(owner);
    await t.see("Your loops");
    await t.say("Sam starts their first loop");
    await t.link("New loop");
    await t.expectUrl(/\/g\/new$/);
    await t.fillLabel("Loop title", "The Sunday Loop");
    await t.say("Every Sunday evening");
    await t.pick("Day", "Sunday");
    await t.pick("Time", "18:00");
    await t.button(NEXT);
    await t.see("Choose its paper and picture");
    await t.say("Paper can wait");
    await t.button(NEXT);
    await t.say("Pick the starting questions");
    await t.see("What should everyone answer?");
    await t.see(LAUGH);
    const tiny = QUESTION_PACKS.find((pack) => pack.name === "Tiny joys").questions[0];
    await t.button("Tiny joys");
    await t.clickRole("checkbox", tiny);
    await t.button(NEXT);
    await t.see("Invite your people");
    await t.button(NEXT);
    await t.button("Create loop");
    const url = await t.expectUrl(/\/g\/[0-9a-f-]+\?welcome=1/);
    await t.say("The loop exists, and Sam owns it");
    await t.see("The Sunday Loop");
    await t.see("Loop created");
    const groupId = groupIdFrom(url);
    const pool = await t.sql("select text from questions where group_id = $1 and archived_at is null", [groupId]);
    t.check_(pool.some((row) => row.text === tiny), "The chosen question should be in the pool");
    await t.say("Now the people: three friends");
    await t.open(`/g/${groupId}/members`);
    await t.fill(INVITE, "ana@friendloop.test, ben@friendloop.test, cleo@friendloop.test");
    await t.press("Enter");
    await t.button("Send invitations");
    await t.see("Invitations sent");
    await t.see("ana@friendloop.test");
    await t.see("invite not opened yet");
    await t.say("Three invitations land in three inboxes");
    for (const friend of ["ana", "ben", "cleo"]) await t.waitForMail({ to: `${friend}@friendloop.test`, subject: "The Sunday Loop" });
    await t.openMail({ to: "ben@friendloop.test", subject: "The Sunday Loop" });
    t.check_(t.mailLink("/r/").includes("/r/"), "The invite should carry Ben's own link");
    const links = [];
    for (const friend of ["ana", "ben", "cleo"]) {
      const [message] = await t.waitForMail({ to: `${friend}@friendloop.test`, subject: "The Sunday Loop" });
      const full = await (await fetch(`${t.stack.mailpit}/api/v1/message/${message.ID}`)).json();
      links.push(full.HTML.match(/href="([^"]*\/r\/[^"]+)"/)[1]);
    }
    t.check_(new Set(links).size === 3, "Each friend should have their own link");
    await t.scroll(320);
    await t.pause(1000);
  } },

  W02: { title: "First-time contributor", area: AREA,
    staged: "The loop is seeded and its owner invites Priya on camera; the round is opened by Send now, at a pinned time.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      const priya = "priya@friendloop.test";
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(SAM);
      await t.say("Sam invites Priya and opens a round");
      await t.open(`/g/${loop.groupId}/members`);
      await t.fill(INVITE, priya);
      await t.press("Enter");
      await t.button("Send invitations");
      await t.see("Invitations sent");
      await t.open(`/g/${loop.groupId}`);
      await t.button("Send now");
      await t.see("is open and everyone");
      await t.signInAs(null);
      await t.say("Priya has no account. She gets an invitation");
      await t.openMail({ to: priya, subject: "added you to Friday Loop" });
      await t.say("The link goes straight to the questions, no sign-in");
      await t.followMailLink("/r/");
      await t.expectUrl(/\/r\/[^/]+$/);
      await t.see(LAUGH);
      await t.dontSee("Email me a link");
      await t.say("Her link knows the loop, and that only its people will read this");
      await t.see("only the people in Friday Loop");
      await t.pause(800);
      await t.say("She tells the loop what to call her");
      await t.fill("#reply-name", "Priya");
      await t.pause(600);
      await t.say("She starts typing, and it saves itself");
      await answer(t, LAUGH, "My neighbour's parrot learned the doorbell.");
      await t.see("Saved");
      await t.say("Reload: the draft is still there");
      await t.reload();
      const kept = await t.eval(`[...document.querySelectorAll("textarea")].map((box) => box.value).join("|")`);
      t.check_(kept.includes("parrot"), `The draft should survive a reload, had: ${kept}`);
      await t.see("1 of 2 answered");
      await t.pause(800);
      await t.say("She adds a photo");
      await t.upload(photoFor(1), "photo2.jpg");
      await t.see("Photo saved", { timeout: 20_000 });
      await t.say("And sends it");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      await t.pause(1200);
      await t.say("Changing her mind is fine until the round goes out");
      await t.button("Edit my answers");
      await answer(t, FORWARD, "A long weekend, finally.");
      await t.see("Saved");
      await t.button("Save changes");
      await t.see("Changes sent");
      await t.say("Both answers are in, and the first has the photo");
      await t.button("Edit my answers");
      await t.see("A long weekend, finally.", { timeout: 1500 }).catch(async () => {
        const boxes = await t.eval(`[...document.querySelectorAll("textarea")].map((box) => box.value).join("|")`);
        t.check_(boxes.includes("A long weekend, finally."), `The edit should be kept, had: ${boxes}`);
      });
      await until(t, `[...document.querySelectorAll('img')].some((img) => img.src.includes('/uploads/') && img.naturalWidth > 0)`, "Her photo should still show");
      await t.pause(1000);
      const stored = await t.sql(`select r.body, r.status, r.photo_url from replies r join memberships m on m.id = r.membership_id where m.email = $1 order by r.created_at`, [priya]);
      t.check_(stored.length === 2 && stored.every((row) => row.status === "submitted"), `Stored: ${JSON.stringify(stored)}`);
      t.check_(Boolean(stored[0].photo_url), "The photo should be on her first answer");
      await t.say("Sam sees her answer has arrived");
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}`);
      await t.see("Waiting on");
      const waiting = await t.eval(`document.body.innerText`);
      t.check_(!/Waiting on[^\n]*Priya/.test(waiting), "Priya should no longer be waited on");
      await t.pause(800);
    } },

  W03: { title: "The whole round", area: AREA,
    staged: "The loop and its poll are seeded and the delivery sweep runs with a pinned clock. Everything else, including every email, is real.",
    seed: async () => {
      const loop = await seedLoop({ members: [
        { email: ALICE, name: "Alice" }, { email: BOB, name: "Bob" }, { email: CLEO, name: "Cleo" },
      ], questions: [LAUGH] });
      await seedPoll(loop, { text: "Where should we camp?", options: ["The lake", "The mountains", "The coast"] });
      return loop;
    },
    run: async (t, loop) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(SAM);
      await t.say("Sam doesn't wait for Friday: Send now");
      await t.open(`/g/${loop.groupId}`);
      await t.button("Send now");
      await t.see("Round 1 is open and everyone");
      await t.say("Everyone gets their questions by email");
      await t.waitForMail({ subject: "for Friday Loop" }, { count: 4 });
      await t.signInAs(null);
      await t.openMail({ to: ALICE, subject: "for Friday Loop" });
      await t.say("Alice follows her link and answers, poll included");
      await t.followMailLink("/r/");
      await t.see(LAUGH);
      await answer(t, LAUGH, "Our cat fell off the fridge. Twice.");
      await t.reveal("Where should we camp?");
      await t.clickRole("radio", "The lake");
      await t.see("Pick saved");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      await t.say("Bob answers from his email, with a photo");
      await t.openMail({ to: BOB, subject: "for Friday Loop" }, { inbox: false });
      await t.followMailLink("/r/");
      await answer(t, LAUGH, "This tent, in the rain, at 3am.");
      await t.upload(photoFor(1), "photo3.jpg");
      await t.see("Photo saved", { timeout: 20_000 });
      await t.clickRole("radio", "The mountains");
      await t.see("Pick saved");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      await t.say("Sam sees who's missing, and nudges");
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}`);
      await t.see("Waiting on");
      await t.see("Cleo");
      await t.button("Send a nudge");
      await t.see("nudges sent");
      await t.say("Cleo's inbox gets the nudge");
      await t.signInAs(null);
      await t.waitForMail({ to: CLEO }, { count: 2 });
      await t.openMail({ to: CLEO }, { inbox: false });
      await t.pause(600);
      const due = await dueAt(t, loop.groupId);
      await t.say("Delivery day: the sweep sends the issue");
      const report = await t.sweep(due);
      t.check_(report.delivered === 1, `The sweep should deliver one round: ${JSON.stringify(report)}`);
      await t.clock(due);
      await t.say("Alice gets the issue by email");
      await t.waitForMail({ to: ALICE, subject: "Friday Loop ·" });
      await t.openMail({ to: ALICE, subject: "Friday Loop ·" });
      await t.followMailLink("/i/");
      await t.say("She reads what everyone wrote");
      await t.see("This tent, in the rain, at 3am.");
      await until(t, `[...document.querySelectorAll('img')].some((img) => img.src.includes('/uploads/') && img.naturalWidth > 0)`, "Bob's photo should render");
      await t.see("Where should we camp?");
      await t.see("The mountains");
      await t.say("She hearts Bob's answer and comments");
      await t.click(HEART);
      await until(t, `document.querySelector(${JSON.stringify(HEART)}).getAttribute("aria-pressed") === "true"`, "The heart should stick");
      await t.click('textarea[aria-label="Comment"]');
      await t.typeKeys("Bob, why were you awake at 3am?");
      await t.button("Post", { exact: true });
      await t.see("Bob, why were you awake at 3am?");
      await t.reload();
      await t.see("Bob, why were you awake at 3am?");
    } },

  W04: { title: "Owner tends the questions", area: AREA,
    staged: "The loop and an open round are seeded, with the clock pinned to when that round is open.",
    seed: async () => {
      const loop = await seedLoop();
      await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      return loop;
    },
    run: async (t, loop) => {
      const custom = "What did you learn this week?";
      const silly = QUESTION_PACKS.find((pack) => pack.name === "Silly hypotheticals").questions;
      const poolOrder = async () => (await t.sql("select text from questions where group_id = $1 and archived_at is null order by position", [loop.groupId])).map((row) => row.text);
      const POOL = 'ol[aria-label="Questions in round order"] > li';
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("Sam writes a question of their own");
      await t.fillLabel("New question", custom);
      await t.button("Add question");
      await t.see("Question added.");
      await t.say("Two more from the packs");
      await t.reveal("Question packs");
      await t.button("Silly hypotheticals");
      await t.clickRole("checkbox", silly[0]);
      await t.clickRole("checkbox", silly[1]);
      await t.see("2 selected");
      await t.button("Add to your questions");
      await t.see("2 questions added.");
      await t.say("Sam moves their own question to the top");
      if (t.isMobile) { // A phone gets a Move button and a sheet of positions, not arrows.
        await t.button(`Move: ${custom}`);
        await t.see("Move question");
        await t.button("1.");
      } else {
        await t.button(`Up: ${custom}`);
        await until(t, `document.querySelectorAll('${POOL}')[1]?.innerText.includes(${JSON.stringify(custom)})`, "It should have moved up");
        await t.button(`Up: ${custom}`);
      }
      await until(t, `document.querySelectorAll('${POOL}')[0]?.innerText.includes(${JSON.stringify(custom)})`, "It should be first");
      await t.pause(600);
      t.check_((await poolOrder())[0] === custom, "The stored order should match");
      await t.say("And retires one");
      await t.button(`Archive ${FORWARD}`);
      await t.button("Yes, archive");
      await t.see("Archived.");
      await until(t, `![...document.querySelectorAll('${POOL}')].some((row) => row.innerText.includes(${JSON.stringify(FORWARD)}))`, "It should leave the pool");
      await t.say("Adds a poll");
      await t.fillLabel("Poll question", "Where should we camp?");
      await t.fillLabel("Option 1", "The lake");
      await t.fillLabel("Option 2", "The mountains");
      await t.button("Add poll");
      await t.see("Poll added.");
      await t.see("The mountains");
      await t.say("Meanwhile Alice has an idea, from her reply link");
      await t.signInAs(null);
      await t.open(`/r/${person(loop, "alice").token}`);
      await t.reveal("Have a question for the group");
      await t.link("Have a question for the group? Suggest one");
      await t.expectUrl(/\/suggest$/);
      await t.fillLabel("Your question", "Who taught the dog to open doors?");
      await t.clickRole("radio", "Ask by name");
      await t.button("Send suggestion");
      await t.see("Suggestion sent");
      await t.say("It's waiting for Sam, who accepts it");
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("Suggested questions");
      await t.see("from Alice");
      await t.button("Add to your questions");
      await t.see("Suggestion added to your questions.");
      await t.dontSee("Suggested questions");
      await t.say("The pool, as the next round will use it");
      await t.see("Who taught the dog to open doors?");
      const order = await poolOrder();
      t.check_(order[0] === custom && order.includes("Who taught the dog to open doors?") && order.includes("Where should we camp?") && !order.includes(FORWARD), `Pool: ${order}`);
      await t.toTop();
      await t.pause(700);
    } },

  W05: { title: "Sections", area: AREA,
    staged: "The loop is seeded, the clock is pinned to the eve of Round 1, and the music link's metadata is cached so saving doesn't reach Spotify. The sections, reply, emails and delivery are real. The round opens on its schedule, not by Send now, which currently drops sections.",
    seed: async () => {
      const loop = await seedLoop({ questions: [LAUGH] });
      await rows("insert into music_links (url, provider, title, fetched_at) values ($1, 'spotify', 'Our road trip record', now())", [SPOTIFY]);
      return loop;
    },
    run: async (t, loop) => {
      const addSection = async (title, kind) => {
        const box = 'input[placeholder="The potluck corner"]';
        await hydrated(t, box);
        await t.fill(box, title);
        if (kind) await t.select("#section-kind", kind);
        await t.button("Add section");
        await t.see("Section added.");
      };
      await t.clock(new Date(BEFORE_FIRST_SLOT));
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("Sam adds a standard section");
      await addSection("The potluck corner");
      await t.say("A photo wall");
      await addSection("The wall", "photo_wall");
      await t.say("And a place for music");
      await addSection("Music picks", "music");
      await t.see("Music picks");
      await t.say("Friday: the sweep opens the round, and Alice gets the email");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(null);
      await t.openMail({ to: ALICE, subject: "for Friday Loop" }, { inbox: false });
      await t.followMailLink("/r/");
      await t.see("And a little extra");
      await t.say("Alice fills the potluck corner, with a photo");
      await t.click('textarea[aria-label="The potluck corner"]');
      await t.typeKeys("Banana bread, again.");
      const standardInput = await find(t, `${EXTRA} > *`, "The potluck corner", "input[type=file]");
      await t.upload(standardInput, "photo4.jpg");
      await t.see("Photo added.");
      await t.say("Puts captioned photos on the wall");
      for (const [line, file] of [["The whole table", "photo5.jpg"], ["The leftovers", "photo6.jpg"]]) {
        const caption = await find(t, `${EXTRA} > *`, "The wall", `input[placeholder="Caption (optional)"]`);
        await retype(t, caption, line);
        await t.upload(await find(t, `${EXTRA} > *`, "The wall", "input[type=file]"), file);
        await t.see(line, { hold: 200, timeout: 20_000 });
      }
      await t.say("And pastes a record");
      await t.fillPlaceholder("Paste a Spotify, Bandcamp, or Qobuz link", SPOTIFY);
      await t.button("Save pick");
      await t.see("Saved.");
      await answer(t, LAUGH, "The dip incident.");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      const due = await dueAt(t, loop.groupId);
      await t.say("The round goes out");
      await t.sweep(due);
      await t.clock(due);
      await t.openMail({ to: ALICE, subject: "Friday Loop ·" }, { inbox: false });
      await t.followMailLink("/i/");
      await t.say("The delivered issue shows all three sections");
      await t.see("The potluck corner");
      await t.see("Banana bread, again.");
      await t.see("The whole table");
      await t.see("The leftovers");
      await t.see("Music picks");
      await t.see("Our road trip record");
      await until(t, `[...document.querySelectorAll('img')].filter((img) => img.src.includes('/uploads/') && img.naturalWidth > 0).length >= 3`, "The section photos should render");
      await t.pause(800);
    } },

  W06: { title: "Events and birthdays", area: AREA,
    staged: "The loop is seeded and the clock is pinned to the day before Round 1 opens. The sweeps use the same calendar.",
    seed: async () => seedLoop({ questions: [LAUGH] }),
    run: async (t, loop) => {
      const alice = person(loop, "alice");
      await t.clock(new Date(BEFORE_FIRST_SLOT));
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/questions`);
      const EVENTS = 'section[aria-label="Events and birthdays"]';
      await t.say("Sam adds Alice's birthday");
      await t.see("Events and birthdays");
      await hydrated(t, `${EVENTS} select[name="kind"]`);
      await t.see("Nothing on the calendar yet.");
      await t.select(`${EVENTS} form select[name="membershipId"]`, alice.id);
      await setValue(t, "#event-date", "1990-01-06");
      await t.fill("#event-emoji", "🎂");
      await t.button("Add event");
      await t.see("Event added.");
      await t.say("And a one-time event the same week");
      await t.select(`${EVENTS} select[name="kind"]`, "once");
      await t.fill(`${EVENTS} input[name="title"]`, "The housewarming");
      await setValue(t, "#event-date", "2026-01-07");
      await t.fill("#event-emoji", "🏡");
      await t.button("Add event");
      await t.see("The housewarming");
      await t.see("Alice's birthday");
      await t.say("Friday: the sweep opens Round 1");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(null);
      await t.say("Bob's email carries his link");
      await t.openMail({ to: BOB, subject: "for Friday Loop" });
      await t.followMailLink("/r/");
      await t.say("Both dates landed in this round");
      await t.see("Alice's birthday");
      await t.see("Leave Alice a note or a photo.");
      await t.see("The housewarming");
      await t.say("Bob writes to Alice, and to the house");
      await t.click(`textarea[aria-label="Alice's birthday"]`);
      await t.typeKeys("Happy birthday, Alice. Cake is on me.");
      await t.click('textarea[aria-label="The housewarming"]');
      await t.typeKeys("Bringing the good chairs.");
      await answer(t, LAUGH, "Trying to wrap a bicycle.");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      await t.say("Delivery day");
      await t.sweep(DELIVERY_DAY);
      await t.clock(new Date(DELIVERY_DAY));
      await t.say("Alice reads her issue");
      await t.openMail({ to: ALICE, subject: "Friday Loop ·" }, { inbox: false });
      await t.followMailLink("/i/");
      await t.see("Alice's birthday");
      await t.see("Happy birthday, Alice. Cake is on me.");
      await t.see("The housewarming");
      await t.see("Bringing the good chairs.");
    } },

  W07: { title: "Making it yours", area: AREA,
    staged: "The loop and its first delivered round are seeded as history. Every change is made on camera.",
    seed: async () => {
      const loop = await seedLoop();
      const priya = await addMember(loop, { email: "priya@friendloop.test", name: "Priya", access: "admin" });
      loop.members.push({ ...priya, participation: "contributor", access: "admin" });
      const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [{ email: ALICE, body: "Alice found a very patient goose." }] });
      return { loop, delivered };
    },
    run: async (t, { loop, delivered }) => {
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/settings`);
      await t.say("Sam picks a paper for the loop");
      await t.clickRole("radio", "Meadow Postcard");
      await t.say("Both light and dark are previewed before saving");
      await t.see("Dark");
      await t.pause(900);
      await t.button("Save stationery");
      await t.see("Stationery saved.");
      await t.say("And a header picture");
      await t.upload('input[aria-label="Choose a header picture"]', "header.jpg");
      await t.see("Header picture saved.", { timeout: 20_000 });
      await t.toTop();
      await t.pause(900);
      await t.say("Round 1 deserves a name");
      await t.open(`/g/${loop.groupId}/issues`);
      await t.clickText("Name this round");
      await t.fillLabel("Name for round 1", "The goose week");
      await t.button("Save name");
      await t.see("Round named.");
      await t.say("It wears the name and the paper when you read it");
      await t.open(`/i/${delivered.issueId}`);
      await t.see("The goose week");
      await until(t, `document.querySelector("img.loop-banner")?.naturalWidth > 0`, "The header picture should show on the issue");
      await t.see("Alice found a very patient goose.");
      await t.tour({ dwell: 500, max: 3 });
      await t.toTop();
      await t.say("Alice's own link wears it too");
      await t.signInAs(null);
      await t.open(`/r/${person(loop, "alice").token}`);
      await until(t, `document.querySelector("img.loop-banner")?.naturalWidth > 0`, "The header picture should show on Alice's page");
      await t.pause(1200);
      await t.signInAs(SAM);
      await t.say("Sam adds their own photo");
      await t.open(`/g/${loop.groupId}/members`);
      await t.upload(PHOTO_OF_ME, "avatar.jpg");
      await t.see("Photo saved.", { timeout: 20_000 });
      await until(t, `[...document.querySelectorAll('.avatar img')].some((img) => img.naturalWidth > 0)`, "The avatar should show");
      await t.say("Then hands the loop to Priya");
      await t.button("Make Priya the owner");
      await t.see("Hand");
      await t.button("Yes, make Priya the owner");
      await t.see("the loop has a new owner");
      const roles = await t.sql("select email, access from memberships where group_id = $1 and email in ($2, $3) order by email", [loop.groupId, SAM, "priya@friendloop.test"]);
      await t.panel("memberships", roles.map((role) => `${role.email}: ${role.access}`).join("\n"));
      t.check_(roles.find((role) => role.email === SAM).access === "admin", "Sam should now be an admin");
      await t.say("Sam can't reach owner settings any more. Priya can");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.expectUrl(new RegExp(`/g/${loop.groupId}$`));
      await t.signInAs("priya@friendloop.test");
      await t.open(`/g/${loop.groupId}/members`);
      await t.say("On the People page, Priya is the owner and Sam's photo stays with Sam");
      await t.see("priya@friendloop.test");
      await until(t, `[...document.querySelectorAll('.avatar img')].some((img) => img.naturalWidth > 0)`, "Sam's photo should still show");
      await t.pause(1000);
      await t.open(`/g/${loop.groupId}/settings`);
      await t.see("Delete forever");
    } },

  W08: { title: "Settings lifecycle", area: AREA,
    staged: "The loop is seeded. Every change is made on camera; the sweep's report is the real response.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      const bob = person(loop, "bob");
      const settings = `/g/${loop.groupId}/settings`;
      await t.signInAs(SAM);
      await t.open(settings);
      await t.say("Sam moves the loop to every two weeks, Monday evenings");
      await t.pick("Every", "Every 2 weeks");
      await t.pick("Day", "Monday");
      await t.pick("Time", "18:00");
      await t.button("Save changes");
      await t.see("Saved.");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Monday at 18:00");
      await t.say("Going away for a while: pause");
      await t.button("Pause");
      await t.see("Nothing scheduled");
      await t.say("While paused, nothing opens, however long it's been");
      const far = new Date(Date.now() + 30 * 24 * HOUR);
      const paused = await t.sweep(far);
      t.check_(paused.opened === 0, "A paused loop should open nothing");
      await t.say("Back again: resume from settings");
      await t.open(settings);
      await t.see("The loop is paused");
      await t.button("Resume");
      await t.see("Pause this loop");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Monday at 18:00");
      const [resumed] = await t.sql("select paused_at, cadence_weeks, prompt_weekday, prompt_hour from groups where id = $1", [loop.groupId]);
      await t.panel("groups", JSON.stringify(resumed, null, 1));
      t.check_(resumed.paused_at === null && resumed.cadence_weeks === 2 && resumed.prompt_weekday === 1 && resumed.prompt_hour === 18, `Unexpected: ${JSON.stringify(resumed)}`);
      await t.say("Bob has moved on: Sam removes him");
      await t.open(`/g/${loop.groupId}/members`);
      await t.click(await find(t, ".card", BOB, "button", "Remove"));
      await t.click(await find(t, ".card", BOB, "button", "Yes, remove"));
      await t.see("They're out of the loop.");
      await t.dontSee(BOB);
      await t.say("His link stops working");
      await t.signInAs(null);
      await t.open(`/r/${bob.token}`);
      await t.see("doesn't work anymore");
      await t.say("Finally Sam closes the loop for good");
      await t.signInAs(SAM);
      await t.open(settings);
      await t.reveal("Delete the loop");
      await t.fillLabel('Type "Friday Loop" to confirm', "Friday Loop");
      await t.button("Delete forever");
      await t.expectUrl(/\/you/);
      await t.pause(800);
      await t.dontSee("Friday Loop");
      const left = await t.sql("select id from groups where id = $1", [loop.groupId]);
      t.check_(left.length === 0, "The loop should be gone");
      await t.say("The old address is simply not there");
      await t.open(`/g/${loop.groupId}`);
      await t.see("This page isn't here");
      await t.pause(1500);
    } },

  W09: { title: "Roles", area: AREA,
    staged: "Both loops are seeded. Invitations, their emails and the role change are real. One tab plays each person in turn.",
    seed: async () => {
      const loop = await seedLoop({ members: [{ email: "max@friendloop.test", name: "Max" }, { email: ALICE, name: "Alice" }] });
      await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      const letter = await seedLoop({ name: "Letters from Sam", mode: "from_you", members: [] });
      return { loop, letter };
    },
    run: async (t, { loop, letter }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      const people = `/g/${loop.groupId}/members`;
      await t.say("Max is a plain member: he can see people, not manage them");
      await t.signInAs("max@friendloop.test");
      await t.open(people);
      await t.see("max@friendloop.test");
      await t.dontSee("Email addresses");
      await t.say("Sam promotes Max to admin");
      await t.signInAs(SAM);
      await t.open(people);
      await t.button("Role for Max");
      await t.clickRole("option", "Admin", { exact: true });
      await t.pause(900);
      const [max] = await t.sql("select access from memberships where email = 'max@friendloop.test'");
      t.check_(max.access === "admin", `Max is ${max.access}`);
      await t.say("Sam also invites Rae, only to read");
      await t.fill(INVITE, "rae@friendloop.test");
      await t.press("Enter");
      await t.button("Send invitations");
      await t.see("Invitations sent");
      await t.button("How rae@friendloop.test takes part");
      await t.clickRole("option", "Reads only", { exact: true });
      await t.pause(900);
      const [rae] = await t.sql("select participation from memberships where email = 'rae@friendloop.test'");
      t.check_(rae.participation === "reader", `Rae is ${rae.participation}`);
      await t.say("Max can now invite and edit questions, but not owner settings");
      await t.signInAs("max@friendloop.test");
      await t.open(people);
      await t.see("Email addresses");
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("New question");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.expectUrl(new RegExp(`/g/${loop.groupId}$`));
      await t.dontSee("Delete forever");
      await t.say("Rae follows her invitation");
      await t.signInAs(null);
      await t.openMail({ to: "rae@friendloop.test" });
      await t.followMailLink("/r/");
      await t.say("A reader's page: the loop, and no form");
      await t.see("You're a reader");
      await t.tour({ dwell: 500, max: 2 });
      await t.dontSee(LAUGH);
      const boxes = await t.eval(`document.querySelectorAll("textarea").length`);
      t.check_(boxes === 0, "A reader should have nothing to fill in");
      await t.say("Sam's other loop is a from-you loop: Sam writes, others read");
      await t.signInAs(SAM);
      await t.open(`/g/${letter.groupId}/members`);
      await t.see("Bring someone into the loop");
      await t.fill(INVITE, "fan@friendloop.test");
      await t.press("Enter");
      await t.button("Send invitations");
      await t.see("Invitations sent");
      await t.say("Everyone invited here is a reader");
      const [fan] = await t.sql("select participation from memberships where email = 'fan@friendloop.test'");
      await t.panel("memberships", `fan@friendloop.test: ${fan.participation}`);
      t.check_(fan.participation === "reader", `Fan is ${fan.participation}`);
      await t.signInAs(null);
      await t.openMail({ to: "fan@friendloop.test" }, { inbox: false });
      await t.followMailLink("/r/");
      await t.see("You're a reader");
      await t.pause(1500);
    } },

  W10: { title: "Looking back", area: AREA,
    staged: "Two delivered rounds with their photos are seeded as the loop's history. Turning sharing on and resetting the links happen on camera.",
    seed: async () => {
      const loop = await seedLoop();
      const alice = person(loop, "alice");
      const bob = person(loop, "bob");
      const first = await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-01-09T08:00:00Z"), answers: [{ email: ALICE, body: "Alice looks forward to soup.", questionIndex: 1 }] });
      await pastPhoto(first.issueId, LAUGH, alice.id, "A goose on the towpath", "photo1.jpg");
      await pastPhoto(first.issueId, LAUGH, bob.id, "Bob's very lopsided shed", "photo2.jpg");
      const second = await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-01-16T08:00:00Z"), answers: [] });
      await rows("update issues set name = 'Camping weekend' where id = $1", [second.issueId]);
      await pastPhoto(second.issueId, LAUGH, bob.id, "Tent at dawn", "photo3.jpg");
      await pastPhoto(second.issueId, FORWARD, bob.id, "Another lake", "photo4.jpg");
      return { loop, alice, bob, first, second };
    },
    run: async (t, { loop, alice, bob, first }) => {
      await t.signInAs(SAM);
      await t.say("Sam opens the archive of rounds");
      await t.open(`/g/${loop.groupId}/issues`);
      await t.see("Camping weekend");
      await t.see("Round 1");
      await t.say("Just the rounds Alice answered in");
      await t.select('select[name="member"]', alice.id);
      await t.button("Show rounds");
      await t.see("Showing rounds Alice answered in.");
      await t.dontSee("Camping weekend");
      await t.say("Reading opens on her answers alone");
      await t.link("Read it: Round 1");
      await t.see("Showing only Alice's answers.");
      await t.see("A goose on the towpath");
      await t.dontSee("lopsided shed");
      await t.link("Show everyone");
      await t.see("lopsided shed");
      await t.say("Every photo lives in the album");
      await t.open(`/g/${loop.groupId}/album`);
      await t.see("Album");
      await t.see("4 photos");
      await t.say("Filter to Bob");
      await t.select('select[name="member"]', bob.id);
      await t.button("Show", { exact: true });
      await t.see("3 photos");
      await t.dontSee("A goose on the towpath");
      await t.button("Open photo from Bob: Tent at dawn");
      await t.see("Photo 1 of 3");
      await t.press("Escape");
      await t.say("A member reaches it from their own link too");
      await t.signInAs(null);
      await t.open(`/i/${first.issueId}?m=${alice.token}`);
      await t.link("See the album");
      await t.expectUrl(new RegExp(`/album/${loop.groupId}`));
      await t.see("4 photos");
      await t.say("Any round prints as a keepsake");
      await t.signInAs(SAM);
      await t.open(`/i/${first.issueId}`);
      await t.link("Print this round");
      await t.expectUrl(/print/);
      await t.see("Print or save as PDF");
      await t.tour({ dwell: 350, max: 3 });
      await t.link("Back to the round");
      await t.say("Sam turns sharing on");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.clickRole("checkbox", "Anyone with an issue's share link can read it");
      await t.button("Save changes");
      await t.see("Saved.");
      await t.open(`/g/${loop.groupId}/issues`);
      const [{ share_token: oldToken }] = await t.sql("select share_token from issues where id = $1", [first.issueId]);
      t.check_(Boolean(oldToken), "Delivered rounds should have a share link");
      await t.see(`/s/${oldToken}`);
      await t.say("Anyone with the link can read it, without signing in");
      await t.signInAs(null);
      await t.open(`/s/${oldToken}`);
      await t.see("A goose on the towpath");
      await t.dontSee("Comment");
      await t.say("Changed your mind? Reset every link");
      await t.signInAs(SAM);
      await t.open(`/g/${loop.groupId}/settings`);
      await t.button("Reset share links");
      await t.button("Yes, reset share links");
      await t.see("New share links. Old ones no longer work.");
      await t.signInAs(null);
      await t.open(`/s/${oldToken}`);
      await t.see("This page isn't here");
      const [{ share_token: fresh }] = await t.sql("select share_token from issues where id = $1", [first.issueId]);
      t.check_(fresh && fresh !== oldToken, "A new token should exist");
      await t.say("The new link still works");
      await t.open(`/s/${fresh}`);
      await t.see("A goose on the towpath");
    } },

  W11: { title: "Leaving and your data", area: AREA,
    staged: "The loop and last round are seeded as history. The clock is pinned while a new round is open. Emails, downloads and deletions are real.",
    seed: async () => {
      const loop = await seedLoop({ members: [{ email: ALICE, name: "Alice" }, { email: BOB, name: "Bob" }, { email: "wren@friendloop.test", name: "Wren" }] });
      const past = await seedDeliveredIssue(loop, { deliveredAt: new Date("2025-12-26T08:00:00Z"), answers: [
        { email: ALICE, body: "Alice baked bread" },
        { email: "wren@friendloop.test", body: "Wren went sailing" },
        { email: BOB, body: "Bob stayed in" },
      ] });
      return { loop, past };
    },
    run: async (t, { loop, past }) => {
      const alice = person(loop, "alice");
      const bob = person(loop, "bob");
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open("/");
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      await t.say("Alice is getting too much email. Each one has a stop link");
      await t.openMail({ to: ALICE, subject: "for Friday Loop" });
      t.check_(t.lastMail.HTML.includes("Stop emails from this loop"), "The footer should offer to stop");
      await t.followMailLink("/u/");
      await t.see("Stop emails from Friday Loop?");
      await t.button("Stop emails");
      await t.see("Emails from Friday Loop are off");
      await t.say("Actually, she wants out altogether. Her reply link still works");
      await t.openMail({ to: ALICE, subject: "for Friday Loop" }, { inbox: false });
      await t.followMailLink("/r/");
      await t.see("You've turned off emails from this loop.");
      await t.reveal("Leave this loop and delete my answers");
      await t.link("Leave this loop and delete my answers");
      await t.see("Leave Friday Loop?");
      await t.say("A copy first");
      await t.link("Download what I wrote here");
      const hers = await fetchFromPage(t, `/r/${alice.token}/export`);
      await t.panel(hers.disposition ?? "export", hers.body.slice(0, 380));
      t.check_(hers.body.includes("Alice baked bread") && !hers.body.includes("Bob stayed in"), "The export should hold only her words");
      await t.say("She ticks the box, and goes");
      await t.clickRole("checkbox", "I understand everything I wrote in Friday Loop will be deleted");
      await t.button("Leave and delete my answers");
      await t.expectUrl(/\/goodbye$/);
      await t.see("Back to Friendloop");
      await t.pause(600);
      await t.open(`/r/${alice.token}`);
      await t.see("This link doesn't work anymore");
      await t.clock(null);
      await t.say("Wren wants everything gone, in every loop. She signs in");
      await t.signInByMail("wren@friendloop.test");
      await t.see("Your loops");
      await t.say("She downloads her data");
      await t.link("Download my data");
      const mine = await fetchFromPage(t, "/you/export");
      await t.panel(mine.disposition ?? "/you/export", mine.body.slice(0, 380));
      t.check_(mine.body.includes("Wren went sailing"), `Her export should hold her words. HTTP ${mine.status}: ${mine.body.slice(0, 500)}`);
      await t.say("Then deletes her account");
      await t.link("Delete my account");
      await t.expectUrl(/\/you\/delete$/);
      await t.fillLabel("Type your email address to confirm", "wren@friendloop.test");
      await t.button("Delete my account forever");
      await t.expectUrl(/\/goodbye$/);
      await t.see("It's all gone.");
      await t.say("Bob's copy of that round reads on without either of them");
      await t.open(`/i/${past.issueId}?m=${bob.token}`);
      await t.see("Bob stayed in");
      await t.dontSee("Alice baked bread");
      await t.dontSee("Wren went sailing");
    } },

  W12: { title: "Around the edges", area: AREA,
    staged: "The clock jumps forward 16 minutes to expire a real sign-in link. The loop Sam returns to is seeded.",
    seed: async () => seedLoop(),
    run: async (t) => {
      const theme = () => t.eval(`document.documentElement.dataset.theme`);
      await t.open("/");
      await t.say("The home page");
      await t.see("A private newsletter");
      await t.tour({ dwell: 500, max: 5 });
      await t.say("The small print, a tap away");
      await t.link("Privacy");
      await t.expectUrl(/\/privacy$/);
      await t.see("What we keep, and why");
      await t.scroll(500);
      await t.link("Terms");
      await t.expectUrl(/\/terms$/);
      await t.see("The ground rules");
      await t.pause(600);
      await t.say("Light and dark, by hand");
      const start = await theme();
      await t.button(start === "dark" ? "switch to light" : "switch to dark");
      await until(t, `document.documentElement.dataset.theme !== ${JSON.stringify(start)}`, "The theme should change");
      await t.pause(1000);
      await t.reload();
      const after = await theme();
      t.check_(after !== start, "The choice should survive a reload");
      await t.pause(600);
      await t.button(after === "dark" ? "switch to light" : "switch to dark");
      await until(t, `document.documentElement.dataset.theme === ${JSON.stringify(start)}`, "The theme should change back");
      await t.pause(600);
      await t.say("Something odd? The corner button takes a note");
      await t.button("Send feedback");
      await t.see("Tell us anything");
      await t.fillLabel("Your message", "Love the paper textures");
      await t.button("Send", { exact: true });
      await t.see("Thanks, we got it.");
      await t.button("Done");
      await t.say("A page that doesn't exist says so kindly");
      await t.open("/this-is-not-a-page");
      await t.see("This page isn't here");
      await t.link("Back to Friendloop");
      await t.expectUrl(/localhost:\d+\/$/);
      await t.say("Sam comes back and asks for a link");
      await t.open("/signin");
      await t.fillLabel("Your email", SAM);
      await t.button("Email me a link");
      await t.expectUrl(/\/signin\/check-email$/);
      await t.openMail({ to: SAM });
      const old = t.mailLink("/signin/confirm");
      await t.say("But opens it twenty minutes too late");
      await t.clock(new Date(Date.now() + 20 * 60_000));
      await t.open(old);
      await t.see("expired");
      await t.say("One tap asks for a new one");
      await t.link("Send me a new link");
      await t.expectUrl(/\/signin$/);
      await t.fillLabel("Your email", SAM);
      await t.button("Email me a link");
      await t.expectUrl(/\/signin\/check-email$/);
      await t.waitForMail({ to: SAM }, { count: 2 });
      await t.openMail({ to: SAM }, { inbox: false });
      await t.followMailLink("/signin/confirm");
      await t.button("Sign in");
      await t.expectUrl(/\/you$/);
      await t.say("And Sam is home, with the loop waiting");
      await t.see("Your loops");
      await t.see("Friday Loop");
    } },
};
