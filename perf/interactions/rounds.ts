import type { Ctx, Interaction } from "../lib/types";
import { live, notice, open, openPicker, option } from "./helpers";

const rounds = (c: Ctx) => `/g/${c.world.loopId}/issues`;
const TO_NAME = 14;

export const roundInteractions: Interaction[] = [
  {
    id: "rounds.send.now",
    label: "Start a round now",
    surface: "rounds", kind: "write", viewer: "owner",
    flows: ["D3"], routes: ["/g/[id]", "/g/[id]/issues"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(`/g/${loop.id}`);
      const send = c.page.getByRole("button", { name: "Send now" });
      await live(send);
      await send.click();
      await c.page.getByRole("button", { name: "Yes, send it now" }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Yes, send it now" }).click(),
    done: () => notice("is open and everyone"),
  },
  {
    id: "rounds.nudge.send",
    label: "Nudge whoever hasn't answered",
    surface: "rounds", kind: "write", viewer: "owner",
    flows: ["D10"], routes: ["/g/[id]"],
    prepare: async (c) => {
      await c.page.goto(`/g/${c.world.loopId}`);
      const nudge = c.page.getByRole("button", { name: /^Nudge/ });
      await live(nudge);
      await nudge.click();
      await c.page.getByRole("button", { name: "Send the nudge" }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Send the nudge" }).click(),
    done: () => notice("nudges sent."),
  },
  {
    id: "rounds.name.save",
    label: "Name a round and see the name in the list",
    surface: "rounds", kind: "write", viewer: "owner",
    flows: ["N4"], routes: ["/g/[id]/issues"],
    prepare: async (c) => {
      await c.world.query(`update issues set name = null where id = '${c.world.olderIssueId}'`);
      await c.page.goto(rounds(c));
      const summary = c.page.getByLabel(`Name this round: Round ${TO_NAME}`);
      await live(summary);
      await summary.click();
      await c.page.getByLabel(`Name for round ${TO_NAME}`).fill(`Perf name ${c.unique}`);
    },
    act: (c) => c.page.locator("details.round-rename[open]").getByRole("button", { name: "Save name" }).click(),
    done: (c) => ({ selector: "main li.card h2", text: `Perf name ${c.unique}` }),
  },
  {
    id: "rounds.filter.open",
    label: "Open the filter on the rounds list",
    surface: "rounds", kind: "instant", viewer: "owner",
    flows: ["R2"], routes: ["/g/[id]/issues"],
    prepare: (c) => open(c, rounds(c), "details.filter-fold summary"),
    act: (c) => c.page.locator("details.filter-fold summary").click(),
    done: () => ({ selector: "details.filter-fold[open] .filter-line" }),
  },
  {
    id: "rounds.filter.member",
    label: "See only the rounds one person answered in",
    surface: "rounds", kind: "navigation", viewer: "owner",
    flows: ["R2"], routes: ["/g/[id]/issues"],
    prepare: async (c) => {
      await open(c, rounds(c), "details.filter-fold summary");
      await c.page.locator("details.filter-fold summary").click();
      await openPicker(c, "Rounds with answers from");
    },
    act: (c) => option(c, c.world.admin.name).click(),
    done: (c) => ({ selector: "details.filter-fold [role=\"status\"]", text: `Showing rounds ${c.world.admin.name} answered in.`, path: "member=" }),
  },
  {
    id: "rounds.past.open",
    label: "Open a past round from the list",
    surface: "rounds", kind: "navigation", viewer: "owner",
    flows: ["E5"], routes: ["/g/[id]/issues", "/i/[id]"],
    prepare: async (c) => {
      await c.page.goto(rounds(c));
      await live(c.page.getByRole("link", { name: `Read the issue: Round ${c.world.latestIssueNumber}` }));
    },
    act: (c) => c.page.getByRole("link", { name: `Read the issue: Round ${c.world.latestIssueNumber}` }).click(),
    done: (c) => ({ selector: "article.answer-card", path: `^/i/${c.world.latestIssueId}$` }),
  },
];
