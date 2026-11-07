import type { Ctx, Interaction } from "../lib/types";
import { catchDownload, DOWNLOADED, HEADER, live, notice, part, pick } from "./helpers";

const settings = (id: string) => `/g/${id}/settings`;
const main = (c: Ctx) => settings(c.world.loopId);

async function paused(c: Ctx, value: boolean) {
  await c.world.query(`update groups set paused_at = ${value ? "now()" : "null"} where id = '${c.world.loopId}'`);
  await c.page.goto(main(c));
  await part(c, "Pause and export");
}

/** A checkbox flipped on a throwaway: on the real loop it would change what later samples see. */
async function flip(c: Ctx, label: string, on: boolean) {
  const loop = await c.world.throwawayLoop();
  await c.page.goto(settings(loop.id));
  const box = c.page.getByLabel(label);
  await live(box);
  await box.setChecked(on);
}

const save = (c: Ctx) => c.page.getByRole("button", { name: "Save changes" }).click();

export const settingsInteractions: Interaction[] = [
  {
    id: "settings.schedule.save",
    label: "Change the day a round goes out",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["F1"], routes: ["/g/[id]/settings"],
    prepare: async (c) => {
      // Starts on Monday and is chosen back to Friday, so the loop ends as it began.
      await c.world.query(`update groups set prompt_weekday = 1 where id = '${c.world.loopId}'`);
      await c.page.goto(main(c));
      await pick(c, "Day", "Friday");
    },
    act: save,
    done: () => notice("Saved."),
  },
  {
    id: "settings.pause.on",
    label: "Pause the loop",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["F2"], routes: ["/g/[id]/settings"],
    prepare: (c) => paused(c, false),
    act: (c) => c.page.locator("#settings-keep").getByRole("button", { name: "Pause" }).click(),
    // The action redirects and the page comes back on Details, so this is all a person sees change.
    done: () => ({ selector: `.subtab[aria-pressed="true"]`, text: "Details" }),
  },
  {
    id: "settings.pause.off",
    label: "Resume the loop",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["F2"], routes: ["/g/[id]/settings"],
    prepare: (c) => paused(c, true),
    act: (c) => c.page.locator("#settings-keep").getByRole("button", { name: "Resume" }).click(),
    done: () => ({ selector: `.subtab[aria-pressed="true"]`, text: "Details" }),
  },
  {
    id: "settings.comments.toggle",
    label: "Turn comments off",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["M2"], routes: ["/g/[id]/settings"],
    prepare: (c) => flip(c, "Members can comment on delivered issues.", false),
    act: save,
    done: () => notice("Saved."),
  },
  {
    id: "settings.sharing.toggle",
    label: "Turn share links on",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["E2"], routes: ["/g/[id]/settings"],
    prepare: (c) => flip(c, "Anyone with an issue's share link can read it.", true),
    act: save,
    done: () => notice("Saved."),
  },
  {
    id: "settings.shares.reset",
    label: "Reset the share links of 26 rounds",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["F6"], routes: ["/g/[id]/settings"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.world.query(`update groups set share_enabled = true where id = '${loop.id}'`);
      await c.world.query(`insert into issues (group_id, number, status, slot_at, opens_at, delivers_at, delivered_at, share_token)
        select '${loop.id}', n, 'delivered', now() - n * interval '7 days', now(), now(), now(), md5(n::text || '${loop.id}') from generate_series(1, 26) n`);
      await c.page.goto(settings(loop.id));
      await part(c, "Reset and delete");
      await c.page.getByRole("button", { name: "Reset share links" }).click();
      await c.page.getByRole("button", { name: "Yes, reset share links" }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Yes, reset share links" }).click(),
    done: () => notice("New share links. Old ones no longer work."),
  },
  {
    id: "settings.paper.open",
    label: "Open the part of settings with the paper choices",
    surface: "settings", kind: "instant", viewer: "owner",
    flows: ["N1"], routes: ["/g/[id]/settings"],
    prepare: async (c) => {
      await c.page.goto(main(c));
      await live(c.page.getByRole("button", { name: "Paper", exact: true }));
    },
    act: (c) => c.page.getByRole("button", { name: "Paper", exact: true }).click(),
    done: () => ({ selector: "#stationery-title" }),
  },
  {
    id: "settings.stationery.save",
    label: "Choose a paper for the loop",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["N1", "N2"], routes: ["/g/[id]/settings"],
    prepare: async (c) => {
      // Starts dressed and is chosen back to the original, so later samples see a plain loop.
      await c.world.query(`update groups set theme_preset = 'meadow' where id = '${c.world.loopId}'`);
      await c.page.goto(main(c));
      await part(c, "Paper");
      await live(c.page.getByRole("radio", { name: /Gingham Picnic/ }));
    },
    act: (c) => c.page.getByRole("radio", { name: /Gingham Picnic/ }).check(),
    done: () => ({ selector: `p[role="status"].toast`, text: "Saved. Everyone sees it on their next visit." }),
  },
  {
    id: "settings.header.upload",
    label: "Upload a header picture",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["N1", "T1"], routes: ["/g/[id]/settings", "/api/loop/[id]/header-image"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(settings(loop.id));
      await part(c, "Paper");
      await live(c.page.getByLabel("Choose a header picture"));
    },
    act: (c) => c.page.getByLabel("Choose a header picture").setInputFiles(HEADER),
    done: () => ({ selector: `p[aria-live="polite"]`, text: "Header picture saved." }),
  },
  {
    id: "settings.archive.download",
    label: "Download the loop's whole archive",
    surface: "settings", kind: "navigation", viewer: "owner",
    flows: ["V4"], routes: ["/g/[id]/settings", "/g/[id]/export"],
    prepare: async (c) => {
      await c.page.goto(main(c));
      await part(c, "Pause and export");
      await catchDownload(c, `/g/${c.world.loopId}/export`);
    },
    act: (c) => c.page.getByRole("link", { name: "Download the archive" }).click(),
    done: () => DOWNLOADED,
  },
  {
    id: "settings.delete.open",
    label: "Open the delete confirmation",
    surface: "settings", kind: "instant", viewer: "owner",
    flows: ["F4"], routes: ["/g/[id]/settings"],
    prepare: async (c) => {
      await c.page.goto(main(c));
      await live(c.page.getByRole("button", { name: "Reset and delete", exact: true }));
    },
    act: (c) => c.page.getByRole("button", { name: "Reset and delete", exact: true }).click(),
    done: () => ({ selector: "#settings-danger h3", text: "Delete the loop" }),
  },
  {
    id: "settings.delete.confirm",
    label: "Delete a loop and land on your loops",
    surface: "settings", kind: "write", viewer: "owner",
    flows: ["F4"], routes: ["/g/[id]/settings", "/you"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(settings(loop.id));
      await part(c, "Reset and delete");
      await c.page.getByLabel(`Type "${loop.name}" to confirm`).fill(loop.name);
    },
    act: (c) => c.page.getByRole("button", { name: "Delete forever" }).click(),
    done: () => notice("That loop is gone.", { path: "^/you" }),
  },
];
