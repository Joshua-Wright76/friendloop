import Link from "next/link";

const items = [
  ["Overview", ""],
  ["People", "/members"],
  ["Questions", "/questions"],
  ["Rounds", "/issues"],
  ["Settings", "/settings"],
] as const;

export function LoopNav({ id, active, isOwner = false }: { id: string; active: (typeof items)[number][0]; isOwner?: boolean }) {
  return (
    <nav className="loop-nav" aria-label="Manage the loop">
      {items.filter(([label]) => label !== "Settings" || isOwner).map(([label, path]) => (
        <Link key={label} href={`/g/${id}${path}`} aria-current={label === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
