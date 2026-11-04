"use client";

import { useState } from "react";
import { copy, text } from "@/lib/copy";
import { ConfirmAction } from "@/components/confirm-action";
import { FieldLabel } from "@/components/field-label";
import { EVENT_TITLE_MAX } from "@/lib/event-dates";
import { useLoopData, type LoopEvent } from "../loop-data";
import { createEventAction, deleteEventAction, updateEventAction } from "./actions";

export function EventsPanel() {
  const { group, people, events } = useLoopData();
  const [kind, setKind] = useState<"birthday" | "once">("birthday");
  const named = (person: (typeof people)[number]) => person.name ?? person.email.split("@")[0];

  return (
    <section className="card mt-5 p-5" aria-label={copy.events.title}>
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.events.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.events.description}</p>

      <h3 className="mt-4 text-[14px] font-semibold text-ink">{copy.events.upcomingTitle}</h3>
      {events.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2.5" aria-label={copy.events.listLabel}>
          {events.map((event) => (
            <li key={event.id} className="card border p-4">
              <p className="text-[15px] font-medium leading-snug text-ink">
                <span className="mr-2" aria-hidden>{event.emoji ?? copy.events.section.defaultEmoji}</span>
                {event.label}
              </p>
              <p className="mt-0.5 text-[12.5px] font-medium text-ink-muted numeric">
                {event.nextLabel ?? copy.events.passed}
                {event.kind === "birthday" ? ` · ${copy.events.yearly}` : ""}
              </p>
              <EventEditor groupId={group.id} event={event} />
              <ConfirmAction
                className="mt-2"
                action={deleteEventAction}
                fields={{ groupId: group.id, eventId: event.id }}
                label={copy.events.remove}
                triggerLabel={text(copy.events.removeLabel, { title: event.label })}
                question={text(copy.a11yLabels.removeEventQuestion, { title: event.label })}
                body={copy.a11yLabels.removeEventBody}
                confirmLabel={text(copy.a11yLabels.removeEventConfirm, { title: event.label })}
                cancelLabel={copy.a11yLabels.confirmCancel}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[14px] text-ink-muted">{copy.events.empty}</p>
      )}

      <form action={createEventAction} className="mt-4 border-t border-line pt-4">
        <input type="hidden" name="groupId" value={group.id} />
        <h3 className="text-[14px] font-semibold text-ink">{copy.events.addTitle}</h3>
        <label className="mt-2 flex flex-col gap-1.5">
          <FieldLabel>{copy.events.kindLabel}</FieldLabel>
          <select
            name="kind"
            value={kind}
            onChange={(change) => setKind(change.target.value === "once" ? "once" : "birthday")}
            className="field h-[46px] py-0"
          >
            <option value="birthday">{copy.events.kindBirthday}</option>
            <option value="once">{copy.events.kindOnce}</option>
          </select>
        </label>
        {kind === "birthday" ? (
          <label className="mt-2 flex flex-col gap-1.5">
            <FieldLabel required>{copy.events.memberLabel}</FieldLabel>
            <select name="membershipId" required className="field h-[46px] py-0" defaultValue="">
              <option value="" disabled>{copy.events.memberLabel}</option>
              {people.map((person) => <option key={person.id} value={person.id}>{named(person)}</option>)}
            </select>
          </label>
        ) : (
          <label className="mt-2 flex flex-col gap-1.5">
            <FieldLabel required>{copy.events.titleLabel}</FieldLabel>
            <input
              name="title"
              required
              maxLength={EVENT_TITLE_MAX}
              placeholder={copy.events.titlePlaceholder}
              className="field h-[46px] py-0"
            />
          </label>
        )}
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
          <div>
            <label htmlFor="event-date" className="block text-[13px] font-bold text-ink-soft">{copy.events.dateLabel} {copy.a11yLabels.required}</label>
            <input id="event-date" name="date" type="date" required className="field mt-1 h-[46px] py-0" />
            {kind === "birthday" ? <p className="mt-1 text-[12.5px] text-ink-muted">{copy.events.birthdayDateHint}</p> : null}
          </div>
          <div>
            <label htmlFor="event-emoji" className="block text-[13px] font-bold text-ink-soft">{copy.events.emojiLabel}</label>
            <input id="event-emoji" name="emoji" maxLength={8} placeholder={copy.events.section.defaultEmoji} className="field emoji-field mt-1 h-[46px] py-0" />
          </div>
        </div>
        <button type="submit" className="btn btn-primary mt-3">{copy.events.add}</button>
      </form>
    </section>
  );
}

function EventEditor({ groupId, event }: { groupId: string; event: LoopEvent }) {
  const { people } = useLoopData();
  return (
    <details className="mt-2">
      <summary
        aria-label={text(copy.events.editLabel, { title: event.label })}
        className="min-h-11 cursor-pointer text-[13px] font-bold leading-[44px] text-ink"
      >
        {copy.events.edit}
      </summary>
      <form action={updateEventAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="eventId" value={event.id} />
        {event.kind === "birthday" ? (
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{copy.events.memberLabel}</FieldLabel>
            <select name="membershipId" defaultValue={event.membershipId ?? ""} className="field h-[46px] py-0">
              {people.map((person) => <option key={person.id} value={person.id}>{person.name ?? person.email.split("@")[0]}</option>)}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <FieldLabel required>{copy.events.titleLabel}</FieldLabel>
            <input name="title" defaultValue={event.title} required maxLength={EVENT_TITLE_MAX} className="field h-[46px] py-0" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <FieldLabel required>{copy.events.dateLabel}</FieldLabel>
          <input name="date" type="date" required defaultValue={event.inputDate} className="field h-[46px] py-0" />
        </label>
        <label className="flex flex-col gap-1.5">
          <FieldLabel>{copy.events.emojiLabel}</FieldLabel>
          <input name="emoji" defaultValue={event.emoji ?? ""} maxLength={8} className="field h-[46px] py-0" />
        </label>
        <div>
          <button type="submit" className="btn btn-primary min-h-11 px-4 text-[13px]">{copy.events.save}</button>
        </div>
      </form>
    </details>
  );
}
