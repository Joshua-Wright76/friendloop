"use client";

import { useEffect, useId, useState } from "react";
import { copy } from "@/lib/copy";
import { InviteForm } from "./invite-form";
import { InviteLinkCard } from "./invite-link-card";

/**
 * Both ways to invite behind one button on a phone, so the people come first. On a wide screen
 * the card is simply open (the button is hidden by CSS). It opens by itself when you're the only
 * one here, after an invite, and when a link points at it.
 */
export function InvitePanel({ groupId, url, defaultOpen }: { groupId: string; url: string | null; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash;
      if (hash === "#invite-people" || hash === "#invite-link") setOpen(true);
    };
    const frame = requestAnimationFrame(check);
    window.addEventListener("hashchange", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", check);
    };
  }, []);
  return (
    <div className="invite-panel card" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="btn btn-primary invite-panel__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        {copy.members.inviteButton}
      </button>
      <div id={bodyId} className="invite-panel__body">
        <h2 className="invite-panel__title">{copy.members.inviteTitle}</h2>
        {url ? <InviteLinkCard groupId={groupId} url={url} /> : null}
        <InviteForm groupId={groupId} />
      </div>
    </div>
  );
}
