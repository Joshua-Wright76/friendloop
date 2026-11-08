"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FieldLabel } from "@/components/field-label";
import { Picker } from "@/components/picker";
import { copy, text } from "@/lib/copy";
import { ITEM_DESCRIPTION_MAX, ITEM_EMOJI_MAX, ITEM_TEXT_MAX } from "@/lib/item-limits";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX } from "@/lib/poll";
import type { AnswerFormat, AskFrequency } from "@/lib/asks";
import { useLoopData, type PageItem } from "../loop-data";

const FORMATS = ["written", "poll", "photo_wall", "music"] as const satisfies readonly AnswerFormat[];
const FREQUENCIES = ["rotating", "every_round", "on_date"] as const satisfies readonly AskFrequency[];

/**
 * Everything an item is, as form fields: its words, how it's answered, how often
 * it's asked (with the date or the person for an item on a date), and, folded
 * away, its emoji, description and who answers it. The add card and each row's
 * editor share these, so an item reads the same way wherever it's made or changed.
 */
export function ItemFields({ item, defaultFrequency, onFrequencyChange }: {
  /** The item being edited; absent on the add card. */
  item?: PageItem;
  defaultFrequency: AskFrequency;
  onFrequencyChange?: (frequency: AskFrequency) => void;
}) {
  const { people } = useLoopData();
  const id = useId();
  const [format, setFormat] = useState<AnswerFormat>(item?.format ?? "written");
  const [frequency, setFrequency] = useState<AskFrequency>(item?.frequency ?? defaultFrequency);
  const [dateKind, setDateKind] = useState<"once" | "birthday">(item?.dateKind ?? "once");
  const birthday = frequency === "on_date" && dateKind === "birthday";
  const locked = item?.answered ?? false;
  const optionsOpen = Boolean(item && (item.emoji || item.description || item.adminOnly));
  const named = (person: (typeof people)[number]) => person.name ?? person.email.split("@")[0];

  return (
    <>
      {birthday ? null : (
        <label className="flex flex-col gap-1.5">
          <FieldLabel required>{copy.questions.item.textLabel}</FieldLabel>
          <input
            name="text"
            required
            maxLength={ITEM_TEXT_MAX}
            defaultValue={item?.text ?? ""}
            placeholder={copy.questions.item.textPlaceholder}
            className="field h-[46px] py-0"
          />
        </label>
      )}

      <div className="item-choices">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{copy.questions.item.formatLabel}</FieldLabel>
          <Picker
            name="format"
            defaultValue={format}
            value={format}
            disabled={locked}
            describedBy={`${id}-format`}
            ariaLabel={copy.questions.item.formatLabel}
            onValueChange={(next) => setFormat(next as AnswerFormat)}
            options={FORMATS.map((value) => ({ value, label: copy.questions.item.formats[value] }))}
          />
          <p id={`${id}-format`} className="m-0 text-[13px] leading-snug text-ink-muted">
            {locked ? copy.questions.item.formatLocked : copy.questions.item.formatHints[format]}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{copy.questions.item.frequencyLabel}</FieldLabel>
          <Picker
            name="frequency"
            defaultValue={frequency}
            value={frequency}
            ariaLabel={copy.questions.item.frequencyLabel}
            onValueChange={(next) => {
              setFrequency(next as AskFrequency);
              onFrequencyChange?.(next as AskFrequency);
            }}
            options={FREQUENCIES.map((value) => ({ value, label: copy.questions.item.frequencies[value] }))}
          />
        </div>
      </div>

      {format === "poll" ? <PollOptions item={item} locked={locked} /> : null}

      {frequency === "on_date" ? (
        <div className="item-date flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{copy.questions.item.dateKindLabel}</FieldLabel>
            <Picker
              name="dateKind"
              defaultValue={dateKind}
              value={dateKind}
              ariaLabel={copy.questions.item.dateKindLabel}
              onValueChange={(next) => setDateKind(next === "birthday" ? "birthday" : "once")}
              options={(["once", "birthday"] as const).map((value) => ({ value, label: copy.questions.item.dateKinds[value] }))}
            />
          </div>
          {birthday ? (
            <div className="flex flex-col gap-1.5">
              <FieldLabel required>{copy.questions.item.personLabel}</FieldLabel>
              <Picker
                name="aboutMembershipId"
                defaultValue={item?.aboutMembershipId ?? people[0]?.id ?? ""}
                ariaLabel={copy.questions.item.personLabel}
                options={people.map((person) => ({ value: person.id, label: named(person) }))}
              />
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <FieldLabel required>{copy.questions.item.dateLabel}</FieldLabel>
            <input name="date" type="date" required defaultValue={item?.inputDate ?? ""} aria-describedby={birthday ? `${id}-birthday` : undefined} className="field h-[46px] py-0" />
          </label>
          {birthday ? <p id={`${id}-birthday`} className="m-0 text-[13px] leading-relaxed text-ink-muted">{copy.questions.item.birthdayHint}</p> : null}
        </div>
      ) : null}

      <details className="fold" open={optionsOpen}>
        <summary>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="fold-chevron">
            <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {copy.questions.item.optionsSummary}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{copy.questions.item.emojiLabel}</FieldLabel>
              <input name="emoji" maxLength={ITEM_EMOJI_MAX} defaultValue={item?.emoji ?? ""} placeholder="✨" className="field emoji-field h-[46px] py-0 text-center" />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{copy.questions.item.descriptionLabel}</FieldLabel>
              <input name="description" maxLength={ITEM_DESCRIPTION_MAX} defaultValue={item?.description ?? ""} placeholder={copy.questions.item.descriptionPlaceholder} className="field h-[46px] py-0" />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" name="adminOnly" defaultChecked={item?.adminOnly ?? false} className="h-5 w-5 accent-accent" /> {copy.questions.item.adminOnly}
          </label>
        </div>
      </details>
    </>
  );
}

/** A poll starts with the two options it needs; more appear one at a time, up to six. */
function PollOptions({ item, locked }: { item?: PageItem; locked: boolean }) {
  const initial = item?.pollOptions?.length ? item.pollOptions : [];
  const [count, setCount] = useState(Math.max(2, initial.length));
  const added = useRef(false);
  const list = useRef<HTMLDivElement>(null);

  // The new field takes focus, so the keyboard carries on typing where the option appeared.
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    list.current?.querySelectorAll("input")[count - 1]?.focus();
  }, [count]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={list} className="flex flex-col gap-2">
        {Array.from({ length: count }, (_, index) => (
          <label key={index} className="flex flex-col gap-1.5">
            <FieldLabel required={index < 2}>{text(copy.polls.authoring.optionLabel, { number: index + 1 })}</FieldLabel>
            <input
              name="option"
              required={index < 2}
              readOnly={locked}
              maxLength={POLL_OPTION_MAX}
              defaultValue={initial[index] ?? ""}
              placeholder={copy.polls.authoring.optionPlaceholder}
              className="field h-[46px] py-0"
            />
          </label>
        ))}
      </div>
      {count < POLL_MAX_OPTIONS && !locked ? (
        <div>
          <button
            type="button"
            onClick={() => { added.current = true; setCount((current) => Math.min(current + 1, POLL_MAX_OPTIONS)); }}
            className="btn btn-quiet min-h-11 px-4 text-[13px]"
          >
            {copy.polls.authoring.addOption}
          </button>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-[14px] text-ink">
        <input type="checkbox" name="multiple" defaultChecked={item?.pollMultiple ?? false} disabled={locked} className="h-5 w-5 accent-accent" /> {copy.polls.authoring.multipleLabel}
      </label>
    </div>
  );
}
