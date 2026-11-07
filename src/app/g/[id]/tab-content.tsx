"use client";

import { useSearchParams } from "next/navigation";
import OverviewTab from "./overview-tab";
import MembersTab from "./members/members-tab";
import QuestionsTab from "./questions/questions-tab";
import IssuesTab from "./issues/issues-tab";
import SettingsTab from "./settings/settings-tab";
import { useLoopData } from "./loop-data";
import { parseMemberFilter } from "@/lib/member-filter";

type Props = { tab: "overview" | "members" | "questions" | "issues" | "settings" };

/**
 * The notices a tab shows come from the URL. Reading them here, on the client,
 * means a tab switch never waits on the server for them: the router already has
 * the query string. Pages wrap this in Suspense for the first, server-rendered load.
 */
export function LoopTabContent(props: Props) {
  const params = useSearchParams();
  const { roundsAnsweredBy } = useLoopData();
  const read = <K extends string>(...keys: K[]) =>
    Object.fromEntries(keys.flatMap((key) => {
      const value = params.get(key);
      return value === null ? [] : [[key, value]];
    })) as Partial<Record<K, string>>;

  switch (props.tab) {
    case "overview": {
      const { welcome, nudged } = read("welcome", "nudged");
      return <OverviewTab welcome={welcome} nudged={nudged} />;
    }
    case "members":
      return <MembersTab notices={read("limited", "addressChanged", "invited", "resent", "removed", "transferred", "transferError")} />;
    case "questions":
      return <QuestionsTab notices={read("added", "archived", "skip", "rotation", "fromPacks", "suggestion", "section", "poll", "event")} />;
    case "issues": {
      const member = parseMemberFilter(params.get("member"));
      const filter = member ? { memberId: member, roundIds: roundsAnsweredBy[member] ?? [] } : null;
      return <IssuesTab notices={read("opened", "alreadyOpen", "named")} filter={filter} />;
    }
    case "settings":
      return <SettingsTab notices={read("saved", "error", "shares", "stationery")} />;
  }
}
