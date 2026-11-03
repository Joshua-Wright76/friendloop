import Link from "next/link";
import type { Metadata } from "next";
import { peekMagicLink } from "@/lib/auth";
import { ConfirmForm } from "./confirm-form";
import { Brand, Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";

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

  const failure = problem
    ? PROBLEMS[problem] ?? PROBLEMS.unknown
    : peek && peek.state !== "valid"
      ? PROBLEMS[peek.state]
      : null;

  return (
    <main className="mx-auto flex min-h-dvh w-fit max-w-full flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card w-fit min-w-[280px] max-w-full p-6 pt-8">
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
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink [overflow-wrap:anywhere]">
              {text(copy.confirm.title, { email: peek?.state === "valid" ? peek.email : copy.confirm.fallbackName })}
            </h1>
            <ConfirmForm token={token ?? ""} />
          </>
        )}
      </div>
    </main>
  );
}
