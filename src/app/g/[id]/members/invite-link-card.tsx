"use client";

import { CopyLink } from "@/components/copy-link";
import { ConfirmAction } from "@/components/confirm-action";
import { copy } from "@/lib/copy";
import { resetInviteLinkAction } from "./actions";

/**
 * The first way in: one link for the group chat, because nobody knows everyone's
 * email. Whoever opens it joins with their own address, once they confirm it.
 */
export function InviteLinkCard({ groupId, url }: { groupId: string; url: string }) {
  const labels = copy.members.inviteLink;
  return (
    <section id="invite-link" aria-labelledby="invite-link-title" className="mt-3 scroll-mt-4 border-t border-dashed border-line pt-3">
      <h2 id="invite-link-title" className="text-[14px] font-bold text-ink-soft">{labels.title}</h2>
      <p id="invite-link-hint" className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{labels.hint}</p>
      <div className="invite-line mt-1.5">
        <input
          readOnly
          value={url}
          aria-label={labels.fieldLabel}
          aria-describedby="invite-link-hint"
          // One tap selects the whole link, for anyone who'd rather copy it by hand.
          onFocus={(event) => event.currentTarget.select()}
          className="field h-11 min-w-0 flex-1 py-0 text-[14px] text-ink-soft"
        />
        <CopyLink url={url} label={labels.copy} primary />
      </div>
      <ConfirmAction
        className="mt-1"
        action={resetInviteLinkAction}
        fields={{ groupId }}
        label={labels.reset}
        triggerLabel={labels.reset}
        question={labels.resetQuestion}
        body={labels.resetBody}
        confirmLabel={labels.resetConfirm}
        cancelLabel={labels.resetCancel}
        tone="primary"
        triggerTone="quiet"
      />
    </section>
  );
}
