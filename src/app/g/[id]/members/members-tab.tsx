"use client";

import Link from "next/link";
import { removeAction, resendAction } from "./actions";
import { MemberRolePicker } from "./member-role-picker";
import { TransferControl } from "./transfer-control";
import { Avatar } from "@/components/avatar";
import { ProfilePhoto } from "@/components/profile-photo";
import { InviteForm } from "./invite-form";
import { LoopNav } from "@/components/loop-nav";
import { NoticeFocus } from "@/components/notice-focus";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";

export default function MembersTab({ notices }: {
  notices: { invited?: string; resent?: string; removed?: string; transferred?: string; transferError?: string };
}) {
  const { group, membership, people } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";
  const isOwner = membership.access === "owner";

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>
      <LoopNav id={id} active="People" isOwner={isOwner} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.members.title}</h1>

      {notices.invited ? <NoticeFocus>{copy.members.invitedNotice}</NoticeFocus> : null}
      {notices.resent ? <NoticeFocus>{copy.members.resentNotice}</NoticeFocus> : null}
      {notices.removed ? <NoticeFocus>{copy.members.removedNotice}</NoticeFocus> : null}
      {notices.transferred ? <NoticeFocus>{copy.members.transferredNotice}</NoticeFocus> : null}
      {notices.transferError ? <NoticeFocus tone="danger">{copy.members.transferError}</NoticeFocus> : null}

      {manages && people.length === 1 ? (
        <div className="card mt-5 p-5">
          <h2 className="text-[18px] font-bold text-ink">{copy.members.firstPersonTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.members.firstPersonBody}</p>
          <a href="#invite-people" className="btn btn-primary mt-4 inline-flex">{copy.members.firstPersonAction}</a>
        </div>
      ) : null}

      <ul className="mt-5 flex flex-col gap-2.5">
        {people.map((person) => {
          const isYou = person.id === membership.id;
          return (
            <li key={person.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={person.name ?? person.email} photoUrl={person.photoUrl} />
                  <div className="min-w-0">
                    <p className="wrap-any text-[15px] font-medium text-ink">
                      {person.name ?? person.email.split("@")[0]}
                      {isYou ? <span className="ml-1.5 text-[13px] text-ink-muted">{copy.members.you}</span> : null}
                    </p>
                    <p className="wrap-any text-[13px] text-ink-muted">{person.email}</p>
                  </div>
                </div>
                {manages && person.access !== "owner" ? (
                  <MemberRolePicker
                    groupId={id}
                    membershipId={person.id}
                    memberName={person.name ?? person.email}
                    current={person.access}
                  />
                ) : (
                  <span className="flex-none rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                    {copy.common.roles[person.access]}
                  </span>
                )}
              </div>

              {isYou ? (
                <div className="mt-3 border-t border-dashed border-line pt-3">
                  <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.identity.profile.title}</p>
                  <ProfilePhoto
                    endpoint={`/api/loop/${id}/profile-photo`}
                    name={person.name ?? person.email}
                    photoUrl={person.photoUrl}
                    refresh
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

              {!person.acceptedAt ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                  <span>{copy.members.invitePending}</span>
                  {manages ? (
                    <form action={resendAction}>
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="membershipId" value={person.id} />
                      <button type="submit" aria-label={text(copy.a11yLabels.resendInvite, { name: person.name ?? person.email })} className="inline-flex min-h-6 items-center px-1 text-[13px] font-medium text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink">
                        {copy.members.resendInvite}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {manages && person.access !== "owner" ? (
                <form action={removeAction} className="mt-3 flex justify-end">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="membershipId" value={person.id} />
                  <button type="submit" aria-label={text(copy.a11yLabels.removeMember, { name: person.name ?? person.email })} className="btn btn-danger h-9 min-h-9 px-3 text-[13px]">
                    {copy.members.remove}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {manages ? (
        <InviteForm groupId={id} />
      ) : null}
    </main>
  );
}
