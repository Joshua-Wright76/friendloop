import Link from "next/link";
import { notFound } from "next/navigation";
import { loadIssue } from "@/lib/issue-view";
import { IssueBody } from "../../i/[id]/issue-body";

export const instant = false;

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadIssue({ shareToken: token, viewerMembershipId: null });
  if (!view) notFound();

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <header className="mb-5 flex items-center justify-between gap-3">
        <span className="truncate text-[14px] font-medium text-ink-soft">{view.group.name}</span>
        <span className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-ink-soft numeric">
          Round {view.issue.number}
        </span>
      </header>

      <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
        Round {view.issue.number}
      </h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {view.answerCount} {view.answerCount === 1 ? "answer" : "answers"} from the group.
      </p>

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
