"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import type { groups, issues, memberships } from "@/db/schema";
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

export type { PageItem, QuestionsPage, RoundItem } from "@/lib/questions-page";

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
  /** The Questions page: this round, Up next and what was stopped (docs/questions-unify-design.md). */
  questionsPage: import("@/lib/questions-page").QuestionsPage;
  suggestions: LoopSuggestion[];
  rounds: LoopRound[];
  openIssue: LoopRound | null;
  openProgress: Array<Pick<Membership, "id" | "name" | "email">>;
  openWaiting: LoopPerson[];
  nextRoundLabel: Deadline;
  openIssueDeadlineLabel: string | null;
  /** The delivery after the open round's, for "Send now" to say when the next one goes out. */
  nextMoment: { primary: string; loop: string | null };
  openMoment: { primary: string; loop: string | null } | null;
  lastNudge: string | null;
  weekdayLabel: string;
  /** Membership id to the ids of the delivered rounds they answered in. */
  roundsAnsweredBy: Record<string, string[]>;
  /** The viewer's own answer page while a round takes their answers; null for readers and paused loops. */
  answerHref: string | null;
  /** This loop's emails waiting on the day's email budget. Only counted for owners and admins. */
  heldEmails: number;
  /** The loop's shareable invite link. Only for owners and admins; null for everyone else. */
  inviteUrl: string | null;
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
