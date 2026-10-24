import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, memberships } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { Brand, Cherries, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";
import { signOutAction } from "./actions";

export const instant = false;

export default async function YouPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const loops = await db
    .select({ id: groups.id, name: groups.name, access: memberships.access, participation: memberships.participation })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.userId, user.id), isNull(memberships.revokedAt)));

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-10 flex items-start justify-between gap-3">
        <Brand href={null} />
        <div className="flex max-w-[58%] flex-col items-end gap-2">
          <form action={signOutAction}>
            <button type="submit" className="btn btn-quiet h-10 min-h-10 px-4 text-[13px]">{copy.common.signOut}</button>
          </form>
          <p className="m-0 text-right text-[13px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{user.email}</p>
        </div>
      </header>

      <div className="flex items-end justify-between gap-4">
        <h1 className="text-ink">{copy.you.title}</h1>
        <Link href="/g/new" className="btn btn-primary">{copy.you.newLoop}</Link>
      </div>
      {loops.length === 0 ? (
        <div className="card mt-8 p-6 pt-8">
          <Tape tone="mint" />
          <h2 className="text-ink">{copy.you.emptyTitle}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            {copy.you.emptyBody}
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {loops.map((loop, index) => (
            <Link key={loop.id} href={`/g/${loop.id}`} className="card loop-card flex min-h-[190px] flex-col p-5 pt-6 no-underline">
              {index === 0 ? <Tape tone="dots" position="right" /> : null}
              <span className="flex items-center gap-2">
                <Cherries className="h-7 w-7 flex-none" />
                <span className="font-display text-[27px] font-bold leading-none text-ink">{loop.name}</span>
              </span>
              <span className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-line-strong bg-page px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">
                  {copy.common.roles[loop.access]}
                </span>
                <span className="rounded-full border border-line-strong bg-page px-2.5 py-1 text-[12px] font-bold text-ink-soft">
                  {copy.common.participation[loop.participation]}
                </span>
              </span>
              <span className="mt-auto flex items-center justify-between pt-6 text-[14px] font-extrabold text-ink-soft">
                {copy.you.openLoop} <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-8 border-t border-dashed border-line-strong pt-5 text-[13px] leading-relaxed text-ink-muted">
        {copy.you.footer}
      </p>
    </main>
  );
}
