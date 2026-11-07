import type { Ctx, Interaction } from "../lib/types";
import { AVATAR, live, notice, openPicker, option } from "./helpers";

const members = (id: string) => `/g/${id}/members`;
const row = (c: Ctx, email: string) => c.page.locator("li.card").filter({ hasText: email });
const invitee = (unique: string) => `perf-${unique}@friendloop.test`;

/** Someone with a role to flip who is under test nowhere else. */
const priya = (c: Ctx) => c.world.people[3];

/** Nobody a sample invited stays on the list, or in the nudges of later samples. */
const clearInvites = (c: Ctx) => c.world.query(`delete from memberships where group_id = '${c.world.loopId}' and email like 'perf-%'`);

export const peopleInteractions: Interaction[] = [
  {
    id: "people.invite.send",
    label: "Invite someone and see them on the list",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["B3"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      await clearInvites(c);
      await c.page.goto(members(c.world.loopId));
      const field = c.page.getByLabel("Invite people by email");
      await live(field);
      await field.fill(invitee(c.unique));
      await field.press("Enter");
      await c.page.locator("#invite-people .chip").waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Send invitations" }).click(),
    done: (c) => ({ selector: "li.card .member-row", text: invitee(c.unique) }),
  },
  {
    id: "people.invite.resend",
    label: "Send someone their invitation again",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["B5"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      await clearInvites(c);
      await c.page.goto(members(c.world.loopId));
      await live(c.page.getByRole("button", { name: `Resend invite: ${c.world.pending.email}` }));
    },
    act: (c) => c.page.getByRole("button", { name: `Resend invite: ${c.world.pending.email}` }).click(),
    done: () => notice("Invitation sent again."),
  },
  {
    id: "people.role.change",
    label: "Change what a member can do",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["G3"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      // Starts as an admin and is chosen back to a member, so the loop ends as it began.
      await c.world.query(`update memberships set access = 'admin' where id = '${priya(c).membershipId}'`);
      await c.page.goto(members(c.world.loopId));
      await openPicker(c, `Member type for ${priya(c).name}`);
    },
    act: (c) => option(c, "Member").click(),
    done: () => ({ selector: `.member-role-status [role="status"]`, text: "Member type updated." }),
  },
  {
    id: "people.remove.confirm",
    label: "Remove someone from the loop",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["F3"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(members(loop.id));
      const remove = row(c, loop.members[0].email).getByRole("button", { name: "Remove One" });
      await live(remove);
      await remove.click();
      await c.page.getByRole("button", { name: "Yes, remove One" }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Yes, remove One" }).click(),
    done: () => notice("They're out of the loop."),
  },
  {
    id: "people.transfer.open",
    label: "Open the question about handing the loop over",
    surface: "people", kind: "instant", viewer: "owner",
    flows: ["N3"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      await c.page.goto(members(c.world.loopId));
      await live(c.page.getByRole("button", { name: `Make ${c.world.admin.name} the owner` }));
    },
    act: (c) => c.page.getByRole("button", { name: `Make ${c.world.admin.name} the owner` }).click(),
    done: (c) => ({ selector: `form[role="group"][aria-labelledby^="transfer-"]`, text: `Yes, make ${c.world.admin.name} the owner` }),
  },
  {
    id: "people.transfer.confirm",
    label: "Hand a loop to an admin",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["N3"], routes: ["/g/[id]/members"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.world.query(`update memberships set access = 'admin' where id = '${loop.members[0].id}'`);
      await c.page.goto(members(loop.id));
      const make = c.page.getByRole("button", { name: "Make One the owner" });
      await live(make);
      await make.click();
      await c.page.getByRole("button", { name: "Yes, make One the owner" }).waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Yes, make One the owner" }).click(),
    done: () => ({ selector: `.notice[role="status"]`, path: "transferred=1" }),
  },
  {
    id: "people.photo.set",
    label: "Set your own photo on the people page",
    surface: "people", kind: "write", viewer: "owner",
    flows: ["N5"], routes: ["/g/[id]/members", "/api/loop/[id]/profile-photo"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(members(loop.id));
      await live(c.page.getByLabel("Choose a photo of yourself"));
    },
    act: (c) => c.page.getByLabel("Choose a photo of yourself").setInputFiles(AVATAR),
    done: () => ({ selector: `li.card p[aria-live="polite"]`, text: "Photo saved." }),
  },
];
