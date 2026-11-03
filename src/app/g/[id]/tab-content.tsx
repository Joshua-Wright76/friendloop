"use client";

import OverviewTab from "./overview-tab";
import MembersTab from "./members/members-tab";
import QuestionsTab from "./questions/questions-tab";
import IssuesTab from "./issues/issues-tab";
import SettingsTab from "./settings/settings-tab";

type Notices = {
  invited?: string;
  resent?: string;
  removed?: string;
  transferred?: string;
  transferError?: string;
  added?: string;
  archived?: string;
  suggestion?: string;
  section?: string;
  poll?: string;
  event?: string;
  skip?: string;
  opened?: string;
  alreadyOpen?: string;
  named?: string;
  saved?: string;
  error?: string;
  shares?: string;
  stationery?: string;
};

type Props =
  | { tab: "overview"; welcome?: string; nudged?: string }
  | { tab: "members"; notices: Pick<Notices, "invited" | "resent" | "removed" | "transferred" | "transferError"> }
  | { tab: "questions"; notices: Pick<Notices, "added" | "archived" | "skip" | "suggestion" | "section" | "poll" | "event"> }
  | { tab: "issues"; notices: Pick<Notices, "opened" | "alreadyOpen" | "named">; filter?: { memberId: string; roundIds: string[] } | null }
  | { tab: "settings"; notices: Pick<Notices, "saved" | "error" | "shares" | "stationery"> };

export function LoopTabContent(props: Props) {
  switch (props.tab) {
    case "overview":
      return <OverviewTab welcome={props.welcome} nudged={props.nudged} />;
    case "members":
      return <MembersTab notices={props.notices} />;
    case "questions":
      return <QuestionsTab notices={props.notices} />;
    case "issues":
      return <IssuesTab notices={props.notices} filter={props.filter ?? null} />;
    case "settings":
      return <SettingsTab notices={props.notices} />;
  }
}
