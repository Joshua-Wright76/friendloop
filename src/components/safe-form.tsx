"use client";

import { createContext, useContext, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { copy } from "@/lib/copy";

/** Lets a SubmitButton inside know this form is busy. */
export const SafeFormContext = createContext(false);
export function useSafeFormPending() {
  return useContext(SafeFormContext);
}

/** A redirect or similar from the framework is how an action finishes, not a failure. */
export function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/**
 * A form that survives a dropped connection. Failure stays with the form, in plain
 * words, with everything typed still in place, instead of replacing the page with
 * the error screen. The action prop is still on the form, so without script it posts
 * as usual.
 */
export function SafeForm({
  action,
  validate,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (formData: FormData) => void | Promise<void>;
  /** Return false to stop here; say why beside the field. */
  validate?: (form: HTMLFormElement) => boolean;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <form
      {...props}
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        if (validate && !validate(form)) return;
        const data = new FormData(form);
        setFailed(false);
        start(async () => {
          try {
            await action(data);
          } catch (error) {
            if (isFrameworkSignal(error)) throw error;
            setFailed(true);
          }
        });
      }}
    >
      <SafeFormContext.Provider value={pending}>
        {children}
      </SafeFormContext.Provider>
      {failed ? <p role="alert" className="action-failed">{copy.common.actionFailed}</p> : null}
    </form>
  );
}
