import type { Metadata } from "next";
import { LoopPageHeader, LoopTheme } from "@/components/loop-theme";
import { Tape } from "@/components/stationery";
import { DeadLinkPage } from "@/components/dead-link";
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
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ back?: string | string[] }> }) {
  const { token } = await params;
  const { back } = await searchParams;
  const context = await resolveUnsubscribe(token);
  const labels = copy.unsubscribe;

  if (context.state === "invalid") {
    return <DeadLinkPage title={labels.invalidTitle} body={labels.invalidBody} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <LoopTheme group={context.group} />
      <LoopPageHeader name={context.groupName} imageUrl={context.group.headerImageUrl} />
      <div className="card p-6 pt-8">
        <Tape tone="dots" position="left" />
        {context.muted === false && back === "on" ? (
          <p role="status" className="mb-4 rounded-lg border border-line bg-accent-soft px-3 py-2 text-[15px] font-bold leading-snug text-accent-ink">
            {text(labels.backOn, { groupName: context.groupName })}
          </p>
        ) : null}
        <h1 className="wrap-any text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
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
      </div>
    </main>
  );
}
