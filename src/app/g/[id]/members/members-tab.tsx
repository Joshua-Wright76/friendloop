"use client";

import { InvitePanel } from "./invite-panel";
import { PersonRow } from "./person-row";
import { LoopNav } from "@/components/loop-nav";
import { NoticeFocus } from "@/components/notice-focus";
import { copy } from "@/lib/copy";
import { useLoopData } from "../loop-data";
import { ThenBanner } from "../then-banner";

export default function MembersTab({ notices }: {
  notices: { invited?: string; resent?: string; removed?: string; transferred?: string; transferError?: string; limited?: string; addressChanged?: string; linkReset?: string; then?: string };
}) {
  const { group, membership, people, inviteUrl } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";
  const isOwner = membership.access === "owner";

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={id} name={group.name} access={membership.access} active="People">
        <h1>{copy.members.title}</h1>
      </LoopNav>

      <ThenBanner then={notices.then} />
      {notices.invited ? <NoticeFocus>{copy.members.invitedNotice}</NoticeFocus> : null}
      {notices.linkReset ? <NoticeFocus>{copy.members.inviteLink.resetNotice}</NoticeFocus> : null}
      {notices.resent ? <NoticeFocus>{copy.members.resentNotice}</NoticeFocus> : null}
      {notices.removed ? <NoticeFocus>{copy.members.removedNotice}</NoticeFocus> : null}
      {notices.limited ? <NoticeFocus tone="danger">{copy.members.limitedNotice}</NoticeFocus> : null}
      {notices.transferred ? <NoticeFocus>{copy.members.transferredNotice}</NoticeFocus> : null}
      {notices.transferError ? <NoticeFocus tone="danger">{copy.members.transferError}</NoticeFocus> : null}

      <div className="people-layout">
      {/* The list leads on a phone: inviting is one button that opens the link and the email form. On a wide
          screen the same card sits to the right, always open. */}
      {manages ? (
        <aside className="people-aside" aria-label={copy.members.inviteTitle}>
          <InvitePanel
            groupId={id}
            url={inviteUrl}
            defaultOpen={people.length === 1 || Boolean(notices.invited || notices.linkReset || notices.limited)}
          />
        </aside>
      ) : null}
      <div className="people-main">
      {manages && people.length === 1 ? (
        <div className="card mt-5 p-5">
          <h2 className="text-[18px] font-bold text-ink">{copy.members.firstPersonTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.members.firstPersonBody}</p>
        </div>
      ) : null}

      {/* One card, one list: every person is a row of the same shape, yours first. */}
      <ul className="ppl-list card mt-4">
        {[...people].sort((a, b) => Number(b.id === membership.id) - Number(a.id === membership.id)).map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            groupId={id}
            groupName={group.name}
            viewerId={membership.id}
            signature={membership.signature}
            manages={manages}
            isOwner={isOwner}
            then={notices.then}
          />
        ))}
      </ul>
      </div>
      </div>
    </main>
  );
}
