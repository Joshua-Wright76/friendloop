"use client";

import { useState } from "react";
import { redirect } from "next/navigation";
import { TimezoneField } from "../../new/timezone-field";
import { deleteAction, pauseHereAction, rotateSharesAction, settingsAction } from "./actions";
import { LoopNav } from "@/components/loop-nav";
import { FieldLabel } from "@/components/field-label";
import { NoticeFocus } from "@/components/notice-focus";
import { StationeryForm } from "./stationery-form";
import { Picker } from "@/components/picker";
import { ConfirmAction } from "@/components/confirm-action";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";
import { SubmitButton } from "@/components/submit-button";

const WEEKDAYS = copy.common.weekdays;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: String(index), label: day }));
const HOUR_OPTIONS = HOURS.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }));
const CADENCE_OPTIONS = copy.newLoop.cadences;

export default function SettingsTab({ notices }: { notices: { saved?: string; error?: string; shares?: string; stationery?: string } }) {
  const { group, membership } = useLoopData();
  const id = group.id;
  const isOwner = membership.access === "owner";
  const [confirmation, setConfirmation] = useState("");
  // The same comparison the server makes; the server still checks.
  const confirmed = confirmation.trim() === group.name.trim();

  if (!isOwner) redirect(`/g/${id}`);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopNav id={id} name={group.name} access={membership.access} active="Settings" />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.settings.title}</h1>

      {notices.saved ? <NoticeFocus>{copy.settings.savedNotice}</NoticeFocus> : null}
      {notices.shares ? <NoticeFocus key={notices.shares}>{copy.settings.sharesResetNotice}</NoticeFocus> : null}
      {notices.stationery === "1" ? <NoticeFocus>{copy.stationery.saved}</NoticeFocus> : null}
      {notices.stationery === "adjusted" ? <NoticeFocus>{copy.stationery.savedAdjusted}</NoticeFocus> : null}
      {notices.error === "stationery" ? <NoticeFocus tone="danger">{copy.stationery.error}</NoticeFocus> : null}
      {notices.error === "confirm" ? (
        <NoticeFocus tone="danger">{copy.settings.confirmError}</NoticeFocus>
      ) : null}

      <form action={settingsAction} className="card mt-5 p-5">
        <input type="hidden" name="groupId" value={id} />

        <label className="flex flex-col gap-1.5">
          <FieldLabel required>{copy.settings.name}</FieldLabel>
          <input name="name" defaultValue={group.name} required className="field h-[46px] py-0" />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.day}</span>
            <Picker name="weekday" defaultValue={String(group.promptWeekday)} options={WEEKDAY_OPTIONS} ariaLabel={copy.settings.day} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.time}</span>
            <Picker name="hour" defaultValue={String(group.promptHour)} options={HOUR_OPTIONS} ariaLabel={copy.settings.time} />
          </div>
          {/* Full width, as on the new-loop form: zone names are long and a half
              column cuts "Europe/Amsterdam" to "Europe…" on a phone. */}
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.timezone}</span>
            <TimezoneField defaultValue={group.timezone} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.every}</span>
            <Picker name="cadence" defaultValue={String(group.cadenceWeeks)} options={CADENCE_OPTIONS} ariaLabel={copy.settings.every} />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            name="shareEnabled"
            defaultChecked={group.shareEnabled}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            {copy.settings.sharing}
            <span className="mt-0.5 block text-[13px] text-ink-muted">{copy.settings.sharingDefault}</span>
          </span>
        </label>

        {group.shareEnabled ? null : (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">{copy.settings.sharesOff}</p>
        )}

        <label className="mt-4 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            name="commentsEnabled"
            defaultChecked={group.commentsEnabled}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            {copy.settings.comments}
            <span className="mt-0.5 block text-[13px] text-ink-muted">{copy.settings.commentsHint}</span>
          </span>
        </label>

        <SubmitButton className="btn btn-primary mt-5">
          {copy.settings.save}
        </SubmitButton>
      </form>

      <StationeryForm
        groupId={id}
        preset={group.themePreset}
        accent={group.themeAccent}
        headerImageUrl={group.headerImageUrl}
      />

      {group.shareEnabled ? (
        <section className="card mt-3 p-5">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.settings.sharesTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.settings.sharesResetDescription}</p>
          {/* Resetting kills every link already sent, so it asks first (WCAG 3.3.4). */}
          <ConfirmAction
            className="mt-3"
            action={rotateSharesAction}
            fields={{ groupId: id }}
            label={copy.settings.sharesReset}
            triggerLabel={copy.settings.sharesReset}
            question={copy.a11yLabels.resetSharesQuestion}
            body={copy.a11yLabels.resetSharesBody}
            confirmLabel={copy.a11yLabels.resetSharesConfirm}
            cancelLabel={copy.a11yLabels.confirmCancel}
          />
        </section>
      ) : null}

      <div className="card mt-3 p-5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
          {group.pausedAt ? copy.settings.pausedTitle : copy.settings.pauseTitle}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? copy.settings.resumeDescription
            : copy.settings.pauseDescription}
        </p>
        <form action={pauseHereAction} className="mt-3">
          <input type="hidden" name="groupId" value={id} />
          <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
          <SubmitButton className="btn btn-quiet">
            {group.pausedAt ? copy.settings.resume : copy.settings.pause}
          </SubmitButton>
        </form>
      </div>

      <form action={deleteAction} className="card mt-3 border-danger/30 p-5">
        <input type="hidden" name="groupId" value={id} />
        <input type="hidden" name="name" value={group.name} />
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.settings.deleteTitle}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.settings.deleteDescription}</p>
        <label className="mt-3 flex flex-col gap-1.5">
          <FieldLabel required>{text(copy.settings.deleteConfirmLabel, { name: group.name })}</FieldLabel>
          <input
            name="confirm"
            required
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="field h-[46px] py-0"
          />
        </label>
        {/* aria-disabled, not disabled: it stays in the tab order and announces why it does nothing yet. */}
        <SubmitButton
          blocked={!confirmed}
          className="btn btn-danger mt-3 hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:opacity-45"
        >
          {copy.settings.delete}
        </SubmitButton>
      </form>
    </main>
  );
}
