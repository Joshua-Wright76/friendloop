import { copy } from "@/lib/copy";

/** The visible name of a field, with a "(required)" marker when it must be filled. */
export function FieldLabel({ children, required = false, className = "" }: { children: React.ReactNode; required?: boolean; className?: string }) {
  return (
    <span className={`text-[13px] font-medium text-ink-soft ${className}`}>
      {children}
      {required ? <> {copy.a11yLabels.required}</> : null}
    </span>
  );
}
