"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import type { groups, issues, memberships, questions } from "@/db/schema";
import type { Deadline } from "@/lib/schedule";

type Group = typeof groups.$inferSelect;
type Membership = Pick<typeof memberships.$inferSelect,
  "id" | "groupId" | "userId" | "email" | "name" | "photoUrl" | "charm" | "avatarFrame" | "access" | "participation" | "invitedAt" | "acceptedAt"
>;

export type LoopPerson = Pick<Membership,
  "id" | "email" | "name" | "photoUrl" | "charm" | "avatarFrame" | "access" | "participation" | "invitedAt" | "acceptedAt" | "userId"
> & {
  /** They turned off this loop's emails; they stay in the loop. */
  mutedAt: Date | null;
  /** The provider reported this address as bouncing or a spam complaint. */
  suppression: "bounce" | "complaint" | null;
};

export type LoopQuestion = Pick<typeof questions.$inferSelect,
  "id" | "text" | "active" | "skipNext" | "position" | "kind" | "pollMultiple" | "pollOptions"
>;

export type LoopSection = {
  id: string;
  kind: "standard" | "photo_wall" | "music";
  title: string;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  active: boolean;
  position: number;
};

export type LoopEvent = import("@/lib/events").EventListItem;

export type LoopSuggestion = {
  id: string;
  text: string;
  authorDisplay: "name" | "anonymous";
  authorName: string | null;
  authorEmail: string;
};

export type LoopRound = Pick<typeof issues.$inferSelect,
  "id" | "number" | "name" | "status" | "opensAt" | "deliversAt" | "deliveredAt" | "shareToken"
> & { answers: number; shareUrl: string | null };

export type LoopData = {
  group: Group;
  membership: Membership;
  user: CurrentUser;
  people: LoopPerson[];
  questions: LoopQuestion[];
  sections: LoopSection[];
  events: LoopEvent[];
  suggestions: LoopSuggestion[];
  rounds: LoopRound[];
  openIssue: LoopRound | null;
  openProgress: Array<Pick<Membership, "id" | "name" | "email">>;
  openWaiting: LoopPerson[];
  nextRoundLabel: Deadline;
  openIssueDeadlineLabel: string | null;
  nextMoment: { primary: string; loop: string | null };
  openMoment: { primary: string; loop: string | null } | null;
  nextWhenThisCloses: boolean;
  lastNudge: string | null;
  weekdayLabel: string;
};

const LoopDataContext = createContext<LoopData | null>(null);

export function LoopDataProvider({ data, children }: { data: LoopData; children: ReactNode }) {
  return <LoopDataContext.Provider value={data}>{children}</LoopDataContext.Provider>;
}

export function useLoopData(): LoopData {
  const data = useContext(LoopDataContext);
  if (!data) throw new Error("Loop data is unavailable outside its route layout.");
  return data;
}
