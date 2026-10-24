"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { createLoopAction, type CreateState } from "./actions";
import { TimezoneField } from "./timezone-field";
import { Tape } from "@/components/stationery";
import { Picker } from "@/components/picker";
import { copy, text } from "@/lib/copy";

const WEEKDAYS = copy.common.weekdays;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: String(index), label: day }));
const HOUR_OPTIONS = HOURS.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }));
const CADENCE_OPTIONS = [{ value: "1", label: copy.common.week }, { value: "2", label: copy.common.twoWeeks }];

type Props = { bank: Array<{ group: string; questions: string[] }> };

export function NewLoopForm({ bank }: Props) {
  const [state, action, pending] = useActionState(createLoopAction, {} as CreateState);
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState<Array<{ id: number; value: string }>>([]);
  const nextCustomId = useRef(0);

  const addCustom = () => {
    const id = nextCustomId.current++;
    setCustom((current) => [...current, { id, value: "" }]);
  };

  const updateCustom = (id: number, value: string) =>
    setCustom((current) => current.map((question) => question.id === id ? { ...question, value } : question));

  const removeCustom = (id: number) =>
    setCustom((current) => current.filter((question) => question.id !== id));

  const toggle = (text: string) =>
    setPicked((current) =>
      current.includes(text) ? current.filter((value) => value !== text) : [...current, text],
    );

  const customCount = custom.filter((question) => question.value.trim()).length;
  const questionCount = picked.length + customCount;

  return (
    <form action={action} className="flex flex-col gap-6">
      <label className="card flex flex-col gap-2 p-5 pt-7">
        <Tape tone="stripe" position="right" />
        <span className="font-display text-[23px] font-bold text-ink">{copy.newLoop.nameLabel}</span>
        <input
          name="name"
          required
          maxLength={60}
          placeholder={copy.newLoop.namePlaceholder}
          className="field h-[46px] py-0"
        />
      </label>

      <div className="card grid grid-cols-2 gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.day}</span>
          <Picker name="weekday" defaultValue="5" options={WEEKDAY_OPTIONS} ariaLabel={copy.newLoop.day} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.time}</span>
          <Picker name="hour" defaultValue="9" options={HOUR_OPTIONS} ariaLabel={copy.newLoop.time} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.timezone}</span>
          <TimezoneField />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.every}</span>
          <Picker name="cadence" defaultValue="1" options={CADENCE_OPTIONS} ariaLabel={copy.newLoop.every} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-soft">
          {copy.newLoop.questionsLabel} {questionCount > 0 ? text(copy.newLoop.picked, { count: questionCount }) : ""}
        </p>
        {bank.map((group) => (
          <div key={group.group} className="card p-2">
            <p className="px-2 py-1 text-[12px] font-medium uppercase tracking-wide text-ink-muted">
              {group.group}
            </p>
            <div className="flex flex-col">
              {group.questions.map((text) => (
                <label
                  key={text}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-field"
                >
                  <input
                    type="checkbox"
                    name="question"
                    value={text}
                    checked={picked.includes(text)}
                    onChange={() => toggle(text)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span className="text-[15px] leading-snug text-ink">{text}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.customLabel}</span>
          <button
            type="button"
            onClick={addCustom}
            aria-label={copy.newLoop.addCustomAriaLabel}
            className="btn btn-quiet h-11 min-h-11 w-11 px-0 text-[24px] leading-none"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>

        {custom.map((question, index) => (
          <div key={question.id} className="card flex items-center gap-2 p-3">
            <input
              name="question"
              value={question.value}
              onChange={(event) => updateCustom(question.id, event.target.value)}
              maxLength={200}
              autoFocus
              placeholder={copy.newLoop.customPlaceholder}
              aria-label={text(copy.newLoop.customQuestionAriaLabel, { number: index + 1 })}
              className="field h-[46px] min-w-0 flex-1 py-0"
            />
            <button
              type="button"
              onClick={() => removeCustom(question.id)}
              aria-label={text(copy.newLoop.removeCustomAriaLabel, { number: index + 1 })}
              className="btn btn-quiet h-10 min-h-10 w-10 flex-none px-0 text-[20px]"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>

      {state.error ? (
        <p role="alert" className="text-[14px] leading-snug text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? copy.newLoop.creating : copy.newLoop.create}
        </button>
        <Link href="/you" className="text-[14px] font-medium text-ink-soft hover:text-ink">
          {copy.newLoop.cancel}
        </Link>
      </div>
    </form>
  );
}
