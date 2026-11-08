"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Picker, type PickerOption } from "@/components/picker";
import { copy, text } from "@/lib/copy";
import { participationAction, roleAction } from "./actions";

type Access = "member" | "admin";
type Participation = "contributor" | "reader";
type Props = {
  groupId: string;
  membershipId: string;
  memberName: string;
  current: Access;
  participation: Participation;
};

const ACCESS_OPTIONS: PickerOption[] = [
  { value: "member", label: copy.common.roles.member },
  { value: "admin", label: copy.common.roles.admin },
];
const PARTICIPATION_OPTIONS: PickerOption[] = [
  { value: "contributor", label: copy.members.participation.contributor },
  { value: "reader", label: copy.members.participation.reader },
];

export function MemberRolePicker({ groupId, membershipId, memberName, current, participation: initialParticipation }: Props) {
  const router = useRouter();
  const [access, setAccess] = useState<Access>(current);
  const [participation, setParticipation] = useState<Participation>(initialParticipation);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<"access" | "participation">("access");
  const [pending, startTransition] = useTransition();

  function save(field: "access" | "participation", next: string) {
    const previous = { access, participation };
    if (field === "access") setAccess(next as Access);
    else setParticipation(next as Participation);
    setMessage("");
    setFailed(false);
    setSaving(field);
    const error = field === "access" ? copy.members.roleError : copy.members.participation.error;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("membershipId", membershipId);
      formData.set(field, next);
      try {
        const result = await (field === "access" ? roleAction : participationAction)(formData);
        if (!result.ok) throw new Error("not saved");
        setMessage(field === "access" ? copy.members.roleUpdated : copy.members.participation.updated);
        router.refresh();
      } catch {
        setAccess(previous.access);
        setParticipation(previous.participation);
        setFailed(true);
        setMessage(error);
      }
    });
  }

  return (
    <div className="member-role-form">
      <div className="member-role-picker">
        <span className="member-role-label">{copy.members.accessLabel}</span>
        <Picker
          name="access"
          defaultValue={access}
          value={access}
          options={ACCESS_OPTIONS}
          ariaLabel={text(copy.members.roleAriaLabel, { name: memberName })}
          onValueChange={(next) => save("access", next)}
          disabled={pending}
        />
      </div>
      <div className="member-role-picker">
        <span className="member-role-label">{copy.members.participationLabel}</span>
        <Picker
          name="participation"
          defaultValue={participation}
          value={participation}
          options={PARTICIPATION_OPTIONS}
          ariaLabel={text(copy.members.participation.ariaLabel, { name: memberName })}
          onValueChange={(next) => save("participation", next)}
          disabled={pending}
        />
      </div>
      {/* Both regions stay mounted so a change of text is announced; a node that appears with its text often is not. */}
      <div className="member-role-status leading-snug">
        <span role="status" aria-live="polite" className={pending || (message && !failed) ? "text-[13px] text-ink-muted" : undefined}>
          {pending ? (saving === "access" ? copy.members.roleSaving : copy.members.participation.saving) : failed ? "" : message}
        </span>
        <span role="alert" className={failed ? "text-[13px] text-danger" : undefined}>
          {failed ? message : ""}
        </span>
      </div>
    </div>
  );
}
