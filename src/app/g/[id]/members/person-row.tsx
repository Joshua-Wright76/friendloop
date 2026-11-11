"use client";

import { useEffect, useId, useState } from "react";
import { Avatar, NameCharm } from "@/components/avatar";
import { ConfirmAction } from "@/components/confirm-action";
import { ProfilePhoto } from "@/components/profile-photo";
import { SafeForm } from "@/components/safe-form";
import { SubmitButton } from "@/components/submit-button";
import { copy, text } from "@/lib/copy";
import { parseSignature } from "@/lib/looks";
import { removeAction, resendAction } from "./actions";
import { ChangeMemberEmail } from "./change-member-email";
import { MemberRolePicker } from "./member-role-picker";
import { TransferControl } from "./transfer-control";
import { useLoopData } from "../loop-data";

type Person = ReturnType<typeof useLoopData>["people"][number];

const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * One person, one row: photo, name, a single quiet line about them, and a chevron that opens
 * what you can do. Every row has the same shape, yours included.
 */
export function PersonRow({
  person,
  groupId,
  groupName,
  viewerId,
  signature,
  manages,
  isOwner,
  then,
}: {
  person: Person;
  groupId: string;
  groupName: string;
  viewerId: string;
  signature: number[][] | null | undefined;
  manages: boolean;
  isOwner: boolean;
  then?: string;
}) {
  const isYou = person.id === viewerId;
  const name = person.name ?? person.email.split("@")[0];
  const fullName = person.name ?? person.email;
  const folds = manages && !isYou && person.access !== "owner";
  const expands = isYou || folds;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted (hidden), so a half-typed address or an upload in flight survives a collapse.
  const [opened, setOpened] = useState(false);
  const [fixedTo, setFixedTo] = useState<string | null>(null);

  // /g/<id>/members?look=open opens your row, and ProfilePhoto opens and scrolls to charm and frame.
  useEffect(() => {
    if (!isYou || new URLSearchParams(window.location.search).get("look") !== "open") return;
    const frame = requestAnimationFrame(() => {
      setOpen(true);
      setOpened(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [isYou]);

  const waiting = !isYou && !person.acceptedAt && (manages || person.participation === "contributor") && !fixedTo;
  const bouncing = manages && Boolean(person.suppression);
  const muted = manages && Boolean(person.mutedAt);
  const role = copy.common.roles[person.access];
  const meta = waiting
    ? text(copy.members.invitePending, { name })
    : isYou
      ? `${role} · ${copy.members.you}`
      : person.access === "owner"
        ? role
        : `${role} · ${lower(copy.members.participation[person.participation])}`;

  const summary = (
    <>
      <Avatar name={fullName} photoUrl={person.photoUrl} frame={person.avatarFrame} />
      <span className="ppl-who">
        <span className="ppl-name wrap-any">
          {name}
          <NameCharm charm={person.charm} />
        </span>
        <span className="ppl-meta wrap-any">
          {meta}
          {bouncing ? <span className="ppl-meta__flag ppl-meta__flag--danger"> {"·"} {copy.members.bouncing}</span> : null}
          {muted ? <span className="ppl-meta__flag"> {"·"} {copy.members.muted}</span> : null}
        </span>
      </span>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron ppl-chevron" style={expands ? undefined : { visibility: "hidden" }}>
        <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );

  return (
    <li className="ppl-row" data-open={open ? "" : undefined}>
      {expands ? (
        <button
          type="button"
          className="ppl-summary"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={isYou ? undefined : text(copy.members.manageLabel, { name })}
          onClick={() => {
            setOpen(!open);
            setOpened(true);
          }}
        >
          {summary}
        </button>
      ) : (
        <div className="ppl-summary ppl-summary--static">{summary}</div>
      )}

      {fixedTo ? (
        <p role="status" className="ppl-note wrap-any">
          <svg viewBox="0 0 20 20" aria-hidden="true" className="ppl-note__tick"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{text(copy.members.changeEmail.doneNote, { email: fixedTo })}</span>
        </p>
      ) : null}

      {expands && opened ? (
        <div id={panelId} className="ppl-panel" hidden={!open}>
          {isYou ? (
            <ProfilePhoto
              endpoint={`/api/loop/${groupId}/profile-photo`}
              name={fullName}
              photoUrl={person.photoUrl}
              charm={person.charm}
              frame={person.avatarFrame}
              signature={parseSignature(signature)}
              refresh
              compact
            />
          ) : (
            <>
              <p className="ppl-email wrap-any">{person.email}</p>
              <MemberRolePicker
                groupId={groupId}
                membershipId={person.id}
                memberName={fullName}
                current={person.access as "member" | "admin"}
                participation={person.participation}
              />
              {person.suppression || person.mutedAt ? (
                <div className="ppl-flags" data-email-status>
                  {person.suppression ? (
                    <p className="text-[13px] leading-relaxed text-danger">
                      <span className="mr-1.5 inline-flex rounded-full border border-current px-2 py-0.5 text-[13px] font-bold">{copy.members.bouncing}</span>
                      {person.suppression === "complaint" ? copy.members.complaintHint : copy.members.bouncingHint}
                    </p>
                  ) : null}
                  {person.mutedAt ? (
                    <p className="text-[13px] leading-relaxed text-ink-soft">
                      <span className="mr-1.5 inline-flex rounded-full border border-line px-2 py-0.5 text-[13px] font-bold">{copy.members.muted}</span>
                      {copy.members.mutedHint}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="ppl-actions">
                {!person.acceptedAt ? (
                  <SafeForm action={resendAction} className="contents">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="membershipId" value={person.id} />
                    <SubmitButton aria-label={text(copy.a11yLabels.resendInvite, { name: fullName })} className="btn btn-quiet ppl-action">
                      {copy.members.resendInvite}
                    </SubmitButton>
                  </SafeForm>
                ) : null}
                {!person.userId ? (
                  <ChangeMemberEmail groupId={groupId} membershipId={person.id} name={fullName} onDone={setFixedTo} />
                ) : null}
                {isOwner && person.acceptedAt ? (
                  <TransferControl groupId={groupId} groupName={groupName} membershipId={person.id} name={name} then={then} />
                ) : null}
              </div>
              <div className="ppl-danger">
                <ConfirmAction
                  className="member-remove"
                  action={removeAction}
                  fields={{ groupId, membershipId: person.id }}
                  label={copy.members.remove}
                  triggerLabel={text(copy.a11yLabels.removeMember, { name: fullName })}
                  question={text(copy.a11yLabels.removeMemberQuestion, { name: fullName })}
                  body={copy.a11yLabels.removeMemberBody}
                  confirmLabel={text(copy.a11yLabels.removeMemberConfirm, { name: fullName })}
                  cancelLabel={copy.a11yLabels.confirmCancel}
                />
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
