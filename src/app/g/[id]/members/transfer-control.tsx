"use client";

import { SafeForm, useSafeFormPending } from "@/components/safe-form";
import { useEffect, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";
import { transferAction } from "./actions";

type Props = { groupId: string; groupName: string; membershipId: string; name: string };

function Confirm({ name }: { name: string }) {
  const pending = useSafeFormPending();
  return (
    <button
      type="submit"
      aria-disabled={pending ? true : undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className="btn btn-primary h-11 min-h-11 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
    >
      {pending ? copy.members.transferPending : text(copy.members.transferConfirm, { name })}
    </button>
  );
}

/**
 * Hand the loop to this admin. Two steps on purpose: the first button only opens
 * the question, and the question names the person and says what you give up.
 */
export function TransferControl({ groupId, groupName, membershipId, name }: Props) {
  const [asking, setAsking] = useState(false);
  const title = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);

  // The question takes focus when it opens; changing your mind hands it back to the button that opened it.
  useEffect(() => {
    if (asking) title.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  function cancel() {
    cancelled.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      <button
        ref={trigger}
        type="button"
        onClick={() => setAsking(true)}
        className="btn btn-quiet min-h-11 px-4 text-[13px]"
      >
        {text(copy.members.transferAction, { name })}
      </button>
    );
  }

  return (
    <SafeForm
      action={transferAction}
      role="group"
      aria-labelledby={`transfer-${membershipId}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      className="notice mt-1 w-full border bg-accent-soft px-4 py-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="confirm" value="yes" />
      <p id={`transfer-${membershipId}`} ref={title} tabIndex={-1} className="text-[15px] font-bold text-ink outline-none">
        {text(copy.members.transferTitle, { groupName, name })}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{text(copy.members.transferBody, { name })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Confirm name={name} />
        <button type="button" onClick={cancel} className="btn btn-quiet h-11 min-h-11 text-[14px]">
          {copy.members.transferCancel}
        </button>
      </div>
    </SafeForm>
  );
}
