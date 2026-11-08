"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { micHelp, type MicHelp, type MicHelpScreen } from "@/lib/mic-help";

/** Long enough to read the step beside it and watch the tap land. */
const STEP_MS = 2800;

/**
 * "Show me how", under a refused microphone: a small dialog that plays the
 * steps for this person's own phone and browser on a pretend screen, with the
 * same steps written out beside it, and a Try again that asks once more.
 */
export function MicHelpButton({ onRetry }: { onRetry: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [help, setHelp] = useState<MicHelp | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  const open = () => {
    setHelp(micHelp({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      host: window.location.host,
    }));
    setStep(0);
    // Reduced motion: nothing moves on its own, and each step is a still picture.
    setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    dialog.current?.showModal();
  };

  useEffect(() => {
    if (!help || !playing) return;
    const timer = setTimeout(() => setStep((current) => (current + 1) % help.steps.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [help, playing, step]);

  return (
    <>
      <button
        type="button"
        className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2"
        aria-haspopup="dialog"
        onClick={open}
      >
        {copy.reply.voiceBlockedHelp}
      </button>
      <dialog
        ref={dialog}
        className="wizard-dialog mic-help"
        aria-labelledby="mic-help-title"
        onClose={() => setHelp(null)}
      >
        {help ? (
          <div>
            <h2 id="mic-help-title" className="text-ink">{copy.micHelp.title}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{help.intro}</p>

            <div className="mic-help__stage">
              <div className="mic-help__phone" aria-hidden="true" data-mic-step={step}>
                <Screen key={step} screen={help.steps[step].screen} />
              </div>
              <button
                type="button"
                className="mic-help__play"
                aria-label={playing ? copy.micHelp.pause : copy.micHelp.play}
                onClick={() => setPlaying((current) => !current)}
              >
                {playing ? (
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z" fill="currentColor" /></svg>
                ) : (
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.2v11.6L15.5 10z" fill="currentColor" /></svg>
                )}
              </button>
            </div>

            <ol className="mic-help__steps">
              {help.steps.map((item, index) => (
                <li key={item.text}>
                  <button
                    type="button"
                    className="mic-help__step"
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => {
                      // Picking a step holds it there, so it can be read and copied.
                      setPlaying(false);
                      setStep(index);
                    }}
                  >
                    <span className="mic-help__number numeric" aria-hidden="true">{index + 1}</span>
                    <span>{item.text}</span>
                  </button>
                </li>
              ))}
            </ol>
            {help.note ? <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{help.note}</p> : null}

            <div className="mic-help__actions flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>
                {copy.micHelp.close}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  dialog.current?.close();
                  // Still inside the tap, so the browser may show its prompt.
                  onRetry();
                }}
              >
                {copy.micHelp.retry}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** The finger: drifts in, presses, and a ripple shows the tap. */
function Tap() {
  return <span className="mic-help__tap" />;
}

function Header({ title, back }: { title: string; back?: boolean }) {
  return (
    <div className="mic-help__header">
      {back ? (
        <svg viewBox="0 0 12 20" className="mic-help__back"><path d="M9 3 3 10l6 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : null}
      <span>{title}</span>
    </div>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 8 14" className="mic-help__chevron"><path d="m1.5 1.5 5 5.5-5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** A row standing in for everything that isn't the one to tap. */
const Filler = ({ width }: { width: string }) => (
  <div className="mic-help__row">
    <span className="mic-help__bar" style={{ width }} />
  </div>
);

function Screen({ screen }: { screen: MicHelpScreen }) {
  switch (screen.kind) {
    case "home":
      return (
        <div className="mic-help__screen mic-help__home">
          {Array.from({ length: 12 }, (_, index) => index === 6 ? (
            <span key={index} className="mic-help__app mic-help__app--settings mic-help__target">
              <svg viewBox="0 0 24 24"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8 4.5v-2.2l-2.3-.5a6 6 0 0 0-.6-1.5l1.3-2-1.6-1.6-2 1.3a6 6 0 0 0-1.5-.6L12.9 4h-2.2l-.5 2.3a6 6 0 0 0-1.5.6l-2-1.3-1.6 1.6 1.3 2a6 6 0 0 0-.6 1.5L4 10.9v2.2l2.3.5c.1.5.3 1 .6 1.5l-1.3 2 1.6 1.6 2-1.3c.5.3 1 .5 1.5.6l.5 2.3h2.2l.5-2.3c.5-.1 1-.3 1.5-.6l2 1.3 1.6-1.6-1.3-2c.3-.5.5-1 .6-1.5Z" fill="currentColor" /></svg>
              <span className="mic-help__app-label">{copy.micHelp.screens.settings}</span>
              <Tap />
            </span>
          ) : (
            <span key={index} className="mic-help__app" />
          ))}
        </div>
      );
    case "list":
      return (
        <div className="mic-help__screen">
          <Header title={screen.title} back={screen.back} />
          <Filler width="62%" />
          <Filler width="48%" />
          <div className="mic-help__row mic-help__target mic-help__row--hit">
            <span>{screen.target}</span>
            <Chevron />
            <Tap />
          </div>
          <Filler width="55%" />
        </div>
      );
    case "toggle":
      return (
        <div className="mic-help__screen">
          <Header title={screen.title} back />
          <Filler width="50%" />
          <div className="mic-help__row">
            <span>{screen.target}</span>
            <span className="mic-help__switch mic-help__target">
              <span className="mic-help__knob" />
              <Tap />
            </span>
          </div>
          <Filler width="58%" />
        </div>
      );
    case "choice":
      return (
        <div className="mic-help__screen">
          <Header title={screen.title} back />
          {screen.options.map((option, index) => (
            <div key={option} className={index === screen.pick ? "mic-help__row mic-help__target mic-help__row--hit" : "mic-help__row"}>
              <span>{option}</span>
              {index === screen.pick ? (
                <>
                  <svg viewBox="0 0 20 20" className="mic-help__check"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <Tap />
                </>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "address":
      return (
        <div className="mic-help__screen">
          <div className="mic-help__address">
            <span className="mic-help__site mic-help__target">
              <svg viewBox="0 0 20 20"><path d="M3 6h8M15 6h2M3 14h2M9 14h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="13" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="7" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
              <Tap />
            </span>
            <span className="mic-help__host">{screen.host}</span>
          </div>
          <Filler width="70%" />
          <Filler width="52%" />
          <Filler width="64%" />
        </div>
      );
    case "retry":
      return (
        <div className="mic-help__screen mic-help__retry">
          <span className="mic-help__bar" style={{ width: "70%" }} />
          <span className="mic-help__bar" style={{ width: "46%" }} />
          <span className="mic-help__pill mic-help__target">
            <svg viewBox="0 0 20 20"><rect x="7" y="2.5" width="6" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {copy.micHelp.screens.voiceNote}
            <Tap />
          </span>
        </div>
      );
  }
}
