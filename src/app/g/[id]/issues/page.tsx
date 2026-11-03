import { LoopTabContent } from "../tab-content";
import { copy } from "@/lib/copy";
import type { Metadata } from "next";
import { parseMemberFilter, deliveredRoundsAnsweredBy } from "@/lib/rounds-by-member";
import { viewerFor } from "@/lib/permissions";

export const metadata: Metadata = { title: copy.pageTitles.rounds };

export default async function IssuesPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opened?: string; alreadyOpen?: string; named?: string; member?: string | string[] }>;
}) {
  const [{ id }, { member, ...notices }] = await Promise.all([params, searchParams]);

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
      notices={notices}
      filter={wanted && answeredIn ? { memberId: wanted, roundIds: answeredIn } : null}
    />
  );
}
