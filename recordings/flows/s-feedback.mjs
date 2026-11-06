import { seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";

const AREA = "S · Feedback";
const notes = () => rows("select message, path, sender_email, viewport, left(user_agent, 40) as user_agent from feedback order by created_at");

async function openBox(t) {
  await t.button("Send feedback");
  await t.see("Tell us anything");
}
const sendDisabled = (t) => t.eval(`(() => { const d = document.querySelector("dialog[open]"); const b = [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "Send"); return b.disabled || b.getAttribute("aria-disabled") === "true"; })()`);

export const flows = {
  S1: { title: "Send feedback", area: AREA,
    staged: "A dropped connection is simulated by blocking the request in the browser. The hour's flood is ten real POSTs made off camera. The dev inbox opens with the recording stack's preview key.",
    seed: async () => {
      const loop = await seedLoop();
      await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      return { alice: loop.members.find((member) => member.email.startsWith("alice")), loop };
    },
    run: async (t, { alice, loop }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open("/");
      await t.say("A visitor with no account taps the corner button");
      await openBox(t);
      t.check_(await sendDisabled(t), "Send should start disabled");
      await t.say("One box, and it can't be sent blank");
      await t.fillLabel("Your message", "   ");
      t.check_(await sendDisabled(t), "Spaces alone should not enable Send");
      await t.fillLabel("Your message", "The home page logo looks squashed");
      await t.button("Send", { exact: true });
      await t.see("Thanks, we got it.");
      const [first] = await notes();
      await t.panel("feedback row", `message: ${first.message}\npath: ${first.path}\nviewport: ${first.viewport}\nbrowser: ${first.user_agent}…\nsender: ${first.sender_email ?? "(anonymous, nobody asked)"}`);
      t.check_(first.path === "/" && first.sender_email === null, "An anonymous note should carry the page and no sender");
      await t.button("Done");

      await t.say("A failed send keeps the words");
      await t.page("Network.setBlockedURLs", { urls: ["*/api/feedback"] });
      await openBox(t);
      await t.fillLabel("Your message", "Please keep this");
      await t.button("Send", { exact: true });
      await t.see("That didn't go through. Please try again.");
      await t.see("Your message");
      const kept = await t.eval(`document.querySelector("dialog[open] textarea").value`);
      t.check_(kept === "Please keep this", "The words should stay in the box");
      await t.page("Network.setBlockedURLs", { urls: [] });
      await t.button("Cancel");

      await t.say("Alice, on her reply link, is named from the link itself");
      await t.open(`/r/${alice.token}`);
      await openBox(t);
      await t.fillLabel("Your message", "The reply box jumps when I type");
      await t.button("Send", { exact: true });
      await t.see("Thanks, we got it.");
      const fromLink = (await notes()).at(-1);
      await t.panel("feedback row", `sender: ${fromLink.sender_email}\npath: ${fromLink.path}  (the token is stripped)`);
      t.check_(fromLink.sender_email === alice.email && fromLink.path === "/r/…", "The link should name Alice and be stripped from the path");
      await t.button("Done");

      await t.say("A signed-in owner is named too, never asked");
      await t.signInAs("owner@friendloop.test");
      await t.open(`/g/${loop.groupId}/members`);
      await openBox(t);
      await t.fillLabel("Your message", "Wish I could reorder members");
      await t.button("Send", { exact: true });
      await t.see("Thanks, we got it.");
      const fromOwner = (await notes()).at(-1);
      t.check_(fromOwner.sender_email === "owner@friendloop.test", "The owner should be named");
      await t.button("Done");

      await t.say("An hour's flood from one person is refused");
      await t.signInAs(null);
      for (let i = 0; i < 9; i++) {
        await t.request("POST", "/api/feedback", { show: false, headers: { "x-e2e-now": AFTER_FIRST_SLOT.toISOString() }, body: { message: `Note ${i}`, path: `/r/${alice.token}`, viewport: "1×1" } });
      }
      await t.open(`/r/${alice.token}`);
      await openBox(t);
      await t.fillLabel("Your message", "One more thing");
      await t.button("Send", { exact: true });
      await t.see("a lot of notes for one hour");
      await t.button("Cancel");

      await t.say("The inbox is locked without the key");
      const locked = await t.request("GET", "/dev/feedback", { title: "GET /dev/feedback, no key" });
      t.check_(locked.status === 404, `Expected 404, got ${locked.status}`);
      await t.say("With the key, the notes can be read");
      await t.open("/dev/ui?key=rec-preview-secret");
      await t.open("/dev/feedback");
      await t.see("The home page logo looks squashed");
      await t.see("Anonymous visitor");
      await t.see("alice@friendloop.test");
      await t.see("Wish I could reorder members");
    } },
};
