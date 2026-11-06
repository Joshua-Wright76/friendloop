import { seedLoop } from "../../e2e/support/seed.ts";
import { resetDatabase, rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW } from "../../e2e/support/clock.ts";

const AREA = "O · Events and birthdays";
const OWNER = "owner@friendloop.test";
const person = (loop, prefix) => loop.members.find((member) => member.email.startsWith(prefix));
const birthday = (loop, member, month, day, emoji = "🎂") =>
  rows("insert into events (group_id, kind, emoji, month, day, membership_id) values ($1, 'birthday', $2, $3, $4, $5)", [loop.groupId, emoji, month, day, member.id]);
const placements = () => rows(`select i.number, s.title, s.event_date::text as event_date
  from issue_sections s join issues i on i.id = s.issue_id where s.event_id is not null order by i.number, s.position`);
const asTable = (placed) => placed.map((row) => `round ${row.number}: ${row.title}, ${row.event_date}`).join("\n") || "(none)";
const ADD = "form:has(#event-date)";
/** Nobody answers in these rounds, so each is skipped and pauses the loop; keep it running, as an owner would. */
const unpause = (loop) => rows("update groups set paused_at = null where id = $1", [loop.groupId]);
/** Native date fields ignore synthesized typing here, so set the value the way a date picker does. */
const setDate = async (t, selector, value) => {
  await t.ab("scrollintoview", selector).catch(() => {});
  const done = await t.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  t.check_(done, `Could not set ${selector} to ${value}`);
  await t.pause(500);
};

export const flows = {
  O1: { title: "Add an event", area: AREA,
    staged: "The clock is pinned to 2 January 2026 so the dates read the same on every take.",
    seed: async () => seedLoop({ members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "bob@friendloop.test", name: "Bob" },
      { email: "ada@friendloop.test", name: "Ada", access: "admin" },
    ] }),
    run: async (t, loop) => {
      await t.clock(E2E_NOW);
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("The owner opens the calendar");
      await t.see("Nothing on the calendar yet.");
      await t.say("A birthday: a person, a date, an icon. The year doesn't matter");
      await t.select(`${ADD} select[name="membershipId"]`, person(loop, "alice").id);
      await setDate(t, "#event-date", "1990-01-06");
      await t.ab("fill", "#event-emoji", "🎂");
      await t.button("Add event");
      await t.see("Event added.");
      await t.say("A one-time event, further out");
      await t.select(`${ADD} select[name="kind"]`, "once");
      await t.ab("fill", `${ADD} input[name="title"]`, "The housewarming");
      await setDate(t, "#event-date", "2026-02-14");
      await t.ab("fill", "#event-emoji", "🏡");
      await t.button("Add event");
      await t.see("Event added.");
      await t.say("Coming up, soonest first, with the next date");
      await t.see("Tue, Jan 6");
      await t.see("Every year");
      await t.see("Sat, Feb 14");
      const order = await t.eval(`[...document.querySelectorAll('ul[aria-label="Events, soonest first"] > li')].map((li) => li.innerText.split("\\n")[0])`);
      t.check_(order.length === 2 && order[0].includes("Alice's birthday") && order[1].includes("The housewarming"), `Wrong order: ${order}`);
      await t.say("Edit one");
      await t.click('summary[aria-label="Edit The housewarming"]');
      await t.ab("fill", 'details[open] input[name="title"]', "The big housewarming");
      await t.pause(500);
      await t.button("Save changes");
      await t.see("Event saved.");
      await t.see("The big housewarming");
      await t.say("Remove it: it asks first");
      await t.button("Remove The big housewarming");
      await t.button("Yes, remove");
      await t.see("Event removed.");
      await t.dontSee("The big housewarming");
      await t.say("A date already gone by is refused, plainly");
      await t.select(`${ADD} select[name="kind"]`, "once");
      await t.ab("fill", `${ADD} input[name="title"]`, "Last week's party");
      await setDate(t, "#event-date", "2025-12-20");
      await t.button("Add event");
      await t.see("That date has already gone by.");
      await t.dontSee("Sat, Dec 20");
      await t.say("Ordinary members never see the calendar");
      await t.signInAs("alice@friendloop.test");
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("Questions");
      await t.dontSee("Events and birthdays");
      await t.say("An admin does");
      await t.signInAs("ada@friendloop.test");
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("Events and birthdays");
      await t.see("Alice's birthday");
    } },

  O2: { title: "Event lands in the right round", area: AREA,
    staged: "The two events are seeded and the clock is pinned to January 2026. Rounds are opened and delivered by the real sweep run at those moments; the emails are the ones it really sent. The later rounds at the end are swept off camera, with nobody answering, to reach the February round.",
    seed: async () => {
      const loop = await seedLoop();
      await birthday(loop, person(loop, "alice"), 1, 6);
      await rows("insert into events (group_id, kind, title, emoji, month, day, year) values ($1, 'once', 'The housewarming', '🏡', 2, 14, 2026)", [loop.groupId]);
      return loop;
    },
    run: async (t, loop) => {
      const [alice, bob] = [person(loop, "alice"), person(loop, "bob")];
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("On the calendar: a birthday this week, a party next month");
      await t.see("Alice's birthday");
      await t.see("The housewarming");
      await t.say("Friday morning: the new round opens");
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      const first = await placements();
      t.check_(first.length === 1 && first[0].title === "Alice's birthday" && first[0].event_date === "2026-01-06", `Round 1 holds: ${asTable(first)}`);
      await t.panel("sections placed in this round", `${asTable(first)}\nThe housewarming: not in this window, left for later`);
      await t.say("Bob gets his email");
      await t.signInAs(null);
      await t.openMail({ to: bob.email });
      await t.say("The sheet has a section for Alice's birthday");
      await t.followMailLink("/r/");
      await t.see("And a little extra");
      await t.see("Alice's birthday");
      await t.see("Leave Alice a note or a photo.");
      await t.dontSee("The housewarming");
      await t.say("Bob writes a message and adds a photo");
      await t.fill('[aria-label="And a little extra"] textarea', "Happy birthday, Alice. Cake is on me.");
      await t.upload('[aria-label="And a little extra"] input[type=file]', "photo2.jpg");
      await t.see("Photo added.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("Delivery day: it travels in the email");
      await t.clock(DELIVERY_DAY);
      await t.sweep(DELIVERY_DAY, { show: false });
      const mail = await t.openMail({ to: alice.email, subject: "round 1" }, { inbox: false });
      t.check_(mail.HTML.includes("Alice&#39;s birthday") && mail.HTML.includes("Cake is on me"), "The delivery email lacks the section");
      await t.open(`${t.stack.mailpit}/view/${mail.ID}.html`);
      await t.see("Happy birthday, Alice. Cake is on me.");
      await t.say("And on the web round");
      const [issue] = await rows("select id from issues order by number asc limit 1");
      await t.open(`/i/${issue.id}?m=${alice.token}`);
      await t.see("Alice's birthday");
      await t.see("Happy birthday, Alice. Cake is on me.");
      await t.eval(`document.querySelector('img[src*="/uploads/"]')?.scrollIntoView({ behavior: "smooth", block: "center" })`);
      await t.pause(900);
      await t.dontSee("The housewarming");
      await t.say("The housewarming waits for the round that holds it");
      for (let week = 2; week <= 6; week += 1) {
        await unpause(loop);
        await t.sweep(new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * DAY), { show: false });
      }
      const later = await placements();
      const party = later.find((row) => row.title === "The housewarming");
      t.check_(party?.event_date === "2026-02-14", `The housewarming wasn't placed: ${asTable(later)}`);
      await t.panel("every event section so far", asTable(later));
    } },

  O3: { title: "Birthdays recur", area: AREA,
    staged: "Four separate loops, reset between scenes. Events are seeded and the clock jumps to each moment; every placement comes from the real sweep, and the panels show the real rows. Nobody answers, so rounds are skipped; the pause that causes is cleared between sweeps.",
    run: async (t) => {
      let loop = await seedLoop();
      await birthday(loop, person(loop, "alice"), 1, 20);
      await t.clock(E2E_NOW);
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("A weekly loop; Alice's birthday is Tuesday 20 January");
      await t.see("Alice's birthday");
      await t.signInAs(null);
      const weekly = async (week) => {
        await unpause(loop);
        const at = new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * DAY);
        await t.sweep(at, { show: false });
        await t.sweep(at, { show: false }); // a second trigger at the same moment changes nothing
        return at;
      };
      for (const week of [0, 1]) await weekly(week);
      await t.clock(await weekly(2));
      await t.say("The round opening on the 16th holds it");
      await t.open(`/r/${person(loop, "bob").token}`);
      await t.see("Round 3");
      await t.see("Alice's birthday");
      await t.say("The round after does not");
      await t.clock(await weekly(3));
      await t.reload();
      await t.see("Round 4");
      await t.dontSee("Alice's birthday");
      for (const week of [4, 5, 6]) await weekly(week);
      const weeklyPlaced = await placements();
      const [{ count }] = await rows("select count(*)::int as count from issues");
      t.check_(weeklyPlaced.length === 1 && weeklyPlaced[0].number === 3 && weeklyPlaced[0].event_date === "2026-01-20", asTable(weeklyPlaced));
      await t.panel("after 7 weeks, each swept twice", `${count} rounds, 1 section:\n${asTable(weeklyPlaced)}`);

      await t.say("Fortnightly, and the date falls between two rounds");
      await t.clock(AFTER_FIRST_SLOT);
      await resetDatabase();
      loop = await seedLoop({ cadenceWeeks: 2 });
      await birthday(loop, person(loop, "bob"), 1, 13);
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      await t.open(`/r/${person(loop, "alice").token}`);
      await t.see("Round 1");
      await t.see("Bob's birthday");
      for (let round = 1; round < 3; round += 1) {
        await unpause(loop);
        await t.sweep(new Date(AFTER_FIRST_SLOT.getTime() + round * 14 * DAY), { show: false });
      }
      const gap = await placements();
      t.check_(gap.length === 1 && gap[0].number === 1 && gap[0].event_date === "2026-01-13", asTable(gap));
      await t.panel("round 1 closes on the 9th, round 2 opens on the 16th", `Birthday on the 13th:\n${asTable(gap)}`);

      await t.say("A round crossing New Year catches both sides");
      await t.clock(null);
      await resetDatabase();
      loop = await seedLoop({ createdAt: new Date("2025-12-01T00:00:00Z") });
      await birthday(loop, person(loop, "alice"), 12, 31);
      await birthday(loop, person(loop, "bob"), 1, 1, "🎉");
      const newYear = new Date("2025-12-26T08:05:00Z");
      await t.clock(newYear);
      await t.signInAs(null);
      await t.sweep(newYear, { show: false });
      await t.open(`/r/${loop.ownerToken}`);
      await t.see("Alice's birthday");
      await t.see("Bob's birthday");
      const crossing = await placements();
      t.check_(crossing.length === 2 && crossing[0].event_date === "2025-12-31" && crossing[1].event_date === "2026-01-01", asTable(crossing));
      await t.panel("the round of 26 December", asTable(crossing));

      await t.say("Born on 29 February: in 2026 it keeps to the 28th");
      await t.clock(null);
      await resetDatabase();
      loop = await seedLoop({ createdAt: new Date("2026-02-01T00:00:00Z") });
      await birthday(loop, person(loop, "alice"), 2, 29);
      const leapless = new Date("2026-02-27T08:05:00Z");
      await t.clock(leapless);
      await t.sweep(leapless, { show: false });
      await t.open(`/r/${person(loop, "bob").token}`);
      await t.see("Alice's birthday");
      const leap = await placements();
      t.check_(leap.length === 1 && leap[0].event_date === "2026-02-28", asTable(leap));
      await t.panel("the round of 27 February 2026", asTable(leap));
    } },

  O4: { title: "Past truth", area: AREA,
    staged: "The birthday is seeded and the clock is pinned to January 2026. Rounds open and deliver by the real sweep. Bob's message, Alice's rename, and the owner's edit and removal all happen through the real UI.",
    seed: async () => {
      const loop = await seedLoop();
      await birthday(loop, person(loop, "alice"), 1, 6);
      return loop;
    },
    run: async (t, loop) => {
      const [alice, bob] = [person(loop, "alice"), person(loop, "bob")];
      await t.clock(AFTER_FIRST_SLOT);
      await t.say("The round opens with a section for Alice's birthday");
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      await t.open(`/r/${bob.token}`);
      await t.see("Alice's birthday");
      await t.say("Bob writes his message");
      await t.fill('[aria-label="And a little extra"] textarea', "Many happy returns.");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("Then Alice changes her name to Alicia");
      await t.open(`/r/${alice.token}`);
      await t.fillLabel("What should we call you?", "Alicia");
      await t.press("Tab");
      await t.see("Hi Alicia");
      await t.pause(1200);
      await t.say("The owner moves the date and changes the icon");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("Alicia's birthday");
      await t.click(`summary[aria-label="Edit Alicia's birthday"]`);
      await setDate(t, 'details[open] input[name="date"]', "1990-05-05");
      await t.ab("fill", 'details[open] input[name="emoji"]', "🎈");
      await t.pause(400);
      await t.button("Save changes");
      await t.see("Event saved.");
      await t.see("May 5");
      await t.say("And then deletes the event");
      await t.button("Remove Alicia's birthday");
      await t.button("Yes, remove");
      await t.see("Event removed.");
      const [snapshot] = await rows("select title, emoji, event_id, event_date::text as event_date from issue_sections");
      t.check_(snapshot.title === "Alice's birthday" && snapshot.emoji === "🎂" && snapshot.event_id === null && snapshot.event_date === "2026-01-06", JSON.stringify(snapshot));
      await t.panel("the round's own copy of the section", `title ${snapshot.title}\nemoji ${snapshot.emoji}\ndate ${snapshot.event_date}\nlink to the event: ${snapshot.event_id ?? "none, it was deleted"}`);
      await t.say("Bob's sheet still reads as it did, his message intact");
      await t.signInAs(null);
      await t.open(`/r/${bob.token}`);
      await t.see("Alice's birthday");
      const kept = await t.eval(`document.querySelector('[aria-label="And a little extra"] textarea')?.value`);
      t.check_(kept === "Many happy returns.", `Bob's message reads: ${kept}`);
      await t.say("So does the delivered round");
      await t.clock(DELIVERY_DAY);
      await t.sweep(DELIVERY_DAY, { show: false });
      const [issue] = await rows("select id from issues order by number asc limit 1");
      await t.open(`/i/${issue.id}?m=${alice.token}`);
      await t.see("Alice's birthday");
      await t.see("Many happy returns.");
      await t.dontSee("Alicia's birthday");
    } },
};
