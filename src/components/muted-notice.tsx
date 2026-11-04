import { copy } from "@/lib/copy";

/**
 * Shown to a member who turned off this loop's emails, wherever their reply link
 * lands them. A plain form: it works before (and without) JavaScript, and posts
 * to the same endpoint the unsubscribe page uses, then comes back here.
 */
export function MutedNotice({ unsubscribeToken, back }: { unsubscribeToken: string; back: string }) {
  return (
    <section className="card mt-6 p-4" data-muted-notice>
      <p className="text-[14px] leading-relaxed text-ink-soft">{copy.unsubscribe.notice}</p>
      <form method="post" action={`/api/unsubscribe/${unsubscribeToken}`} className="mt-3">
        <input type="hidden" name="action" value="unmute" />
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="btn btn-primary h-10 min-h-10 px-4 text-[14px]">
          {copy.unsubscribe.unmute}
        </button>
      </form>
    </section>
  );
}
