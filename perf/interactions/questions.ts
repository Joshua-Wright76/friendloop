import { QUESTION_PACKS } from "@/lib/question-packs";
import type { Ctx, Interaction } from "../lib/types";
import { live, notice, openPicker, option, part, quote, rowMenu } from "./helpers";

const page = (c: Ctx, id = c.world.loopId) => `/g/${id}/questions`;
const phone = (c: Ctx) => c.profile.id === "phone-4g";
const TAKEN = "What's the best thing you bought lately?";
const POLL = "Where should we camp this summer?";
const packQuestion = QUESTION_PACKS.find((pack) => pack.name === "Tiny joys")!.questions[0];

/** Back to the seeded pool: a sample's new question must not change the next one's page. */
async function resetPool(c: Ctx) {
  const seeded = c.world.questionIds.map((id) => `'${id}'`).join(",");
  await c.world.query(`delete from questions where group_id = '${c.world.loopId}' and id not in (${seeded}) and text <> '${quote(POLL)}'`);
}

async function resetSuggestions(c: Ctx) {
  await c.world.query(`delete from question_suggestions where group_id = '${c.world.loopId}' and text like 'Perf %'`);
}

/** A pending suggestion from someone with no other, so its row can be found by their name. */
async function suggest(c: Ctx, text: string) {
  await resetSuggestions(c);
  await c.world.query(`insert into question_suggestions (group_id, membership_id, text) values ('${c.world.loopId}', '${c.world.people[5].membershipId}', '${text}')`);
  await c.page.goto(page(c));
  const summary = c.page.locator("summary").filter({ hasText: /suggested by/ }).first();
  await live(summary);
  await summary.click();
  await suggestionRow(c).waitFor();
}
const suggestionRow = (c: Ctx) => c.page.locator("li").filter({ hasText: `from ${c.world.people[5].name}` });

async function skipState(c: Ctx, skipped: boolean) {
  await c.world.query(`update questions set skip_next = false where group_id = '${c.world.loopId}'`);
  await c.world.query(`update questions set skip_next = ${skipped} where group_id = '${c.world.loopId}' and text = '${quote(TAKEN)}'`);
  await c.page.goto(page(c));
  await rowMenu(c, TAKEN);
}

export const questionInteractions: Interaction[] = [
  {
    id: "questions.custom.add",
    label: "Add a question of your own and see it in the pool",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C1"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await resetPool(c);
      await c.page.goto(page(c));
      const field = c.page.getByLabel("New question");
      await live(field);
      await field.fill(`Perf question ${c.unique}?`);
    },
    act: (c) => c.page.getByRole("button", { name: "Add question" }).click(),
    done: (c) => ({ selector: ".question-order-item p", text: `Perf question ${c.unique}?` }),
  },
  {
    id: "questions.order.move",
    label: "Move a question down the pool",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C2"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await c.page.goto(page(c));
      const row = c.page.locator(".question-order-item").first();
      await live(row.locator("summary"));
      await row.locator("summary").click();
      // A phone has no Up and Down: Move opens a sheet of places instead.
      if (phone(c)) {
        await row.locator(".question-mobile-move").click();
        await c.page.locator("dialog .move-row").nth(1).waitFor();
      } else {
        await row.getByRole("button", { name: /^Down\b/ }).waitFor();
      }
    },
    act: (c) => phone(c)
      ? c.page.locator("dialog .move-row").nth(1).click()
      : c.page.locator(".question-order-item").first().getByRole("button", { name: /^Down\b/ }).click(),
    // Not the row jumping, which is optimistic: the note that says the server agreed.
    done: () => ({ selector: ".toast", text: "Moved to position 2 of" }),
  },
  {
    id: "questions.skip.on",
    label: "Skip a question for the next round",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C4"], routes: ["/g/[id]/questions"],
    prepare: (c) => skipState(c, false),
    act: (c) => c.page.getByRole("button", { name: `Skip next round: ${TAKEN}` }).click(),
    done: () => ({ selector: ".question-order-item p", text: "Sitting out the next round" }),
  },
  {
    id: "questions.skip.off",
    label: "Bring a skipped question back in",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C4"], routes: ["/g/[id]/questions"],
    prepare: (c) => skipState(c, true),
    act: (c) => c.page.getByRole("button", { name: `Back in: ${TAKEN}` }).click(),
    done: () => notice("Saved. The rotation is updated."),
  },
  {
    id: "questions.archive.confirm",
    label: "Archive a question",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C3"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(page(c, loop.id));
      await rowMenu(c, "First?");
      await c.page.getByRole("button", { name: /^Archive/ }).first().click();
      await c.page.getByRole("button", { name: /^Yes, archive/ }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: /^Yes, archive/ }).click(),
    done: () => notice("Archived."),
  },
  {
    id: "questions.rotation.save",
    label: "Choose how many questions each round asks",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C5"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      // Starts rotating and is chosen back to all of them, so the loop ends as it began.
      await c.world.query(`update groups set questions_per_round = 3 where id = '${c.world.loopId}'`);
      await c.page.goto(page(c));
      const summary = c.page.locator("summary").filter({ hasText: /Each round asks/ }).first();
      await live(summary);
      await summary.click();
      await openPicker(c, "Questions per round");
    },
    act: (c) => option(c, "All questions").click(),
    done: () => notice("Questions per round updated."),
  },
  {
    id: "questions.packs.open",
    label: "Open the part of the page with the question packs",
    surface: "questions", kind: "instant", viewer: "owner",
    flows: ["C6"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await c.page.goto(page(c));
      await live(c.page.getByRole("button", { name: "Add more", exact: true }));
    },
    act: (c) => c.page.getByRole("button", { name: "Add more", exact: true }).click(),
    done: () => ({ selector: "h2", text: "Question packs" }),
  },
  {
    id: "questions.pack.add",
    label: "Add a question from a pack",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["C6"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await resetPool(c);
      await c.page.goto(page(c));
      await part(c, "Add more");
      await c.page.getByRole("button", { name: /^Tiny joys/ }).click();
      await c.page.getByRole("group", { name: "Tiny joys", exact: true }).getByText(packQuestion).click();
      await c.page.getByText("1 selected").waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Add to the pool" }).click(),
    done: () => notice("1 question added."),
  },
  {
    id: "questions.poll.add",
    label: "Add a poll",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["L1"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await resetPool(c);
      await c.page.goto(page(c));
      await part(c, "Add more");
      await c.page.getByLabel("Poll question").fill(`Perf poll ${c.unique}?`);
      await c.page.getByLabel("Option 1").fill("Yes");
      await c.page.getByLabel("Option 2").fill("No");
    },
    act: (c) => c.page.getByRole("button", { name: "Add poll" }).click(),
    done: () => notice("Poll added."),
  },
  {
    id: "questions.suggestion.accept",
    label: "Accept a suggested question into the pool",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["I2"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await resetPool(c);
      await suggest(c, `Perf suggestion ${c.unique}?`);
    },
    act: (c) => suggestionRow(c).getByRole("button", { name: "Add to pool" }).click(),
    done: (c) => ({ selector: ".question-order-item p", text: `Perf suggestion ${c.unique}?` }),
  },
  {
    id: "questions.suggestion.decline",
    label: "Turn a suggested question down",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["I2"], routes: ["/g/[id]/questions"],
    prepare: (c) => suggest(c, `Perf suggestion ${c.unique}?`),
    act: (c) => suggestionRow(c).getByRole("button", { name: "Decline" }).click(),
    done: () => notice("Suggestion declined."),
  },
  {
    id: "questions.section.add",
    label: "Add a section and see it listed",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["K1"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await c.world.query(`delete from sections where group_id = '${c.world.loopId}' and title like 'Perf %'`);
      await c.page.goto(page(c));
      await part(c, "Sections and dates");
      await c.page.getByPlaceholder("The potluck corner").fill(`Perf section ${c.unique}`);
    },
    act: (c) => c.page.getByRole("button", { name: "Add section" }).click(),
    done: (c) => ({ selector: `[aria-label="Sections in order"] > li`, text: `Perf section ${c.unique}` }),
  },
  {
    id: "questions.section.archive",
    label: "Archive a section",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["K1"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      const title = `Perf section ${c.unique}`;
      await c.world.query(`delete from sections where group_id = '${c.world.loopId}' and title like 'Perf %'`);
      await c.world.query(`insert into sections (group_id, kind, title, position) values ('${c.world.loopId}', 'standard', '${title}', 99)`);
      await c.page.goto(page(c));
      await part(c, "Sections and dates");
      await rowMenu(c, title);
      await c.page.getByRole("button", { name: `Archive ${title}` }).click();
      await c.page.getByRole("button", { name: `Yes, archive ${title}` }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: `Yes, archive Perf section ${c.unique}` }).click(),
    done: () => notice("Section archived."),
  },
  {
    id: "questions.event.add",
    label: "Add an event and see it under Coming up",
    surface: "questions", kind: "write", viewer: "owner",
    flows: ["O1"], routes: ["/g/[id]/questions"],
    prepare: async (c) => {
      await c.world.query(`delete from events where group_id = '${c.world.loopId}' and title like 'Perf %'`);
      await c.page.goto(page(c));
      await part(c, "Sections and dates");
      await openPicker(c, "Type of event");
      await option(c, "One-time event").click();
      const panel = c.page.getByRole("region", { name: "Events and birthdays" });
      await panel.getByLabel("What's the occasion?").last().fill(`Perf event ${c.unique}`);
      await panel.getByLabel("Date").last().fill(`${new Date().getFullYear() + 1}-06-15`);
    },
    act: (c) => c.page.getByRole("button", { name: "Add event" }).click(),
    done: (c) => ({ selector: `[aria-label="Events, soonest first"] > li`, text: `Perf event ${c.unique}` }),
  },
];
