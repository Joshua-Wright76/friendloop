import Link from "next/link";
import { copy } from "@/lib/copy";

/** Shown when an owner came here from "Delete my account" to hand over or delete this loop first. */
export function ThenBanner({ then }: { then?: string }) {
  if (then !== "delete-account") return null;
  return (
    <p className="notice mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed text-ink">
      {copy.account.thenBanner}{" "}
      <Link href="/you/delete" className="link link--inline whitespace-nowrap">{copy.account.thenBack}</Link>
    </p>
  );
}
