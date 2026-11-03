import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { peekMagicLink } from "@/lib/auth";
import { ConfirmForm } from "./confirm-form";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.confirm,
  robots: { index: false, follow: false },
};

const PROBLEMS: Record<string, { title: string; body: string }> = copy.confirm.problems;

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; problem?: string }>;
}) {
  const { token, problem } = await searchParams;
  const peek = token ? await peekMagicLink(token) : null;

  // Someone who has signed in before already told us their name; offer it back
  // rather than an empty box. Only for a live link, which proves the address.
  const knownName = peek?.state === "valid"
    ? (await db.select({ name: users.name }).from(users).where(eq(users.email, peek.email)).limit(1))[0]?.name ?? null
    : null;

  const failure = problem
    ? PROBLEMS[problem] ?? PROBLEMS.unknown
    : peek && peek.state !== "valid"
      ? PROBLEMS[peek.state]
      : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="center" />
        {failure ? (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {failure.title}
            </h1>
            <p className="mb-5 mt-2 text-[15px] leading-relaxed text-ink-soft">{failure.body}</p>
            <Link href="/signin" className="btn btn-primary w-full">
              {copy.confirm.newLink}
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {copy.confirm.title}
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
              {copy.confirm.signingInAs}{" "}
              <strong className="block font-extrabold text-ink [overflow-wrap:anywhere]">
                {peek?.state === "valid" ? peek.email : copy.confirm.fallbackName}
              </strong>
            </p>
            <ConfirmForm token={token ?? ""} name={knownName} />
          </>
        )}
      </div>
    </main>
  );
}
