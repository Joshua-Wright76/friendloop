import { copy, text } from "@/lib/copy";
import type { DailyUsage } from "@/lib/stats";

const WIDTH = 760;
const HEIGHT = 250;
const LEFT = 42;
const RIGHT = 18;
const TOP = 18;
const BOTTOM = 42;

function dayLabel(day: string, withYear = false): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function ActivityChart({ data }: { data: DailyUsage[] }) {
  const c = copy.devStats.chart;
  if (data.length === 0) return <p className="py-10 text-center text-[14px] text-ink-muted">{c.empty}</p>;

  const peak = Math.max(...data.flatMap((row) => [row.answers, row.activePeople]));
  const axisMax = Math.max(2, Math.ceil(peak / 2) * 2);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const point = (value: number, index: number): [number, number] => [
    LEFT + (index / Math.max(1, data.length - 1)) * plotWidth,
    TOP + plotHeight - (value / axisMax) * plotHeight,
  ];
  const pathFor = (key: "answers" | "activePeople") =>
    data.map((row, index) => point(row[key], index).join(",")).join(" ");
  const answerPoints = data.map((row, index) => point(row.answers, index));
  const area = answerPoints.length
    ? `M ${answerPoints[0][0]} ${TOP + plotHeight} L ${answerPoints.map(([x, y]) => `${x} ${y}`).join(" L ")} L ${answerPoints.at(-1)![0]} ${TOP + plotHeight} Z`
    : "";
  const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  const totalAnswers = data.reduce((sum, row) => sum + row.answers, 0);

  return (
    <figure className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-bold text-ink-soft" aria-hidden="true">
          <span className="inline-flex items-center gap-2"><i className="h-0.5 w-5 bg-accent" />{c.answers}</span>
          <span className="inline-flex items-center gap-2"><i className="h-0.5 w-5 border-t-2 border-dashed border-success" />{c.activePeople}</span>
        </div>
        <span className="text-[12px] text-ink-muted">{text(c.total, { count: totalAnswers })}</span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={text(c.description, {
          from: dayLabel(data[0].day, true),
          to: dayLabel(data.at(-1)!.day, true),
          answers: totalAnswers,
        })}
      >
        <defs>
          <linearGradient id="operations-activity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {[axisMax, axisMax / 2, 0].map((tick) => {
          const y = TOP + plotHeight - (tick / axisMax) * plotHeight;
          return (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="var(--line)" strokeDasharray={tick === 0 ? undefined : "3 5"} />
              <text x={LEFT - 10} y={y + 4} textAnchor="end" fill="var(--ink-muted)" fontSize="11">{tick}</text>
            </g>
          );
        })}
        {totalAnswers > 0 ? <path d={area} fill="url(#operations-activity-fill)" /> : null}
        <polyline points={pathFor("answers")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={pathFor("activePeople")} fill="none" stroke="var(--success)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {labelIndexes.map((index) => {
          const x = point(0, index)[0];
          return (
            <text key={index} x={x} y={HEIGHT - 10} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} fill="var(--ink-muted)" fontSize="11">
              {dayLabel(data[index].day)}
            </text>
          );
        })}
      </svg>

      {totalAnswers === 0 ? <p className="mt-2 text-center text-[13px] text-ink-muted">{c.noActivity}</p> : null}
      <details className="mt-4 border-t border-line pt-3 text-[13px]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold text-accent-ink">{c.showData}</summary>
        <div className="max-h-80 overflow-auto rounded-md border border-line" tabIndex={0} role="region" aria-label={c.showData}>
          <table className="w-full text-left text-ink">
            <caption className="sr-only">{c.showData}</caption>
            <thead className="bg-accent-soft text-ink-soft">
              <tr><th scope="col" className="px-3 py-2">{c.day}</th><th scope="col" className="px-3 py-2">{c.answers}</th><th scope="col" className="px-3 py-2">{c.activePeople}</th><th scope="col" className="px-3 py-2">{c.rounds}</th></tr>
            </thead>
            <tbody>
              {data.map((row) => <tr key={row.day} className="border-t border-line"><th scope="row" className="px-3 py-2 font-medium">{dayLabel(row.day, true)}</th><td className="px-3 py-2">{row.answers}</td><td className="px-3 py-2">{row.activePeople}</td><td className="px-3 py-2">{row.rounds}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
