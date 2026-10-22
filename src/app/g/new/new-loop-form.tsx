"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createLoopAction, type CreateState } from "./actions";
import { TimezoneField } from "./timezone-field";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const ZONES = [
  "Europe/Amsterdam",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Lisbon",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

type Props = { bank: Array<{ group: string; questions: string[] }> };

export function NewLoopForm({ bank }: Props) {
  const [state, action, pending] = useActionState(createLoopAction, {} as CreateState);
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (text: string) =>
    setPicked((current) =>
      current.includes(text) ? current.filter((value) => value !== text) : [...current, text],
    );

  return (
    <form action={action} className="flex flex-col gap-5">
      <datalist id="timezones">
        {ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">Name</span>
        <input
          name="name"
          required
          maxLength={60}
          placeholder="Friday Loop"
          className="field h-[46px] py-0"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-ink-soft">Who writes</legend>
        <label className="card flex cursor-pointer items-start gap-3 p-4">
          <input type="radio" name="mode" value="group" defaultChecked className="mt-1 accent-[var(--accent)]" />
          <span>
            <span className="block text-[15px] font-medium text-ink">Everyone</span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
              Each person gets the questions and answers them. The usual.
            </span>
          </span>
        </label>
        <label className="card flex cursor-pointer items-start gap-3 p-4">
          <input type="radio" name="mode" value="from_you" className="mt-1 accent-[var(--accent)]" />
          <span>
            <span className="block text-[15px] font-medium text-ink">Just you</span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
              You write every round; everyone else reads.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Day</span>
          <select name="weekday" defaultValue="5" className="field h-[46px] py-0">
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Time</span>
          <select name="hour" defaultValue="9" className="field h-[46px] py-0">
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Timezone</span>
          <TimezoneField />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Every</span>
          <select name="cadence" defaultValue="1" className="field h-[46px] py-0">
            <option value="1">week</option>
            <option value="2">2 weeks</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-soft">
          Questions {picked.length > 0 ? `· ${picked.length} picked` : ""}
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

        <label className="mt-1 flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Your own, one per line</span>
          <textarea name="custom" rows={3} placeholder="What did you learn this week?" className="field" />
        </label>
      </div>

      {state.error ? (
        <p role="alert" className="text-[14px] leading-snug text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Creating…" : "Create loop"}
        </button>
        <Link href="/you" className="text-[14px] font-medium text-ink-soft hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}
