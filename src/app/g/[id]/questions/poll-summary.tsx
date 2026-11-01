import { copy } from "@/lib/copy";
import type { LoopQuestion } from "../loop-data";

/** A poll in the pool shows what it offers, so the owner can tell it from a written question. */
export function PollSummary({ question }: { question: Pick<LoopQuestion, "kind" | "pollMultiple" | "pollOptions"> }) {
  if (question.kind !== "poll") return null;
  return (
    <>
      <p className="mt-1 text-[12px] font-bold text-accent-ink">
        {question.pollMultiple ? copy.polls.badge.multiple : copy.polls.badge.single}
      </p>
      <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed text-ink-soft">
        {(question.pollOptions ?? []).map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
    </>
  );
}
