"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { CHARM_KEYS, FRAME_KEYS, stickerSrc } from "@/lib/stickers";
import { Avatar } from "./avatar";

type Look = { charm: string; frame: string };
type Status = "idle" | "saving" | "saved" | "error";

/**
 * Your charm and frame in this loop, saved as you tap. Sits under the photo controls,
 * and sends to the same address they do, which already knows who you are.
 */
export function MemberLook({
  endpoint,
  name,
  photoUrl,
  charm,
  frame,
  refresh,
  onFrame,
}: {
  endpoint: string;
  name: string;
  photoUrl: string | null;
  charm: string | null;
  frame: string | null;
  /** Called once the server has it, so anything else on the page showing them can follow. */
  refresh?: () => void;
  onFrame?: (frame: string | null) => void;
}) {
  const [look, setLook] = useState<Look>({ charm: charm ?? "", frame: frame ?? "" });
  const [status, setStatus] = useState<Status>("idle");
  const confirmed = useRef(look);
  const latest = useRef(look);
  const saving = useRef(false);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2800);
    return () => clearTimeout(timer);
  }, [status]);

  async function flush() {
    if (saving.current) return;
    saving.current = true;
    setStatus("saving");
    try {
      // A tap made during a save waits its turn and is never dropped.
      let sent: Look;
      do {
        sent = latest.current;
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sent),
        });
        if (!response.ok) throw new Error("not saved");
      } while (latest.current !== sent);
      confirmed.current = sent;
      setStatus("saved");
      onFrame?.(sent.frame || null);
      refresh?.();
    } catch {
      latest.current = confirmed.current;
      setLook(confirmed.current);
      setStatus("error");
    } finally {
      saving.current = false;
    }
  }

  function choose(change: Partial<Look>) {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setLook(next);
    void flush();
  }

  return (
    <div className="member-look" data-testid="member-look">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-bold text-ink-soft">{copy.identity.look.charmLegend}</legend>
        <div className="sticker-sheet">
          <label className="sticker-cell sticker-cell--none">
            <input type="radio" name="charm" value="" checked={look.charm === ""} onChange={() => choose({ charm: "" })} />
            <span>{copy.identity.look.none}</span>
          </label>
          {CHARM_KEYS.map((key) => {
            const label = copy.stickers[key as keyof typeof copy.stickers];
            return (
              <label key={key} className="sticker-cell" title={label}>
                <input type="radio" name="charm" value={key} aria-label={label} checked={look.charm === key} onChange={() => choose({ charm: key })} />
                {/* eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do. */}
                <img src={stickerSrc(key)} alt="" width={32} height={32} loading="lazy" />
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-bold text-ink-soft">{copy.identity.look.frameLegend}</legend>
        <div className="frame-row">
          {["", ...FRAME_KEYS].map((key) => (
            <label key={key || "none"} className="frame-cell">
              <input type="radio" name="frame" value={key} checked={look.frame === key} onChange={() => choose({ frame: key })} />
              <Avatar name={name} photoUrl={photoUrl} frame={key || null} />
              <span>{key ? copy.identity.look.frames[key as keyof typeof copy.identity.look.frames] : copy.identity.look.none}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p aria-live="polite" className={`mt-2 min-h-[18px] text-[13px] leading-relaxed ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
        {status === "saving" ? copy.identity.look.saving : status === "saved" ? copy.identity.look.saved : status === "error" ? copy.identity.look.error : copy.identity.look.hint}
      </p>
      {/* The same rising note as the stationery's, so a pick visibly lands. Decorative: the line above already speaks. */}
      {status === "saved" ? <p aria-hidden="true" className="toast">{copy.identity.look.savedToast}</p> : null}
    </div>
  );
}
