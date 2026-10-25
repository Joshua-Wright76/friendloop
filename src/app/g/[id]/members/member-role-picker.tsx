"use client";

import { useRef } from "react";
import { Picker, type PickerOption } from "@/components/picker";
import { copy, text } from "@/lib/copy";
import { roleAction } from "./actions";

type Props = {
  groupId: string;
  membershipId: string;
  memberName: string;
  current: "member" | "admin";
  canAssignOwner: boolean;
};

export function MemberRolePicker({ groupId, membershipId, memberName, current, canAssignOwner }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const options: PickerOption[] = [
    { value: "member", label: copy.common.roles.member },
    { value: "admin", label: copy.common.roles.admin },
    ...(canAssignOwner ? [{ value: "owner", label: copy.common.roles.owner }] : []),
  ];

  return (
    <form ref={form} action={roleAction} className="member-role-form">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="member-role-picker">
        <Picker
          name="access"
          defaultValue={current}
          options={options}
          ariaLabel={text(copy.members.roleAriaLabel, { name: memberName })}
          onValueChange={() => requestAnimationFrame(() => form.current?.requestSubmit())}
        />
      </div>
    </form>
  );
}
