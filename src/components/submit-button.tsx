"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { useSafeFormPending } from "./safe-form";

type Props = Omit<ComponentProps<"button">, "type"> & {
  /** Optional label while the form is sending. Keep it close in length to the idle label. */
  pendingLabel?: string;
  /** Not ready yet (e.g. nothing picked): stays focusable and announces it does nothing. */
  blocked?: boolean;
};

/**
 * The submit button for a Server Action form. While the action is in flight a
 * second tap does nothing, so a slow phone cannot send the form twice, and the
 * button says it is busy. aria-disabled, not disabled, as everywhere else: the
 * button the keyboard is on must not vanish mid-request.
 */
export function SubmitButton({ children, pendingLabel, blocked = false, onClick, ...props }: Props) {
  const { pending: posting } = useFormStatus();
  const safePending = useSafeFormPending();
  const pending = posting || safePending;
  const inert = blocked || pending;
  return (
    <button
      {...props}
      type="submit"
      aria-disabled={inert ? true : undefined}
      aria-busy={pending ? true : undefined}
      onClick={(event) => {
        if (inert) event.preventDefault();
        else onClick?.(event);
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
