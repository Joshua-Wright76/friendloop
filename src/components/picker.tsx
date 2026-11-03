"use client";

import { useEffect, useId, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";

export type PickerOption = { value: string; label: string };

type Props = {
  name: string;
  defaultValue: string;
  value?: string;
  options: PickerOption[];
  ariaLabel: string;
  searchable?: boolean;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** Ties a validation message to the trigger (WCAG 3.3.1). aria-invalid is not valid on a button, so the description carries it. */
  describedBy?: string;
};

export function Picker({ name, defaultValue, value: controlledValue, options, ariaLabel, searchable = false, onValueChange, disabled = false, describedBy }: Props) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const value = controlledValue ?? uncontrolledValue;
  const [open, setOpen] = useState(false);
  const [phoneLayout, setPhoneLayout] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hiddenInput = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionElements = useRef(new Map<number, HTMLButtonElement>());
  const activeRef = useRef(active);
  const focusLostToDisabled = useRef(false);
  const listId = useId();

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setPhoneLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const allOptions = options.some((option) => option.value === value)
    ? options
    : [{ value, label: value }, ...options];
  const selected = allOptions.find((option) => option.value === value);
  const filtered = query
    ? allOptions.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : allOptions;

  useEffect(() => {
    if (!open) return;
    if (phoneLayout) {
      const scrollY = window.scrollY;
      const previous = {
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
        overflow: document.body.style.overflow,
      };
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.position = previous.position;
        document.body.style.top = previous.top;
        document.body.style.width = previous.width;
        document.body.style.overflow = previous.overflow;
        window.scrollTo(0, scrollY);
      };
    }
  }, [open, phoneLayout]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (phoneLayout) return;
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, phoneLayout]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    else optionElements.current.get(activeRef.current)?.focus();
  }, [open, searchable, phoneLayout]);

  useEffect(() => {
    if (open) optionElements.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  /**
   * The browser blurs a control the instant it becomes disabled, dropping focus
   * to <body> — and re-enabling it does not give focus back. So a picker that
   * disables during a save (role change, reorder) silently stole keyboard focus.
   * Put it back, but only if nobody else has since taken it.
   */
  useEffect(() => {
    if (disabled || !focusLostToDisabled.current) return;
    focusLostToDisabled.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) trigger.current?.focus();
  }, [disabled]);

  const openPicker = () => {
    const selectedIndex = Math.max(0, allOptions.findIndex((option) => option.value === value));
    setActive(selectedIndex);
    setQuery("");
    setOpen(true);
  };

  const closePicker = (focus = true) => {
    setOpen(false);
    setQuery("");
    if (focus) trigger.current?.focus();
  };

  const choose = (option: PickerOption) => {
    if (controlledValue === undefined) setUncontrolledValue(option.value);
    if (hiddenInput.current) hiddenInput.current.value = option.value;
    onValueChange?.(option.value);
    closePicker();
  };

  const move = (next: number) => {
    setActive(next);
    optionElements.current.get(next)?.focus();
  };

  return (
    <div
      ref={root}
      className="picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closePicker();
        } else if (phoneLayout && open && event.key === "Tab") {
          const focusable = root.current?.querySelectorAll<HTMLElement>(".picker-sheet button:not(:disabled):not([tabindex='-1']), .picker-sheet input:not(:disabled), .picker-sheet [tabindex='0']");
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        } else if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (filtered.length === 0) return;
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? filtered.length - 1
              : event.key === "ArrowDown"
                // From the search box the highlighted option is the first stop; stepping past it would skip a match.
                ? (event.target === search.current ? active : (active + 1) % filtered.length)
                : (active - 1 + filtered.length) % filtered.length;
          move(next);
        } else if (open && event.key === "Enter" && event.target === search.current && filtered[active]) {
          event.preventDefault();
          choose(filtered[active]);
        } else if (event.key === "Tab" && open) {
          closePicker(false);
        }
      }}
    >
      <input ref={hiddenInput} type="hidden" name={name} value={value} suppressHydrationWarning />
      <p role="status" aria-live="polite" className="sr-only">
        {open && searchable && query.trim()
          ? filtered.length === 0
            ? copy.common.picker.noResults
            : filtered.length === 1
              ? copy.a11yStatus.pickerResultsOne
              : text(copy.a11yStatus.pickerResultsMany, { count: filtered.length })
          : ""}
      </p>
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        disabled={disabled}
        suppressHydrationWarning
        aria-label={`${ariaLabel}: ${selected?.label ?? value}`}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onFocus={() => { focusLostToDisabled.current = false; }}
        onBlur={() => {
          // Fires as the disabled attribute lands: the user did not leave.
          if (trigger.current?.disabled) focusLostToDisabled.current = true;
        }}
        onClick={() => open ? closePicker(false) : openPicker()}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        <span className="picker-value">{selected?.label ?? value}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className={`picker-chevron${open ? " open" : ""}`}>
          <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <>
          {phoneLayout ? <div className="picker-scrim" aria-hidden="true" onClick={() => closePicker()} /> : null}
          <div className={`picker-popover${phoneLayout ? " picker-sheet" : ""}`} role={phoneLayout ? "dialog" : undefined} aria-modal={phoneLayout ? true : undefined} aria-label={phoneLayout ? ariaLabel : undefined}>
            {phoneLayout ? (
              <div className="picker-sheet-heading">
                <span className="picker-sheet-grip" aria-hidden="true" />
                <span className="picker-sheet-title">{ariaLabel}</span>
                <button type="button" className="picker-sheet-close" aria-label={copy.common.close} onClick={() => closePicker()}>{copy.common.close}</button>
              </div>
            ) : null}
            {searchable ? (
              <div className="picker-search-wrap">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                  placeholder={copy.common.picker.searchTimezones}
                  aria-label={copy.common.picker.searchTimezones}
                  className="picker-search"
                  autoComplete="off"
                />
              </div>
            ) : null}
            <div role="listbox" id={listId} aria-label={ariaLabel} className="picker-options">
              {filtered.map((option, index) => (
                <button
                  key={option.value}
                  ref={(element) => {
                    if (element) optionElements.current.set(index, element);
                    else optionElements.current.delete(index);
                  }}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={index === active ? 0 : -1}
                  className="picker-option"
                  onFocus={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="picker-check"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : null}
                </button>
              ))}
            </div>
            {filtered.length === 0 ? <p className="picker-empty">{copy.common.picker.noResults}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
