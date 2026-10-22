import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { viewerFor } from "@/lib/permissions";
import { TimezoneField } from "../../new/timezone-field";
import { deleteAction, pauseHereAction, settingsAction } from "./actions";

export const instant = false;

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
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">Settings</h1>

      {notices.saved ? <Notice>Saved.</Notice> : null}
      {notices.error === "confirm" ? (
        <Notice tone="danger">Type the loop&apos;s name exactly to delete it.</Notice>
      ) : null}

      <datalist id="timezones">
        {ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <form action={settingsAction} className="card mt-5 p-5">
        <input type="hidden" name="groupId" value={id} />

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-soft">Name</span>
          <input name="name" defaultValue={group.name} required className="field h-[46px] py-0" />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Day</span>
            <select name="weekday" defaultValue={String(group.promptWeekday)} className="field h-[46px] py-0">
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Time</span>
            <select name="hour" defaultValue={String(group.promptHour)} className="field h-[46px] py-0">
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
            <select name="cadence" defaultValue={String(group.cadenceWeeks)} className="field h-[46px] py-0">
              <option value="1">week</option>
              <option value="2">2 weeks</option>
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            name="shareEnabled"
            defaultChecked={group.shareEnabled}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Anyone with an issue&apos;s share link can read it.
            <span className="mt-0.5 block text-[13px] text-ink-muted">Off by default.</span>
          </span>
        </label>

        <button type="submit" className="btn btn-primary mt-5">
          Save changes
        </button>
      </form>

      <div className="card mt-3 p-5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
          {group.pausedAt ? "The loop is paused" : "Pause this loop"}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? "Resuming starts the rhythm again from today."
            : "Nothing goes out until you resume. Nobody is removed."}
        </p>
        <form action={pauseHereAction} className="mt-3">
          <input type="hidden" name="groupId" value={id} />
          <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
          <button type="submit" className="btn btn-quiet">
            {group.pausedAt ? "Resume" : "Pause"}
          </button>
        </form>
      </div>

      <form action={deleteAction} className="card mt-3 border-danger/30 p-5">
        <input type="hidden" name="groupId" value={id} />
        <input type="hidden" name="name" value={group.name} />
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Delete the loop</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          Every round, answer, and comment goes with it. Type <strong>{group.name}</strong> to confirm.
        </p>
        <input
          name="confirm"
          required
          aria-label="Loop name"
          placeholder={group.name}
          className="field mt-3 h-[46px] py-0"
        />
        <button type="submit" className="btn mt-3 bg-danger text-white hover:opacity-90">
          Delete forever
        </button>
      </form>
    </main>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return (
    <div
      className={`settle mt-4 rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${
        tone === "danger"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-accent-line bg-accent-soft text-accent-ink"
      }`}
    >
      {children}
    </div>
  );
}
