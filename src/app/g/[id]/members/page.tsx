import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { membersOf } from "@/lib/manage";
import { viewerFor } from "@/lib/permissions";
import {
  accessAction,
  inviteAction,
  participationAction,
  removeAction,
  resendAction,
  transferAction,
} from "./actions";

export const instant = false;

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

  const viewer = await viewerFor(id);
  if (!viewer) notFound();
  const manages = viewer.membership.access !== "member";
  const isOwner = viewer.membership.access === "owner";

  const [group] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!group) notFound();

  const people = await membersOf(id);
  const fromYou = group.mode === "from_you";

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">People</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {fromYou
          ? "In this loop you write and everyone else reads."
          : "Writers get the questions. Readers just get the issue."}
      </p>

      {notices.invited ? <Notice>Invitations sent.</Notice> : null}
      {notices.resent ? <Notice>Invitation sent again.</Notice> : null}
      {notices.removed ? <Notice>They&apos;re out of the loop.</Notice> : null}
      {notices.transferred ? <Notice>You&apos;re now an admin — the loop has a new owner.</Notice> : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {people.map((person) => {
          const isYou = person.id === viewer.membership.id;
          return (
            <div key={person.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">
                    {person.name ?? person.email.split("@")[0]}
                    {isYou ? <span className="ml-1.5 text-[13px] text-ink-muted">you</span> : null}
                  </p>
                  <p className="truncate text-[13px] text-ink-muted">{person.email}</p>
                </div>
                <span className="flex-none rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                  {person.access}
                </span>
              </div>

              <p className="mt-2 text-[13px] text-ink-soft">
                {person.participation === "contributor" ? "Writes" : "Reads"}
                {!person.acceptedAt ? " · invite not opened yet" : ""}
              </p>

              {manages && person.access !== "owner" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!fromYou ? (
                    <form action={participationAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <input
                        type="hidden"
                        name="participation"
                        value={person.participation === "contributor" ? "reader" : "contributor"}
                      />
                      <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px]">
                        {person.participation === "contributor" ? "Make a reader" : "Make a writer"}
                      </button>
                    </form>
                  ) : null}

                  <form action={accessAction}>
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="membershipId" value={person.id} />
                    <input type="hidden" name="access" value={person.access === "admin" ? "member" : "admin"} />
                    <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px]">
                      {person.access === "admin" ? "Remove admin" : "Make an admin"}
                    </button>
                  </form>

                  {!person.acceptedAt ? (
                    <form action={resendAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px]">
                        Resend invite
                      </button>
                    </form>
                  ) : null}

                  {isOwner ? (
                    <form action={transferAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px]">
                        Make owner
                      </button>
                    </form>
                  ) : null}

                  <form action={removeAction}>
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="membershipId" value={person.id} />
                    <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px] text-danger">
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {manages ? (
        <form action={inviteAction} className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Invite people</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            One address per line. They get a link — no account needed.
          </p>
          <textarea
            name="emails"
            required
            rows={3}
            placeholder="alice@example.com&#10;bob@example.com"
            aria-label="Email addresses"
            className="field mt-3"
          />
          {!fromYou ? (
            <label className="mt-3 flex items-center gap-2 text-[14px] text-ink-soft">
              <input type="checkbox" name="participation" value="reader" className="accent-[var(--accent)]" />
              Invite them as readers
            </label>
          ) : null}
          <button type="submit" className="btn btn-primary mt-4">
            Send invitations
          </button>
        </form>
      ) : null}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="settle mt-4 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[14px] leading-relaxed text-accent-ink">
      {children}
    </div>
  );
}
