import { Suspense } from "react";
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { parseMemberFilter, deliveredRoundsAnsweredBy } from "@/lib/rounds-by-member";
import { viewerFor } from "@/lib/permissions";
import LoopLoading from "../loading";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.rounds };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string | string[] }>;
};

// The member filter is looked up on the server, so it streams in behind the loop's loading state.
export default function IssuesPage(props: Props) {
  return (
    <Suspense fallback={<LoopLoading />}>
      <Issues {...props} />
    </Suspense>
  );
}

async function Issues({ params, searchParams }: Props) {
  const [{ id }, { member }] = await Promise.all([params, searchParams]);

  // Which delivered rounds a chosen person answered in. The layout already turns
  // strangers away; this looks the viewer up again so the answer never depends on it.
  const wanted = parseMemberFilter(member);
  const viewer = wanted ? await viewerFor(id) : null;
  const answeredIn = wanted && viewer
    ? [...(await deliveredRoundsAnsweredBy({
        groupId: id,
        membershipId: wanted,
        includeAdminOnly: viewer.membership.access !== "member",
      }))]
    : null;

  return (
    <LoopTabContent
      tab="issues"
      filter={wanted && answeredIn ? { memberId: wanted, roundIds: answeredIn } : null}
    />
  );
}
