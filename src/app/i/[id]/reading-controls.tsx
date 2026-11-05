import Link from "next/link";
import { copy } from "@/lib/copy";
import { readingHref, type Reading, type ReadingPerson } from "@/lib/issue-reading";

/**
 * Who to read, and in what order. Plain links, so it works without script, by
 * keyboard and by thumb, and every choice is an address you can send to someone
 * in the loop. The current choice is marked in words and `aria-current`, never
 * by colour alone.
 */
function Check() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 flex-none">
      <path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReadingControls({
  base,
  token,
  people,
  reading,
  focus,
}: {
  base: string;
  token: string | null;
  people: ReadingPerson[];
  reading: Reading;
  focus: ReadingPerson | null;
}) {
  const labels = copy.issue.reading;
  const chip = "chip inline-flex min-h-11 items-center gap-1.5 border px-3.5 text-[14px] font-bold no-underline";
  const idle = "bg-card text-ink-soft";
  const current = "bg-accent-soft text-accent-ink";
  const everyoneActive = !focus;

  return (
    <nav aria-label={labels.label} className="flex flex-col gap-3" data-reading-controls>
      <div>
        <p className="m-0 mb-1.5 text-[13px] font-medium text-ink-soft">{labels.peopleLabel}</p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          <li>
            <Link
              href={readingHref(base, token, { ...reading, by: null })}
              aria-current={everyoneActive ? "true" : undefined}
              className={`${chip} ${everyoneActive ? current : idle}`}
            >
              {everyoneActive ? <Check /> : null}{labels.everyone}
            </Link>
          </li>
          {people.map((person) => {
            const active = focus?.id === person.id;
            return (
              <li key={person.id}>
                <Link
                  href={readingHref(base, token, { ...reading, by: person.id })}
                  aria-current={active ? "true" : undefined}
                  className={`${chip} ${active ? current : idle}`}
                >
                  {active ? <Check /> : null}{person.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="m-0 mb-1.5 text-[13px] font-medium text-ink-soft">{labels.sortLabel}</p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {(["question", "member"] as const).map((sort) => {
            const active = reading.sort === sort;
            return (
              <li key={sort}>
                <Link
                  href={readingHref(base, token, { ...reading, sort })}
                  aria-current={active ? "true" : undefined}
                  className={`${chip} ${active ? current : idle}`}
                >
                  {active ? <Check /> : null}{sort === "question" ? labels.byQuestion : labels.byPerson}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
