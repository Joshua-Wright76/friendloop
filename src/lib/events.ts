import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, groups, issueSections, issues, memberships } from "@/db/schema";
import { copy, text } from "./copy.ts";
import {
  EVENT_TITLE_MAX,
  describeDate,
  issueCoverage,
  localDate,
  nextOccurrence,
  occurrencesInWindow,
  parseDateInput,
  type EventRule,
} from "./event-dates.ts";

type GroupRow = typeof groups.$inferSelect;
type EventRow = typeof events.$inferSelect;

/** An event with the birthday person's current details, for snapshotting and the list. */
type EventWithPerson = {
  event: EventRow;
  personName: string | null;
  personEmail: string | null;
  personRevoked: boolean;
};

async function loadEvents(groupId: string, onlyId?: string): Promise<EventWithPerson[]> {
  const rows = await db
    .select({
      event: events,
      personName: memberships.name,
      personEmail: memberships.email,
      personRevoked: sql<boolean>`${memberships.revokedAt} is not null`,
    })
    .from(events)
    .leftJoin(memberships, eq(memberships.id, events.membershipId))
    .where(onlyId ? and(eq(events.groupId, groupId), eq(events.id, onlyId)) : eq(events.groupId, groupId))
    .orderBy(asc(events.month), asc(events.day), asc(events.createdAt));
  return rows.map((row) => ({ ...row, personRevoked: row.personRevoked === true }));
}

function personLabel(row: Pick<EventWithPerson, "personName" | "personEmail">): string {
  return row.personName ?? row.personEmail?.split("@")[0] ?? "";
}

function ruleOf(event: EventRow): EventRule {
  return { kind: event.kind, month: event.month, day: event.day, year: event.year };
}

/** What a snapshot of this event reads like, frozen into the issue. */
function sectionTextFor(row: EventWithPerson): { title: string; description: string } {
  if (row.event.kind === "birthday") {
    const name = personLabel(row);
    return {
      title: text(copy.events.section.birthdayTitle, { name }),
      description: text(copy.events.section.birthdayDescription, { name }),
    };
  }
  return { title: row.event.title ?? "", description: copy.events.section.onceDescription };
}

/**
 * Put every event whose date falls in an issue's coverage into that issue as a
 * section. Safe to repeat: an occurrence (event + date) can be claimed only once,
 * so a retried sweep, an overlapping window, or an event added mid-round never
 * produces a second section for the same day.
 */
async function placeEvents(input: {
  issueId: string;
  window: { start: string; end: string };
  rows: EventWithPerson[];
}): Promise<number> {
  const claims = input.rows.flatMap((row) => {
    // A birthday whose person has left the loop has nobody to celebrate.
    if (row.event.kind === "birthday" && (row.event.membershipId === null || row.personRevoked)) return [];
    return occurrencesInWindow(ruleOf(row.event), input.window).map((eventDate) => ({ row, eventDate }));
  });
  if (claims.length === 0) return 0;

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${issueSections.position}), -1)::int` })
    .from(issueSections)
    .where(eq(issueSections.issueId, input.issueId));

  claims.sort((left, right) => left.eventDate.localeCompare(right.eventDate));
  const inserted = await db
    .insert(issueSections)
    .values(
      claims.map(({ row, eventDate }, index) => ({
        issueId: input.issueId,
        sectionId: null,
        kind: "standard" as const,
        ...sectionTextFor(row),
        emoji: row.event.emoji ?? copy.events.section.defaultEmoji,
        adminOnly: false,
        position: maxPosition + 1 + index,
        eventId: row.event.id,
        eventDate,
      })),
    )
    .onConflictDoNothing({ target: [issueSections.eventId, issueSections.eventDate] })
    .returning({ id: issueSections.id });
  return inserted.length;
}

/**
 * Put a round's events into it: every occurrence from the day it opened through
 * the day it goes out. Rounds meet at a delivery date, and an occurrence on that
 * day goes to whichever round claims it first: the one going out. Repeatable, so
 * a round carried over to a later delivery just picks up the extra days.
 */
export async function placeEventsInRound(input: {
  group: GroupRow;
  issueId: string;
  opensAt: Date;
  deliversAt: Date;
}): Promise<number> {
  const rows = await loadEvents(input.group.id);
  if (rows.length === 0) return 0;
  return placeEvents({
    issueId: input.issueId,
    window: issueCoverage({
      opensAt: input.opensAt,
      deliversAt: input.deliversAt,
      timezone: input.group.timezone,
    }),
    rows,
  });
}

/**
 * An event added while a round is already open would miss that round's snapshot. If
 * its date falls inside the open round, add it there now, so nothing owners type in
 * is silently lost to timing.
 */
async function placeInOpenIssue(group: GroupRow, eventId: string): Promise<void> {
  const [open] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .limit(1);
  if (!open) return;

  await placeEvents({
    issueId: open.id,
    window: issueCoverage({
      opensAt: open.opensAt,
      deliversAt: open.deliversAt,
      timezone: group.timezone,
    }),
    rows: await loadEvents(group.id, eventId),
  });
}

export type EventListItem = {
  id: string;
  kind: "once" | "birthday";
  /** What the list calls it: the title, or "Maya's birthday". */
  label: string;
  title: string;
  emoji: string | null;
  membershipId: string | null;
  month: number;
  day: number;
  year: number | null;
  /** Next date on the calendar as ISO, or null for a one-time event that has passed. */
  nextDate: string | null;
  nextLabel: string | null;
  /** The ISO date for the edit form's date input. */
  inputDate: string;
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The list a manager sees: soonest first, with finished one-time events last. */
export async function eventsOf(group: Pick<GroupRow, "id" | "timezone">, at: Date): Promise<EventListItem[]> {
  const today = localDate(at, group.timezone);
  const items = (await loadEvents(group.id))
    .filter((row) => !(row.event.kind === "birthday" && row.personRevoked))
    .map((row): EventListItem => {
      const next = nextOccurrence(ruleOf(row.event), today);
      return {
        id: row.event.id,
        kind: row.event.kind,
        label:
          row.event.kind === "birthday"
            ? text(copy.events.birthdayRow, { name: personLabel(row) })
            : (row.event.title ?? ""),
        title: row.event.title ?? "",
        emoji: row.event.emoji,
        membershipId: row.event.membershipId,
        month: row.event.month,
        day: row.event.day,
        year: row.event.year,
        nextDate: next,
        nextLabel: next ? describeDate(next) : null,
        inputDate: `${pad(row.event.year ?? Number(today.slice(0, 4)), 4)}-${pad(row.event.month, 2)}-${pad(row.event.day, 2)}`,
      };
    });

  return items.sort((left, right) => {
    if (left.nextDate && right.nextDate) return left.nextDate.localeCompare(right.nextDate);
    if (left.nextDate) return -1;
    if (right.nextDate) return 1;
    return left.label.localeCompare(right.label);
  });
}

export type EventInput = {
  kind: "once" | "birthday";
  title: string;
  emoji: string | null;
  /** `YYYY-MM-DD` from a date input. */
  date: string;
  membershipId: string | null;
};

/** Which copy line explains a refused event: a key of `copy.events.errors`. */
export type EventErrorCode = keyof typeof copy.events.errors;

export type EventWriteResult =
  | { ok: true }
  | { ok: false; code: EventErrorCode };

/** Check an event form against the loop; returns the columns to store. */
async function checkEvent(
  group: Pick<GroupRow, "id" | "timezone">,
  input: EventInput,
  options: { at: Date; allowPast: boolean },
): Promise<{ ok: false; code: EventErrorCode } | { ok: true; values: Omit<typeof events.$inferInsert, "groupId"> }> {
  const date = parseDateInput(input.date);
  if (!date) return { ok: false, code: "invalid" };

  const emoji = input.emoji?.trim().slice(0, 8) || null;

  if (input.kind === "birthday") {
    if (!input.membershipId) return { ok: false, code: "memberRequired" };
    const [person] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.groupId, group.id),
          isNull(memberships.revokedAt),
        ),
      )
      .limit(1);
    if (!person) return { ok: false, code: "memberRequired" };
    return {
      ok: true,
      values: { kind: "birthday", title: null, emoji, month: date.month, day: date.day, year: null, membershipId: person.id },
    };
  }

  const title = input.title.trim();
  if (!title || title.length > EVENT_TITLE_MAX) return { ok: false, code: "titleRequired" };
  if (!options.allowPast && input.date < localDate(options.at, group.timezone)) {
    return { ok: false, code: "pastDate" };
  }
  return {
    ok: true,
    values: { kind: "once", title, emoji, month: date.month, day: date.day, year: date.year, membershipId: null },
  };
}

export async function createEvent(input: EventInput & { group: GroupRow; at: Date }): Promise<EventWriteResult> {
  const checked = await checkEvent(input.group, input, { at: input.at, allowPast: false });
  if (!checked.ok) return checked;

  const [created] = await db
    .insert(events)
    .values({ ...checked.values, groupId: input.group.id, createdAt: input.at })
    .returning({ id: events.id });
  await placeInOpenIssue(input.group, created.id);
  return { ok: true };
}

/** Edit an event. The kind is fixed; a delivered or open issue keeps what it snapshotted. */
export async function updateEvent(
  input: Omit<EventInput, "kind"> & { group: GroupRow; eventId: string; at: Date },
): Promise<EventWriteResult> {
  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, input.eventId), eq(events.groupId, input.group.id)))
    .limit(1);
  if (!existing) return { ok: false, code: "invalid" };

  const checked = await checkEvent(
    input.group,
    { ...input, kind: existing.kind },
    { at: input.at, allowPast: true },
  );
  if (!checked.ok) return checked;

  await db.update(events).set(checked.values).where(eq(events.id, existing.id));
  await placeInOpenIssue(input.group, existing.id);
  return { ok: true };
}

/** Remove an event. Sections already snapshotted keep their title and place. */
export async function deleteEvent(input: { groupId: string; eventId: string }): Promise<void> {
  await db.delete(events).where(and(eq(events.id, input.eventId), eq(events.groupId, input.groupId)));
}
