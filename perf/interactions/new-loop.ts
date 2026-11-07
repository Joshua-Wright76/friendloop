import type { Ctx, Interaction } from "../lib/types";
import { live, open } from "./helpers";

const NEXT = "Next, continue to the next setup step";
const nameFor = (unique: string) => `Perf loop ${unique}`;

/** Fill in the first step and walk on until this many steps are behind us. */
async function walk(c: Ctx, steps: number) {
  await open(c, "/g/new", "#wizard-step-heading");
  const title = c.page.getByLabel("Loop title");
  await live(title);
  await title.fill(nameFor(c.unique));
  for (let step = 0; step < steps; step++) {
    await c.page.getByRole("button", { name: NEXT }).click();
    await c.page.locator(`[role="progressbar"][aria-valuenow="${step + 2}"]`).waitFor();
  }
}

export const newLoopInteractions: Interaction[] = [
  {
    id: "newloop.page.load",
    label: "Open the new-loop wizard by address",
    surface: "new loop", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["B1"], routes: ["/g/new"],
    act: (c) => c.visit("/g/new"),
    done: () => ({ selector: "#wizard-step-heading" }),
  },
  {
    id: "newloop.step.next",
    label: "Go on to the next wizard step",
    surface: "new loop", kind: "instant", viewer: "owner",
    flows: ["B1"], routes: ["/g/new"],
    prepare: (c) => walk(c, 0),
    act: (c) => c.page.getByRole("button", { name: NEXT }).click(),
    done: () => ({ selector: `[role="progressbar"][aria-valuenow="2"]` }),
  },
  {
    id: "newloop.pack.pick",
    label: "Take a whole question pack in the wizard",
    surface: "new loop", kind: "instant", viewer: "owner",
    flows: ["B2"], routes: ["/g/new"],
    prepare: (c) => walk(c, 2),
    act: (c) => c.page.getByRole("button", { name: "Add all questions in Travel" }).click(),
    done: () => ({ selector: `[role="group"][aria-label="Travel"] .pack-toggle`, text: "picked" }),
  },
  {
    id: "newloop.create.submit",
    label: "Finish the wizard and see the new loop",
    surface: "new loop", kind: "write", viewer: "owner",
    flows: ["B1", "B2"], routes: ["/g/new", "/g/[id]"],
    prepare: (c) => walk(c, 4),
    act: (c) => c.page.getByRole("button", { name: "Create loop" }).click(),
    done: (c) => ({ selector: ".loop-head__name", text: nameFor(c.unique), path: "^/g/[0-9a-f-]+\\?welcome=" }),
  },
];
