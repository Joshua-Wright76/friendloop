"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import type { groups, issues, memberships, questions } from "@/db/schema";
import type { Deadline } from "@/lib/schedule";

type Group = typeof groups.$inferSelect;
type Membership = Pick<typeof memberships.$inferSelect,
  "id" | "groupId" | "userId" | "email" | "name" | "access" | "participation" | "invitedAt" | "acceptedAt"
>;

export type LoopPerson = Pick<Membership,
  "id" | "email" | "name" | "access" | "participation" | "invitedAt" | "acceptedAt" | "userId"
>;

export type LoopQuestion = Pick<typeof questions.$inferSelect,
  "id" | "text" | "kind" | "active" | "skipNext" | "position"
>;

export type LoopRound = Pick<typeof issues.$inferSelect,
  "id" | "number" | "status" | "opensAt" | "deliversAt" | "shareToken"
> & { answers: number; shareUrl: string | null };

export type LoopData = {
  group: Group;
  membership: Membership;
  user: CurrentUser;
  people: LoopPerson[];
  questions: LoopQuestion[];
  rounds: LoopRound[];
  openIssue: LoopRound | null;
  openProgress: Array<Pick<Membership, "id" | "name" | "email">>;
  nextRoundLabel: Deadline;
  openIssueDeadlineLabel: string | null;
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
