import { copy } from "@/lib/copy";
import type { LoopQuestion } from "../loop-data";

/** A poll in the pool shows what it offers in one line, so the owner can tell it from a written question. */
export function PollSummary({ question }: { question: Pick<LoopQuestion, "kind" | "pollMultiple" | "pollOptions"> }) {
  if (question.kind !== "poll") return null;
  return (
    <p className="poll-line">
      <span className="font-bold text-accent-ink">{question.pollMultiple ? copy.polls.badge.multiple : copy.polls.badge.single}:</span>{" "}
      {(question.pollOptions ?? []).join(", ")}
    </p>
  );
}
