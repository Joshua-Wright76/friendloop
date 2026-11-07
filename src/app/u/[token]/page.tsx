import Link from "next/link";
import type { Metadata } from "next";
import { LoopTheme } from "@/components/loop-theme";
import { copy, text } from "@/lib/copy";
import { resolveUnsubscribe } from "@/lib/unsubscribe";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// The token is a (narrow) credential: keep it out of indexes and Referer headers.
export const metadata: Metadata = {
  title: copy.unsubscribe.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Where "Stop emails from this loop" lands. Mail scanners open every link, so
 * this page only ever asks: the mute (and the unmute) is a button that POSTs.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await resolveUnsubscribe(token);
  const labels = copy.unsubscribe;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      {context.state === "ok" ? (
        <LoopTheme group={context.group} />
      ) : null}
      <div className="card p-6">
        {context.state === "invalid" ? (
          <>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{labels.invalidTitle}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{labels.invalidBody}</p>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {text(context.muted ? labels.mutedTitle : labels.title, { groupName: context.groupName })}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
              {context.muted ? labels.mutedBody : labels.body}
            </p>
            <form method="post" action={`/api/unsubscribe/${token}`} className="mt-5">
              <input type="hidden" name="action" value={context.muted ? "unmute" : "mute"} />
              <button type="submit" className="btn btn-primary">
                {context.muted ? labels.unmute : labels.confirm}
              </button>
            </form>
          </>
        )}
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
}
