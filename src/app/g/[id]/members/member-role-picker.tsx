"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Picker, type PickerOption } from "@/components/picker";
import { copy, text } from "@/lib/copy";
import { roleAction } from "./actions";

type Access = "member" | "admin";
type Props = { groupId: string; membershipId: string; memberName: string; current: "member" | "admin" };

export function MemberRolePicker({ groupId, membershipId, memberName, current }: Props) {
  const router = useRouter();
  const [access, setAccess] = useState<Access>(current);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const failed = message === copy.members.roleError;
  const options: PickerOption[] = [
    { value: "member", label: copy.common.roles.member },
    { value: "admin", label: copy.common.roles.admin },
  ];

  function update(next: string) {
    const previous = access;
    const nextAccess = next as Access;
    setAccess(nextAccess);
    setMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("membershipId", membershipId);
      formData.set("access", nextAccess);
      try {
        const result = await roleAction(formData);
        if (!result.ok) {
          setAccess(previous);
          setMessage(copy.members.roleError);
        } else {
          setMessage(copy.members.roleUpdated);
          router.refresh();
        }
      } catch {
        setAccess(previous);
        setMessage(copy.members.roleError);
      }
    });
  }

  return (
    <div className="member-role-form">
      <div className="member-role-picker">
        <Picker
          name="access"
          defaultValue={access}
          value={access}
          options={options}
          ariaLabel={text(copy.members.roleAriaLabel, { name: memberName })}
          onValueChange={update}
          disabled={pending}
        />
      </div>
      {/* Both regions stay mounted so a change of text is announced; a node that appears with its text often is not. */}
      <span role="status" aria-live="polite" className={pending || (message && !failed) ? "ml-2 text-[11px] text-ink-muted" : undefined}>
        {pending ? copy.members.roleSaving : failed ? "" : message}
      </span>
      <span role="alert" className={failed ? "ml-2 text-[11px] text-danger" : undefined}>
        {failed ? message : ""}
      </span>
    </div>
  );
}
