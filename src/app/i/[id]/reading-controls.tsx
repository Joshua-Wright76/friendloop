import Link from "next/link";
import { copy, text } from "@/lib/copy";
import { readingHref, type Reading, type ReadingPerson } from "@/lib/issue-reading";

/**
 * Who to read, and in what order. Plain links, so it works without script, by
 * keyboard and by thumb, and every choice is an address you can send to someone
 * in the loop. The current choice is marked in words and `aria-current`, never
 * by colour alone.
 */
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
  const chip = "chip inline-flex min-h-11 items-center border px-3.5 text-[14px] font-bold no-underline";
  const idle = "bg-card text-ink-soft";
  const current = "bg-accent-soft text-accent-ink";
  const everyoneActive = !focus;

  return (
    <nav aria-label={labels.label} className="mt-6 flex flex-col gap-3" data-reading-controls>
      <div>
        <p className="m-0 mb-1.5 text-[13px] font-medium text-ink-soft">{labels.peopleLabel}</p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          <li>
            <Link
              href={readingHref(base, token, { ...reading, by: null })}
              aria-current={everyoneActive ? "true" : undefined}
              className={`${chip} ${everyoneActive ? current : idle}`}
            >
              {everyoneActive ? "✓ " : ""}{labels.everyone}
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
                  {active ? "✓ " : ""}{person.name}
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
                  {active ? "✓ " : ""}{sort === "question" ? labels.byQuestion : labels.byPerson}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {focus ? (
        <p role="status" className="m-0 text-[14px] text-ink-soft">
          {text(copy.issue.reading.showing, { name: focus.name })}{" "}
          <Link
            href={readingHref(base, token, { ...reading, by: null })}
            className="inline-flex min-h-11 items-center font-bold text-ink underline decoration-line-strong underline-offset-4"
          >
            {labels.showEveryone}
          </Link>
        </p>
      ) : null}
    </nav>
  );
}
