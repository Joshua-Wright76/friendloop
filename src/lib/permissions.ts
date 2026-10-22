import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { currentUser, type CurrentUser } from "./auth";

export type Access = "owner" | "admin" | "member";

export type Viewer = {
  user: CurrentUser;
  membership: typeof memberships.$inferSelect;
};

const RANK: Record<Access, number> = { owner: 3, admin: 2, member: 1 };

export function atLeast(access: Access, required: Access): boolean {
  return RANK[access] >= RANK[required];
}

/** The signed-in person's membership in one loop, or null. */
export async function viewerFor(groupId: string): Promise<Viewer | null> {
  const user = await currentUser();
  if (!user) return null;

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.userId, user.id),
        isNull(memberships.revokedAt),
      ),
    )
    .limit(1);

  return membership ? { user, membership } : null;
}

/** Throws a 404 for outsiders, so a loop they cannot see is a loop that isn't there. */
export async function requireViewer(groupId: string, required: Access = "member"): Promise<Viewer> {
  const viewer = await viewerFor(groupId);
  if (!viewer || !atLeast(viewer.membership.access, required)) {
    throw new Error("not-found");
  }
  return viewer;
}
