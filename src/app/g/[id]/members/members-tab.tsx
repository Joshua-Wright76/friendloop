"use client";

import { SafeForm } from "@/components/safe-form";
import { removeAction, resendAction } from "./actions";
import { ConfirmAction } from "@/components/confirm-action";
import { MemberRolePicker } from "./member-role-picker";
import { TransferControl } from "./transfer-control";
import { Avatar, NameCharm } from "@/components/avatar";
import { ProfilePhoto } from "@/components/profile-photo";
import { InviteForm } from "./invite-form";
import { ChangeMemberEmail } from "./change-member-email";
import { LoopNav } from "@/components/loop-nav";
import { NoticeFocus } from "@/components/notice-focus";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";
import { SubmitButton } from "@/components/submit-button";

export default function MembersTab({ notices }: {
  notices: { invited?: string; resent?: string; removed?: string; transferred?: string; transferError?: string; limited?: string; addressChanged?: string };
}) {
  const { group, membership, people } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";
  const isOwner = membership.access === "owner";

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={id} name={group.name} access={membership.access} active="People">
        <h1>{copy.members.title}</h1>
        {group.mode === "from_you" ? <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.members.fromYouDescription}</p> : null}
        {/* Inviting is the owner's most common job here: one line, right under the title. */}
        {manages ? <InviteForm groupId={id} /> : null}
      </LoopNav>

      {notices.invited ? <NoticeFocus>{copy.members.invitedNotice}</NoticeFocus> : null}
      {notices.resent ? <NoticeFocus>{copy.members.resentNotice}</NoticeFocus> : null}
      {notices.removed ? <NoticeFocus>{copy.members.removedNotice}</NoticeFocus> : null}
      {notices.addressChanged ? <NoticeFocus>{copy.members.changeEmail.notice}</NoticeFocus> : null}
      {notices.limited ? <NoticeFocus tone="danger">{copy.members.limitedNotice}</NoticeFocus> : null}
      {notices.transferred ? <NoticeFocus>{copy.members.transferredNotice}</NoticeFocus> : null}
      {notices.transferError ? <NoticeFocus tone="danger">{copy.members.transferError}</NoticeFocus> : null}

      {manages && people.length === 1 ? (
        <div className="card mt-5 p-5">
          <h2 className="text-[18px] font-bold text-ink">{copy.members.firstPersonTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{group.mode === "from_you" ? copy.members.firstPersonBodyFromYou : copy.members.firstPersonBody}</p>
        </div>
      ) : null}

      {/* Your own card first: it holds your photo, charm and frame. */}
      <ul className="member-list mt-4 flex flex-col gap-2.5">
        {[...people].sort((a, b) => Number(b.id === membership.id) - Number(a.id === membership.id)).map((person) => {
          const isYou = person.id === membership.id;
          return (
            <li key={person.id} className="card p-4">
              {/* On a phone the role picker wraps below, so the name keeps a readable width. */}
              <div className="member-row">
                <div className="member-row__who">
                  <Avatar name={person.name ?? person.email} photoUrl={person.photoUrl} frame={person.avatarFrame} />
                  <div className="min-w-0">
                    <p className="wrap-any text-[15px] font-medium text-ink">
                      {person.name ?? person.email.split("@")[0]}
                      <NameCharm charm={person.charm} />
                      {isYou ? <span className="ml-1.5 text-[13px] text-ink-muted">{copy.members.you}</span> : null}
                    </p>
                    <p className="wrap-any text-[13px] text-ink-muted">{person.email}</p>
                  </div>
                </div>
                {manages && person.access !== "owner" ? (
                  <>
                  <MemberRolePicker
                    groupId={id}
                    membershipId={person.id}
                    memberName={person.name ?? person.email}
                    current={person.access}
                    participation={person.participation}
                    fixedReader={group.mode === "from_you"}
                  />
                  </>
                ) : (
                  <span className="chip flex-none border bg-card px-2.5 py-1 text-[13px] font-bold capitalize text-ink-soft">
                    {copy.common.roles[person.access]}
                  </span>
                )}
              </div>

              {manages && (person.mutedAt || person.suppression) ? (
                <div className="mt-2 flex flex-col gap-1.5" data-email-status>
                  {person.suppression ? (
                    <p className="text-[13px] leading-relaxed text-danger">
                      <span className="mr-1.5 inline-flex rounded-full border border-current px-2 py-0.5 text-[13px] font-bold">
                        {copy.members.bouncing}
                      </span>
                      {person.suppression === "complaint" ? copy.members.complaintHint : copy.members.bouncingHint}
                    </p>
                  ) : null}
                  {person.mutedAt ? (
                    <p className="text-[13px] leading-relaxed text-ink-soft">
                      <span className="mr-1.5 inline-flex rounded-full border border-line px-2 py-0.5 text-[13px] font-bold">
                        {copy.members.muted}
                      </span>
                      {copy.members.mutedHint}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isYou ? (
                <div className="mt-1 border-t border-dashed border-line pt-1">
                  <ProfilePhoto
                    endpoint={`/api/loop/${id}/profile-photo`}
                    name={person.name ?? person.email}
                    photoUrl={person.photoUrl}
                    charm={person.charm}
                    frame={person.avatarFrame}
                    refresh
                    compact
                  />
                </div>
              ) : null}

              {isOwner && person.access === "admin" && person.acceptedAt ? (
                <div className="mt-3 flex justify-end">
                  <TransferControl
                    groupId={id}
                    groupName={group.name}
                    membershipId={person.id}
                    name={person.name ?? person.email.split("@")[0]}
                  />
                </div>
              ) : null}

              {manages && person.access !== "owner" && !person.userId ? (
                <ChangeMemberEmail groupId={id} membershipId={person.id} name={person.name ?? person.email} />
              ) : null}

              {!person.acceptedAt ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                  <span>{copy.members.invitePending}</span>
                  {manages ? (
                    <SafeForm action={resendAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <SubmitButton aria-label={text(copy.a11yLabels.resendInvite, { name: person.name ?? person.email })} className="link link--quiet">
                        {copy.members.resendInvite}
                      </SubmitButton>
                    </SafeForm>
                  ) : null}
                </div>
              ) : null}

              {/* Removing someone is the one action here that can't be undone: it sits apart, at the foot of the card. */}
              {manages && person.access !== "owner" ? (
                <div className="member-card__danger">
                  <ConfirmAction
                    className="member-remove"
                    action={removeAction}
                    fields={{ groupId: id, membershipId: person.id }}
                    label={copy.members.remove}
                    triggerLabel={text(copy.a11yLabels.removeMember, { name: person.name ?? person.email })}
                    question={text(copy.a11yLabels.removeMemberQuestion, { name: person.name ?? person.email })}
                    body={copy.a11yLabels.removeMemberBody}
                    confirmLabel={text(copy.a11yLabels.removeMemberConfirm, { name: person.name ?? person.email })}
                    cancelLabel={copy.a11yLabels.confirmCancel}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
