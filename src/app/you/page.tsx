import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, memberships } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { signOutAction } from "./actions";

export const instant = false;

export default async function YouPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const loops = await db
    .select({
      id: groups.id,
      name: groups.name,
      access: memberships.access,
      participation: memberships.participation,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.userId, user.id), isNull(memberships.revokedAt)));

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">
          <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-[13px] font-bold text-white">
            f
          </span>
          Friendloop
        </span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-[13px] font-medium text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Your loops
        </h1>
        <Link href="/g/new" className="btn btn-primary h-10 px-4 text-[14px]">
          New loop
        </Link>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        Signed in as {user.email}
      </p>

      {loops.length === 0 ? (
        <div className="card mt-6 p-6">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            No loops yet. Start one, or wait for an invite — you never need this page to answer.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          {loops.map((loop) => (
            <Link
              key={loop.id}
              href={`/g/${loop.id}`}
              className="card flex items-center justify-between gap-4 px-5 py-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-medium leading-snug text-ink">
                  {loop.name}
                </span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  {loop.access === "owner" ? "Owner" : loop.access === "admin" ? "Admin" : "Member"}
                  {" · "}
                  {loop.participation === "contributor" ? "writes" : "reads"}
                </span>
              </span>
              <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 flex-none fill-ink-muted">
                <path d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 11-1.4-1.4L11.6 10 7.3 5.7a1 1 0 010-1.4z" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-6 px-1 text-[13px] leading-relaxed text-ink-muted">
        Reading is open to everyone in a loop. Writing needs an invite.
      </p>
    </main>
  );
}
