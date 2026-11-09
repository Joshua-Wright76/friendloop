"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { copy } from "@/lib/copy";
import {
  inkWidths,
  SIGNATURE_BOARD,
  SIGNATURE_INK,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MAX_STROKES,
  signatureBox,
} from "@/lib/looks";
import { readUploadResponse } from "@/lib/upload-response";

type Status = "idle" | "saving" | "saved" | "removed" | "full" | "error";

/** Points closer than this on the board are the same point: a resting pen adds nothing. */
const MIN_STEP = 2;

/** Every stroke with the nib's width along it, scaled from the board onto a canvas. */
function drawStrokes(context: CanvasRenderingContext2D, strokes: number[][], scale: number, offset = { x: 0, y: 0 }) {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    const widths = inkWidths(stroke);
    const at = (i: number) => [(stroke[i * 2] - offset.x) * scale, (stroke[i * 2 + 1] - offset.y) * scale] as const;
    if (stroke.length === 2) {
      const [x, y] = at(0);
      context.beginPath();
      context.arc(x, y, (widths[0] * scale) / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    for (let i = 0; i < widths.length; i += 1) {
      const [x1, y1] = at(i);
      const [x2, y2] = at(i + 1);
      context.lineWidth = widths[i] * scale;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
  }
}

/** The strokes as the picture email shows: cropped to the ink, transparent, in the fixed ink. */
function signaturePng(strokes: number[][]): Promise<Blob | null> {
  const box = signatureBox(strokes);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.width);
  canvas.height = Math.ceil(box.height);
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.strokeStyle = SIGNATURE_INK;
  context.fillStyle = SIGNATURE_INK;
  drawStrokes(context, strokes, 1, box);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

const pointsIn = (strokes: number[][]) => strokes.reduce((sum, stroke) => sum + stroke.length / 2, 0);

/**
 * "Sign your letters": a pad you draw on with a finger, a pen or a mouse, and the
 * signature saved from it. Only the pad itself takes over touch, so the page still
 * scrolls everywhere else. It is decoration, entirely optional, and its buttons are
 * ordinary buttons; the pad takes no keyboard focus, so it never holds anyone there.
 */
export function SignaturePad({
  endpoint,
  initial,
  onSaved,
}: {
  /** The route that knows who you are: `/api/reply/<token>/signature` or `/api/loop/<id>/signature`. */
  endpoint: string;
  initial: number[][] | null;
  onSaved?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<number[][]>(initial ?? []);
  const [saved, setSaved] = useState<number[][] | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  // Ink on the pad that hasn't finished its stroke yet still hides the "Draw here".
  const [inking, setInking] = useState(false);
  const id = useId();
  const live = useRef<number[][]>(initial ?? []);
  const drawing = useRef<number | null>(null);
  const frame = useRef(0);

  const paint = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    // The pad's own ink follows the page (light or dark); the saved picture uses the fixed ink.
    const ink = getComputedStyle(element).color;
    context.strokeStyle = ink;
    context.fillStyle = ink;
    drawStrokes(context, live.current, (width / SIGNATURE_BOARD.width) * ratio);
  }, []);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    paint();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    resized?.observe(element);
    // Light and dark change the pad's ink.
    const scheme = new MutationObserver(() => schedule());
    scheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      resized?.disconnect();
      scheme.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [paint, schedule]);

  useEffect(() => {
    if (status !== "saved" && status !== "removed") return;
    const timer = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  /** Where the pointer is, on the 600×200 board. The pad keeps the board's shape, so one scale fits both axes. */
  function boardPoint(event: ReactPointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = SIGNATURE_BOARD.width / rect.width;
    const x = Math.min(SIGNATURE_BOARD.width, Math.max(0, (event.clientX - rect.left) * scale));
    const y = Math.min(SIGNATURE_BOARD.height, Math.max(0, (event.clientY - rect.top) * scale));
    return [Math.round(x), Math.round(y)];
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || status === "saving") return;
    if (live.current.length >= SIGNATURE_MAX_STROKES || pointsIn(live.current) >= SIGNATURE_MAX_POINTS) {
      setStatus("full");
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = event.pointerId;
    live.current = [...live.current, [...boardPoint(event)]];
    setInking(true);
    if (status !== "idle") setStatus("idle");
    schedule();
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    const stroke = live.current[live.current.length - 1];
    // A pen reports points between frames; each one makes the ink smoother.
    const points = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = SIGNATURE_BOARD.width / rect.width;
    const samples = points.length > 0
      ? points.map((point) => [
          Math.round(Math.min(SIGNATURE_BOARD.width, Math.max(0, (point.clientX - rect.left) * scale))),
          Math.round(Math.min(SIGNATURE_BOARD.height, Math.max(0, (point.clientY - rect.top) * scale))),
        ])
      : [boardPoint(event)];
    let total = pointsIn(live.current);
    for (const [x, y] of samples) {
      if (total >= SIGNATURE_MAX_POINTS) {
        setStatus("full");
        break;
      }
      const lastX = stroke[stroke.length - 2];
      const lastY = stroke[stroke.length - 1];
      if (Math.hypot(x - lastX, y - lastY) < MIN_STEP) continue;
      stroke.push(x, y);
      total += 1;
    }
    schedule();
  }

  function end(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    drawing.current = null;
    setInking(false);
    setStrokes(live.current.map((stroke) => [...stroke]));
  }

  function clear() {
    live.current = [];
    setStrokes([]);
    setStatus("idle");
    schedule();
  }

  async function save() {
    if (strokes.length === 0 || status === "saving") return;
    setStatus("saving");
    try {
      const png = await signaturePng(strokes);
      if (!png) throw new Error("no canvas");
      const form = new FormData();
      form.set("strokes", JSON.stringify(strokes));
      form.set("photo", new File([png], "signature.png", { type: "image/png" }));
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await readUploadResponse<{ signature?: number[][]; error?: string }>(response, copy.identity.signature.tooLarge).catch(
        () => ({}) as { signature?: number[][]; error?: string },
      );
      if (!response.ok || !body.signature) {
        setMessage(body.error ?? copy.identity.signature.error);
        setStatus("error");
        return;
      }
      setSaved(body.signature);
      setStatus("saved");
      onSaved?.();
    } catch {
      setMessage(navigator.onLine === false ? copy.common.offlineUpload : copy.identity.signature.error);
      setStatus("error");
    }
  }

  async function remove() {
    if (status === "saving") return;
    setStatus("saving");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error("not removed");
      setSaved(null);
      live.current = [];
      setStrokes([]);
      schedule();
      setStatus("removed");
      onSaved?.();
    } catch {
      setMessage(copy.identity.signature.error);
      setStatus("error");
    }
  }

  const changed = JSON.stringify(strokes) !== JSON.stringify(saved ?? []);
  const busy = status === "saving";

  return (
    <section className="signature-field" aria-labelledby={`${id}-legend`}>
      <p id={`${id}-legend`} className="m-0 mb-0.5 text-[13px] font-bold text-ink-soft">{copy.identity.signature.legend}</p>
      <p id={`${id}-hint`} className="m-0 mb-2 text-[13px] leading-relaxed text-ink-muted">{copy.identity.signature.hint}</p>
      <div className="signature-pad" data-empty={strokes.length === 0 && !inking ? "" : undefined}>
        <svg className="signature-pad__x" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" /></svg>
        <span className="signature-pad__hint" aria-hidden="true"><span>{copy.identity.signature.padHint}</span></span>
        <canvas
          ref={canvas}
          role="img"
          aria-label={copy.identity.signature.padLabel}
          aria-describedby={`${id}-hint`}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {strokes.length > 0 ? (
          <button type="button" className="btn btn-quiet h-11 px-4 text-[14px] aria-disabled:opacity-45" aria-disabled={busy ? true : undefined} onClick={clear}>
            {copy.identity.signature.clear}
          </button>
        ) : null}
        {strokes.length > 0 && changed ? (
          <button type="button" className="btn btn-primary h-11 flex-1 px-4 text-[14px] sm:flex-none" aria-disabled={busy ? true : undefined} onClick={() => void save()}>
            {copy.identity.signature.use}
          </button>
        ) : null}
        {saved ? (
          <button type="button" className="link link--quiet cursor-pointer aria-disabled:opacity-45" aria-disabled={busy ? true : undefined} onClick={() => void remove()}>
            {copy.identity.signature.remove}
          </button>
        ) : null}
      </div>
      <p aria-live="polite" className={`m-0 mt-1 min-h-[18px] text-[13px] leading-relaxed ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
        {status === "saving"
          ? copy.identity.signature.saving
          : status === "saved"
            ? copy.identity.signature.saved
            : status === "removed"
              ? copy.identity.signature.removed
              : status === "full"
                ? copy.identity.signature.full
                : status === "error"
                  ? message
                  : ""}
      </p>
    </section>
  );
}
