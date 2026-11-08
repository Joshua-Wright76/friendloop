"use client";

import { SafeForm } from "@/components/safe-form";
import { useState } from "react";
import Link from "next/link";
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
import { formatHour } from "@/lib/format";
import { useLoopData } from "../loop-data";
import { SubmitButton } from "@/components/submit-button";

const WEEKDAYS = copy.common.weekdays;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: String(index), label: day }));
const HOUR_OPTIONS = HOURS.map((hour) => ({ value: String(hour), label: formatHour(hour) }));
const CADENCE_OPTIONS = copy.newLoop.cadences;

export default function SettingsTab({ notices }: { notices: { saved?: string; error?: string; shares?: string; stationery?: string } }) {
  const { group, membership } = useLoopData();
  const id = group.id;
  const isOwner = membership.access === "owner";
  const [confirmation, setConfirmation] = useState("");
  const [nameError, setNameError] = useState(false);
  const [view, setView] = useState<"details" | "paper" | "keep" | "danger">(() =>
    notices.stationery || notices.error === "stationery" ? "paper" : notices.shares || notices.error === "confirm" ? "danger" : "details",
  );
  // The same comparison the server makes; the server still checks.
  const confirmed = confirmation.trim() === group.name.trim();

  if (!isOwner) redirect(`/g/${id}`);

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={id} name={group.name} access={membership.access} active="Settings">
        <h1>{copy.settings.title}</h1>
        <div className="subtabs" role="group" aria-label={copy.settings.tabsLabel}>
          {([["details", copy.settings.groupDetails], ["paper", copy.settings.groupPaper], ["keep", copy.settings.groupKeep], ["danger", copy.settings.groupDanger]] as const).map(([key, label]) => (
            <button key={key} type="button" className="subtab" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
          ))}
        </div>
      </LoopNav>

      {notices.saved ? <NoticeFocus>{copy.settings.savedNotice}</NoticeFocus> : null}
      {notices.shares ? <NoticeFocus key={notices.shares}>{copy.settings.sharesResetNotice}</NoticeFocus> : null}
      {notices.stationery === "1" ? <NoticeFocus>{copy.stationery.saved}</NoticeFocus> : null}
      {notices.stationery === "adjusted" ? <NoticeFocus>{copy.stationery.savedAdjusted}</NoticeFocus> : null}
      {notices.error === "stationery" ? <NoticeFocus tone="danger">{copy.stationery.error}</NoticeFocus> : null}
      {notices.error === "confirm" ? (
        <NoticeFocus tone="danger">{copy.settings.confirmError}</NoticeFocus>
      ) : null}

      <SafeForm
        action={settingsAction}
        id="settings-details"
        hidden={view !== "details"}
        noValidate
        validate={(form) => {
          const field = form.elements.namedItem("name") as HTMLInputElement;
          if (field.value.trim()) { setNameError(false); return true; }
          setNameError(true);
          field.focus();
          return false;
        }}
        className="card mt-4 p-5"
      >
        <input type="hidden" name="groupId" value={id} />
        <label className="flex flex-col gap-1.5">
          <FieldLabel required>{copy.settings.name}</FieldLabel>
          <input name="name" defaultValue={group.name} required aria-invalid={nameError || undefined} aria-describedby={nameError ? "settings-name-error" : undefined} onChange={() => setNameError(false)} className="field h-[46px] py-0" />
        </label>
        {nameError ? <p id="settings-name-error" role="alert" className="m-0 mt-1.5 text-[14px] font-bold text-danger">{copy.settings.nameRequired}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.every}</span>
            <Picker name="cadence" defaultValue={String(group.cadenceWeeks)} options={CADENCE_OPTIONS} ariaLabel={copy.settings.every} />
          </div>
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
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5 lg:col-span-1">
            <span className="text-[13px] font-medium text-ink-soft">{copy.settings.timezone}</span>
            <TimezoneField defaultValue={group.timezone} />
          </div>
        </div>

        <h2 className="mt-5 border-t border-dashed border-line pt-4 text-ink">{copy.settings.readersGroup}</h2>
        <label className="mt-2 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            name="shareEnabled"
            defaultChecked={group.shareEnabled}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            {copy.settings.sharing}
            <span className="mt-0.5 block text-[13px] text-ink-muted">{copy.settings.sharingDefault}</span>
            {group.shareEnabled ? <span className="block"><Link href={`/g/${id}/issues`} className="link text-[13px]">{copy.settings.sharingWhere}</Link></span> : null}
          </span>
        </label>

        {group.shareEnabled ? null : (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{copy.settings.sharesOff}</p>
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
      </SafeForm>

      <div hidden={view !== "paper"}>
      <StationeryForm
        groupId={id}
        preset={group.themePreset}
        accent={group.themeAccent}
        loopName={group.name}
        background={group.themeBackground}
        paperPack={group.themePaperPack}
        tapePack={group.themeTapePack}
        mascot={group.themeMascot}
        headerImageUrl={group.headerImageUrl}
      />
      {/* The owner's own look lives with their card on People; this is the way there from the loop's look. */}
      <section className="card mt-4 p-5" aria-labelledby="your-look-title">
        <h2 id="your-look-title" className="text-ink">{copy.settings.yourLookTitle}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.settings.yourLookBody}</p>
        <Link href={`/g/${id}/members?look=open#your-look`} className="link mt-1">{copy.settings.yourLookLink}</Link>
      </section>
      </div>

      <div id="settings-keep" hidden={view !== "keep"} className="card mt-4 p-5">
        <h2 className="text-ink">
          {group.pausedAt ? copy.settings.pausedTitle : copy.settings.pauseTitle}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? copy.settings.resumeDescription
            : copy.settings.pauseDescription}
        </p>
        <SafeForm action={pauseHereAction} className="mt-3">
          <input type="hidden" name="groupId" value={id} />
          <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
          <SubmitButton className="btn btn-quiet">
            {group.pausedAt ? copy.settings.resume : copy.settings.pause}
          </SubmitButton>
        </SafeForm>

        <div className="mt-4 border-t border-dashed border-line pt-4">
          <h2 className="text-ink">{copy.settings.archiveTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.settings.archiveBody}</p>
          <a href={`/g/${id}/export`} download className="btn btn-quiet mt-3">{copy.settings.archive}</a>
        </div>
      </div>

      <div id="settings-danger" hidden={view !== "danger"} className="danger-zone mt-4">
      <h2 className="mb-3 text-danger">{copy.settings.dangerTitle}</h2>
      {group.shareEnabled ? (
        <section className="mb-5 border-b border-dashed border-line-strong pb-4">
          <h3 className="text-[22px] text-ink">{copy.settings.sharesTitle}</h3>
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

      <SafeForm action={deleteAction}>
        <input type="hidden" name="groupId" value={id} />
        <input type="hidden" name="name" value={group.name} />
        <h3 className="text-[22px] text-ink">{copy.settings.deleteTitle}</h3>
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
          className="btn btn-danger mt-3 hover:opacity-90"
        >
          {copy.settings.delete}
        </SubmitButton>
        {confirmed ? null : <p className="m-0 mt-2 text-[13px] text-ink-soft">{copy.settings.deleteHint}</p>}
      </SafeForm>
      </div>
    </main>
  );
}
