import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { membersOf } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";
import { removeAction, resendAction } from "./actions";
import { MemberRolePicker } from "./member-role-picker";
import { InviteForm } from "./invite-form";
import { LoopNav } from "@/components/loop-nav";
import { copy } from "@/lib/copy";

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invited?: string; resent?: string; removed?: string; transferred?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const notices = await searchParams;

  const viewer = await viewerFor(id, user);
  if (!viewer) notFound();
  const manages = viewer.membership.access !== "member";
  const isOwner = viewer.membership.access === "owner";

  const [[group], people] = await Promise.all([
    db.select().from(groups).where(eq(groups.id, id)).limit(1),
    membersOf(id),
  ]);
  if (!group) notFound();

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>
      <LoopNav id={id} active="People" isOwner={isOwner} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.members.title}</h1>

      {notices.invited ? <Notice>{copy.members.invitedNotice}</Notice> : null}
      {notices.resent ? <Notice>{copy.members.resentNotice}</Notice> : null}
      {notices.removed ? <Notice>{copy.members.removedNotice}</Notice> : null}
      {notices.transferred ? <Notice>{copy.members.transferredNotice}</Notice> : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {people.map((person) => {
          const isYou = person.id === viewer.membership.id;
          return (
            <div key={person.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">
                    {person.name ?? person.email.split("@")[0]}
                    {isYou ? <span className="ml-1.5 text-[13px] text-ink-muted">{copy.members.you}</span> : null}
                  </p>
                  <p className="truncate text-[13px] text-ink-muted">{person.email}</p>
                </div>
                {manages && person.access !== "owner" ? (
                  <MemberRolePicker
                    groupId={id}
                    membershipId={person.id}
                    memberName={person.name ?? person.email}
                    current={person.access}
                    canAssignOwner={isOwner}
                  />
                ) : (
                  <span className="flex-none rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                    {copy.common.roles[person.access]}
                  </span>
                )}
              </div>

              {!person.acceptedAt ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                  <span>{copy.members.invitePending}</span>
                  {manages ? (
                    <form action={resendAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <button type="submit" className="inline-flex min-h-6 items-center px-1 text-[13px] font-medium text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink">
                        {copy.members.resendInvite}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {manages && person.access !== "owner" ? (
                <form action={removeAction} className="mt-3 flex justify-end">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="membershipId" value={person.id} />
                  <button type="submit" className="btn btn-danger h-9 min-h-9 px-3 text-[13px]">
                    {copy.members.remove}
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>

      {manages ? (
        <InviteForm groupId={id} />
      ) : null}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="notice settle mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
      {children}
    </div>
  );
}
