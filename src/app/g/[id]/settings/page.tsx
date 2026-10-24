import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { viewerFor } from "@/lib/permissions";
import { TimezoneField } from "../../new/timezone-field";
import { deleteAction, pauseHereAction, settingsAction } from "./actions";
import { LoopNav } from "@/components/loop-nav";
import { Picker } from "@/components/picker";
import { copy } from "@/lib/copy";

export const instant = false;

const WEEKDAYS = copy.common.weekdays;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: String(index), label: day }));
const HOUR_OPTIONS = HOURS.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }));
const CADENCE_OPTIONS = [{ value: "1", label: copy.common.week }, { value: "2", label: copy.common.twoWeeks }];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const notices = await searchParams;

  const viewer = await viewerFor(id);
  if (!viewer) notFound();

  const [group] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!group) notFound();

  // Only the owner sees this page at all; everyone else is sent back to the loop.
  if (viewer.membership.access !== "owner") redirect(`/g/${id}`);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>
      <LoopNav id={id} active="Settings" isOwner />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.settings.title}</h1>

      {notices.saved ? <Notice>{copy.settings.savedNotice}</Notice> : null}
      {notices.error === "confirm" ? (
        <Notice tone="danger">{copy.settings.confirmError}</Notice>
      ) : null}

      <form action={settingsAction} className="card mt-5 p-5">
        <input type="hidden" name="groupId" value={id} />

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">{copy.settings.name}</span>
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
          <div className="flex flex-col gap-1.5">
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

        <button type="submit" className="btn btn-primary mt-5">
          {copy.settings.save}
        </button>
      </form>

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
          <button type="submit" className="btn btn-quiet">
            {group.pausedAt ? copy.settings.resume : copy.settings.pause}
          </button>
        </form>
      </div>

      <form action={deleteAction} className="card mt-3 border-danger/30 p-5">
        <input type="hidden" name="groupId" value={id} />
        <input type="hidden" name="name" value={group.name} />
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.settings.deleteTitle}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          {copy.settings.deleteDescriptionPrefix} <strong>{group.name}</strong> {copy.settings.deleteDescriptionSuffix}
        </p>
        <input
          name="confirm"
          required
          aria-label={copy.settings.deleteAriaLabel}
          placeholder={group.name}
          className="field mt-3 h-[46px] py-0"
        />
        <button type="submit" className="btn btn-danger mt-3 hover:opacity-90">
          {copy.settings.delete}
        </button>
      </form>
    </main>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return (
    <div
      role="status"
      className={`settle mt-4 rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${
        tone === "danger"
          ? "notice border-danger/40 bg-danger/10 text-danger"
          : "notice border-accent-line bg-accent-soft text-ink"
      }`}
    >
      {children}
    </div>
  );
}
