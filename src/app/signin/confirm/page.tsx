import Link from "next/link";
import { peekMagicLink } from "@/lib/auth";
import { confirmLink } from "./actions";

export const instant = false;

const PROBLEMS: Record<string, { title: string; body: string }> = {
  expired: {
    title: "That link has expired",
    body: "Sign-in links last 15 minutes. Ask for a fresh one and it'll work.",
  },
  used: {
    title: "That link was already used",
    body: "Each link signs you in once. Ask for a new one to get back in.",
  },
  unknown: {
    title: "That link isn't valid",
    body: "It may have been truncated by your email client. Ask for a new one.",
  },
};

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
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 self-start text-[15px] font-semibold tracking-[-0.01em] text-ink"
      >
        <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-[13px] font-bold text-white">
          f
        </span>
        Friendloop
      </Link>

      <div className="card p-6">
        {failure ? (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {failure.title}
            </h1>
            <p className="mb-5 mt-2 text-[15px] leading-relaxed text-ink-soft">{failure.body}</p>
            <Link href="/signin" className="btn btn-primary w-full">
              Send me a new link
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              Sign in as {peek?.state === "valid" ? peek.email : "yourself"}
            </h1>
            <p className="mb-5 mt-2 text-[15px] leading-relaxed text-ink-soft">
              One tap and you&apos;re in.
            </p>
            <form action={confirmLink}>
              <input type="hidden" name="token" value={token ?? ""} />
              <button type="submit" className="btn btn-primary w-full">
                Yes, sign me in
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
