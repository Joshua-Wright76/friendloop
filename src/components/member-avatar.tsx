import type { MemberColor } from "@/lib/issue-experience";

export function MemberAvatar({
  name,
  color,
  className = "",
}: {
  name: string;
  color: MemberColor;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{ backgroundColor: color.background, color: color.foreground }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
