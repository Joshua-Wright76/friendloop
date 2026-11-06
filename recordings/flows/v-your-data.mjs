import { seedLoop, seedDeliveredIssue, seedOpenIssue, addMember } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { DELIVERY_DAY, AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";

const AREA = "V · Your data";
const SAM = "owner@friendloop.test";
const WREN = "wren@friendloop.test";

/** Fetch a download from inside the page, so it carries the session and shows what really came back. */
async function fetchFromPage(t, path) {
  return t.eval(`(async () => {
    const r = await fetch(${JSON.stringify(path)}, { redirect: "manual" });
    return { status: r.status, type: r.type, disposition: r.headers.get("content-disposition"), body: r.type === "opaqueredirect" ? "" : await r.text() };
  })()`);
}

export const flows = {
  V1: { title: "Privacy and terms", area: AREA, run: async (t) => {
    await t.open("/");
    await t.say("The landing page footer links to privacy");
    await t.reveal("Privacy");
    await t.link("Privacy");
    await t.expectUrl(/\/privacy$/);
    await t.say("Plain language about what's stored, and why");
    await t.see("What we keep, and why");
    for (const processor of ["Vercel", "Neon", "Resend", "Sentry"]) await t.see(processor, { hold: 200 });
    await t.see("Taking it with you, and deleting it");
    await t.tour({ dwell: 450, max: 6 });
    await t.say("Then the terms");
    await t.link("Terms");
    await t.expectUrl(/\/terms$/);
    await t.see("The ground rules");
    await t.tour({ dwell: 400, max: 4 });
    await t.say("The sign-in page has both too");
    await t.open("/signin");
    await t.link("Privacy");
    await t.expectUrl(/\/privacy$/);
    await t.say("Every email carries them under its footer");
    await t.open("/signin");
    await t.fillLabel("Your email", SAM);
    await t.button("Email me a link");
    await t.expectUrl(/\/signin\/check-email$/);
    await t.openMail({ to: SAM }, { inbox: false });
    t.mailLink("/privacy");
    t.mailLink("/terms");
    await t.followMailLink("/terms");
    await t.expectUrl(/\/terms$/);
    await t.see("The ground rules");
  } },

  V2: { title: "Delete my account", area: AREA,
    staged: "The loop and its delivered round are seeded. The deletion itself is real.",
    seed: async () => {
      const loop = await seedLoop();
      const wren = await addMember(loop, { email: WREN, name: "Wren" });
      loop.members.push({ ...wren, participation: "contributor", access: "member" });
      const issue = await seedDeliveredIssue(loop, {
        deliveredAt: DELIVERY_DAY,
        answers: [
          { email: WREN, body: "Wren went sailing" },
          { email: "alice@friendloop.test", body: "Alice baked bread" },
        ],
      });
      return { loop, issue, alice: loop.members.find((member) => member.email.startsWith("alice")) };
    },
    run: async (t, { loop, issue, alice }) => {
      await t.say("Alice can read Wren's answer in the delivered round");
      await t.open(`/i/${issue.issueId}?m=${alice.token}`);
      await t.see("Wren went sailing");
      await t.say("Wren, signed in, goes to delete her account");
      await t.signInAs(WREN);
      await t.open("/you");
      await t.link("Delete my account");
      await t.expectUrl(/\/you\/delete$/);
      await t.see("Delete your account");
      await t.say("A typo deletes nothing");
      await t.fillLabel("Type your email address to confirm", "wren@friendloop.tes");
      await t.button("Delete my account forever");
      await t.see("That doesn't match your email address. Nothing was deleted.");
      await t.say("The right address, and it all goes");
      await t.fillLabel("Type your email address to confirm", "Wren@Friendloop.test");
      await t.button("Delete my account forever");
      await t.expectUrl(/\/goodbye$/);
      await t.see("It's all gone.");
      const left = await rows("select (select count(*) from users where email = $1)::int as users, (select count(*) from memberships where email = $1)::int as memberships, (select count(*) from replies where body = 'Wren went sailing')::int as answers", [WREN]);
      await t.panel("left for wren@friendloop.test", JSON.stringify(left[0]));
      t.check_(left[0].users === 0 && left[0].memberships === 0 && left[0].answers === 0, "Everything of Wren's should be gone");
      await t.say("She's signed out");
      await t.open("/you");
      await t.expectUrl(/\/signin$/);
      await t.say("The round reads on without her");
      await t.open(`/i/${issue.issueId}?m=${alice.token}`);
      await t.see("Alice baked bread");
      await t.dontSee("Wren went sailing");
      await t.say("An owner with people in the loop must hand it on first");
      await t.signInAs(SAM);
      await t.open("/you/delete");
      await t.see("First, hand on or delete the loops you own");
      await t.see("Friday Loop");
      await t.dontSee("Delete my account forever");
      await t.link("Hand it on");
      await t.expectUrl(new RegExp(`/g/${loop.groupId}/members$`));
    } },

  V3: { title: "Leave through the reply link", area: AREA,
    staged: "The earlier round and the open round are seeded, with the clock pinned to when the round is open.",
    seed: async () => {
      const loop = await seedLoop();
      const delivered = await seedDeliveredIssue(loop, {
        deliveredAt: DELIVERY_DAY,
        answers: [
          { email: "alice@friendloop.test", body: "Alice's old answer" },
          { email: "bob@friendloop.test", body: "Bob's old answer" },
        ],
      });
      await seedOpenIssue(loop, { openedAt: new Date(DELIVERY_DAY.getTime() + 60 * 60 * 1000) });
      const find = (prefix) => loop.members.find((member) => member.email.startsWith(prefix));
      return { loop, delivered, alice: find("alice"), bob: find("bob") };
    },
    run: async (t, { loop, delivered, alice, bob }) => {
      await t.clock(new Date(DELIVERY_DAY.getTime() + 2 * 60 * 60 * 1000));
      await t.say("Alice, on her reply link, decides to leave");
      await t.open(`/r/${alice.token}`);
      await t.reveal("Leave this loop and delete my answers");
      await t.link("Leave this loop and delete my answers");
      await t.expectUrl(new RegExp(`/r/${alice.token}/leave$`));
      await t.say("The page changes nothing until she confirms");
      await t.see("Leave Friday Loop?");
      const still = await rows("select id from memberships where id = $1", [alice.id]);
      t.check_(still.length === 1, "Opening the page must not remove her");
      await t.clickRole("checkbox", "I understand everything I wrote in Friday Loop will be deleted");
      await t.button("Leave and delete my answers");
      await t.expectUrl(/\/goodbye$/);
      await t.pause(1000);
      const gone = await rows("select (select count(*) from memberships where id = $1)::int as membership, (select count(*) from replies where body = 'Alice''s old answer')::int as answers", [alice.id]);
      await t.panel("left for Alice", JSON.stringify(gone[0]));
      t.check_(gone[0].membership === 0 && gone[0].answers === 0, "Her membership and answers should be gone");
      await t.say("Her link stops working");
      await t.open(`/r/${alice.token}`);
      await t.see("This link doesn't work anymore");
      await t.say("The round reads on without her");
      await t.open(`/i/${delivered.issueId}?m=${bob.token}`);
      await t.see("Bob's old answer");
      await t.dontSee("Alice's old answer");
      await t.say("The owner's link explains how to hand on or delete instead");
      await t.open(`/r/${loop.ownerToken}/leave`);
      await t.see("You own Friday Loop");
      await t.dontSee("Leave and delete my answers");
      await t.link("Open the loop's settings");
      await t.expectUrl(new RegExp(`/g/${loop.groupId}/settings|/signin`));
    } },

  V4: { title: "Export", area: AREA,
    staged: "The round is seeded. After each real click on a download link, the same address is fetched from the page so the file's contents can be shown.",
    seed: async () => {
      const loop = await seedLoop();
      await seedDeliveredIssue(loop, {
        deliveredAt: DELIVERY_DAY,
        answers: [
          { email: SAM, body: "Sam's answer" },
          { email: "alice@friendloop.test", body: "Alice's answer" },
        ],
      });
      return { loop, alice: loop.members.find((member) => member.email.startsWith("alice")) };
    },
    run: async (t, { loop, alice }) => {
      await t.say("Sam downloads their own words from their page");
      await t.signInAs(SAM);
      await t.open("/you");
      await t.link("Download my data");
      const mine = await fetchFromPage(t, "/you/export");
      await t.panel(mine.disposition ?? "/you/export", mine.body.slice(0, 420));
      t.check_(/friendloop-my-data-\d{4}-\d{2}-\d{2}\.json/.test(mine.disposition ?? ""), "The personal file should be named");
      t.check_(mine.body.includes("Sam's answer") && !mine.body.includes("Alice's answer"), "Only Sam's own words");

      await t.say("The owner can download the whole loop from settings");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.link("Download the archive");
      const whole = await fetchFromPage(t, `/g/${loop.groupId}/export`);
      await t.panel(whole.disposition ?? "export", whole.body.slice(0, 420));
      t.check_(whole.body.includes("Sam's answer") && whole.body.includes("Alice's answer"), "The archive holds everyone's sent answers");

      await t.say("A plain member gets 404 for the archive");
      await t.signInAs(alice.email);
      await t.open("/you");
      const denied = await fetchFromPage(t, `/g/${loop.groupId}/export`);
      await t.panel(`GET /g/…/export as ${alice.email}`, `HTTP ${denied.status}`);
      t.check_(denied.status === 404, `Member should get 404, got ${denied.status}`);
      await t.say("A stranger gets 404 too, and the personal export sends them to sign in");
      const stranger = await t.request("GET", `/g/${loop.groupId}/export`, { title: "GET /g/…/export, no session" });
      t.check_(stranger.status === 404, `Stranger should get 404, got ${stranger.status}`);
      const out = await t.request("GET", "/you/export", { title: "GET /you/export, no session" });
      t.check_(out.status === 303, `Expected a redirect, got ${out.status}`);

      await t.say("With only a reply link, Alice downloads what she wrote here");
      await t.signInAs(null);
      await t.open(`/r/${alice.token}/leave`);
      await t.link("Download what I wrote here");
      const hers = await fetchFromPage(t, `/r/${alice.token}/export`);
      await t.panel(hers.disposition ?? "export", hers.body.slice(0, 420));
      t.check_(hers.body.includes("Alice's answer") && !hers.body.includes("Bob"), "Only what she wrote");
      await t.see("Leave Friday Loop?");
    } },
};
