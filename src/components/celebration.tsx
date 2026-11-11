"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Envelope } from "@/components/stationery";
import { seededRandom } from "@/lib/seal-art";
import { DEFAULT_MASCOT, isMascotKey, stickerSrc } from "@/lib/stickers";

/**
 * A small moment when someone's answers are in: the owner's choice of confetti,
 * petals, stars, the mascot hopping, or an envelope flying off. It is laid over the
 * page and takes no taps, a screen reader never hears it, it plays once and goes, and
 * under reduced motion the stylesheet keeps it from showing at all. The confirmation
 * underneath says everything that matters.
 */

/** How long the longest of them runs, with a little room to finish. */
export const CELEBRATION_MS = 3600;

const CONFETTI = ["var(--accent)", "var(--accent-line)", "var(--tape)", "var(--accent-ink)", "#f2c14e", "#a9dec9"];
const PETALS = ["var(--accent-line)", "var(--accent-soft)", "var(--tape)"];

type Bit = { className: string; style: CSSProperties; children?: ReactNode };

const px = (n: number) => `${n.toFixed(1)}px`;
const s = (n: number) => `${n.toFixed(2)}s`;

function bits(kind: string, mascot: string, seed: number): Bit[] {
  const random = seededRandom(`${kind}:${seed}`);
  const between = (low: number, high: number) => low + random() * (high - low);
  switch (kind) {
    case "confetti":
      return Array.from({ length: 64 }, (_, index) => ({
        className: "fx fx--confetti",
        style: {
          left: `calc(50% + ${px(between(-70, 70))})`,
          background: CONFETTI[index % CONFETTI.length],
          "--dx": px(between(-190, 190)),
          "--dy": px(between(-520, -220)),
          "--rot": `${between(-720, 720).toFixed(0)}deg`,
          "--dur": s(between(1.5, 2.4)),
          "--delay": s(between(0, 0.12)),
        } as CSSProperties,
      }));
    case "petals":
      return Array.from({ length: 30 }, (_, index) => ({
        className: "fx fx--petal",
        style: {
          left: `${between(2, 96).toFixed(1)}%`,
          background: PETALS[index % PETALS.length],
          "--sway": px(between(-46, 46)),
          "--dur": s(between(2.2, 3.2)),
          "--delay": s(between(0, 0.7)),
        } as CSSProperties,
      }));
    case "stars":
      return Array.from({ length: 22 }, (_, index) => {
        const angle = (index / 22) * Math.PI * 2;
        const reach = between(100, 220);
        return {
          className: "fx fx--star",
          style: {
            "--dx": px(Math.cos(angle) * reach),
            "--dy": px(Math.sin(angle) * reach * 0.9 - 150),
            "--rot": `${between(-180, 180).toFixed(0)}deg`,
            "--scale": between(0.6, 1.5).toFixed(2),
            "--dur": s(between(0.9, 1.5)),
            "--delay": s(between(0, 0.1)),
            color: index % 4 === 0 ? "var(--accent)" : "#f2c14e",
          } as CSSProperties,
          children: (
            <svg viewBox="-12 -12 24 24"><path d="M0-11Q1.8-1.8 11 0Q1.8 1.8 0 11Q-1.8 1.8-11 0Q-1.8-1.8 0-11z" fill="currentColor" /></svg>
          ),
        };
      });
    case "hop":
      return [
        {
          className: "fx fx--hop",
          style: {},
          // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
          children: <img src={stickerSrc(mascot)} alt="" width={88} height={88} />,
        },
        ...Array.from({ length: 7 }, (_, index) => ({
          className: "fx fx--heart",
          style: {
            left: `calc(50% + ${px(between(-50, 50))})`,
            "--dx": px(between(-60, 60)),
            "--delay": s(1 + index * 0.08),
            color: index % 2 ? "var(--accent)" : "var(--accent-line)",
          } as CSSProperties,
          children: (
            <svg viewBox="-10 -9 20 18"><path d="M0 7C-7 2-9-1-9-4a4.7 4.7 0 0 1 9-2 4.7 4.7 0 0 1 9 2c0 3-2 6-9 11z" fill="currentColor" /></svg>
          ),
        })),
      ];
    default:
      return [
        { className: "fx fx--envelope", style: {}, children: <Envelope /> },
        ...Array.from({ length: 12 }, (_, index) => ({
          className: "fx fx--trail",
          style: {
            "--x": px(index * 16),
            "--y": px(-index * 44 - 40),
            "--delay": s(0.45 + index * 0.06),
          } as CSSProperties,
        })),
      ];
  }
}

export function Celebration({ kind, mascot, seed, onEnd, contained = false }: {
  kind: string;
  mascot: string | null | undefined;
  seed: number;
  onEnd: () => void;
  /** Inside a small stage (the settings' preview) rather than over the whole page. */
  contained?: boolean;
}) {
  useEffect(() => {
    const timer = setTimeout(onEnd, CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [onEnd]);
  return (
    <div className={`celebration celebration--${kind}${contained ? " celebration--contained" : ""}`} aria-hidden="true" data-testid="celebration">
      {bits(kind, isMascotKey(mascot) ? mascot : DEFAULT_MASCOT, seed).map((bit, index) => (
        <i key={index} className={bit.className} style={bit.style}>{bit.children}</i>
      ))}
    </div>
  );
}
