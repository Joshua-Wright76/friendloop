"use client";

import { useEffect, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";
import { signatureBox, signatureFit, signaturePath } from "@/lib/looks";

/**
 * Someone's signature, drawn from their pen strokes in the loop's ink. It names who
 * signed for anyone who can't see it. With `draw`, it writes itself in once, the
 * first time it scrolls into view; never for anyone who asked for less motion, and
 * until the page is running it simply shows, finished.
 */
export function SignatureInk({
  strokes,
  name,
  maxWidth = 200,
  maxHeight = 64,
  draw = false,
  className = "",
}: {
  strokes: number[][];
  name: string;
  maxWidth?: number;
  maxHeight?: number;
  draw?: boolean;
  className?: string;
}) {
  const node = useRef<SVGSVGElement>(null);
  const [ink, setInk] = useState<"still" | "waiting" | "drawing">("still");
  useEffect(() => {
    const svg = node.current;
    if (!draw || !svg || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting);
      setInk((current) => (current === "drawing" ? current : seen ? "drawing" : "waiting"));
      if (seen) observer.disconnect();
    }, { threshold: 0.6 });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [draw]);

  const box = signatureBox(strokes);
  const size = signatureFit(strokes, maxWidth, maxHeight);
  return (
    <svg
      ref={node}
      role="img"
      aria-label={text(copy.signatures.signed, { name })}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={size.width}
      height={size.height}
      className={`signature-ink ${className}`.trim()}
      data-ink={ink}
    >
      <path d={signaturePath(strokes)} pathLength={1} />
    </svg>
  );
}
