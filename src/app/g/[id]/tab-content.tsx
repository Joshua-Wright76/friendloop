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
  added?: string;
  archived?: string;
  opened?: string;
  saved?: string;
  error?: string;
};

type Props =
  | { tab: "overview"; welcome?: string }
  | { tab: "members"; notices: Pick<Notices, "invited" | "resent" | "removed" | "transferred"> }
  | { tab: "questions"; notices: Pick<Notices, "added" | "archived"> }
  | { tab: "issues"; notices: Pick<Notices, "opened"> }
  | { tab: "settings"; notices: Pick<Notices, "saved" | "error"> };

export function LoopTabContent(props: Props) {
  switch (props.tab) {
    case "overview":
      return <OverviewTab welcome={props.welcome} />;
    case "members":
      return <MembersTab notices={props.notices} />;
    case "questions":
      return <QuestionsTab notices={props.notices} />;
    case "issues":
      return <IssuesTab notices={props.notices} />;
    case "settings":
      return <SettingsTab notices={props.notices} />;
  }
}
