import Link from "next/link";
import { notFound } from "next/navigation";
import { loadIssue } from "@/lib/issue-view";
import { IssueBody } from "../../i/[id]/issue-body";
import { Cherries } from "@/components/stationery";

export const instant = false;

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadIssue({ shareToken: token, viewerMembershipId: null });
  if (!view) notFound();

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{view.group.name}</span>
        </span>
        <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold text-ink-soft numeric">Round {view.issue.number}</span>
      </header>

      <div className="relative pr-16">
        <Cherries className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
        <p className="eyebrow">Fresh from the loop</p>
        <h1 className="mt-1 text-ink">Round {view.issue.number}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          {view.answerCount} {view.answerCount === 1 ? "answer" : "answers"} from the group.
        </p>
      </div>

      <IssueBody
        issueId={view.issue.id}
        viewerToken={null}
        canInteract={false}
        blocks={view.blocks}
        comments={[]}
      />

      <p className="mt-8 text-center text-[13px] text-ink-muted">
        Shared from{" "}
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          Friendloop
        </Link>
      </p>
    </main>
  );
}
