"use client";

import { useEffect, useId, useRef, useState } from "react";
import { copy } from "@/lib/copy";

export type PickerOption = { value: string; label: string };

type Props = {
  name: string;
  defaultValue: string;
  options: PickerOption[];
  ariaLabel: string;
  searchable?: boolean;
};

export function Picker({ name, defaultValue, options, ariaLabel, searchable = false }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionElements = useRef(new Map<number, HTMLButtonElement>());
  const activeRef = useRef(active);
  const listId = useId();

  const allOptions = options.some((option) => option.value === value)
    ? options
    : [{ value, label: value }, ...options];
  const selected = allOptions.find((option) => option.value === value);
  const filtered = query
    ? allOptions.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : allOptions;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    else optionElements.current.get(activeRef.current)?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (open) optionElements.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

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
    setValue(option.value);
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
        } else if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (filtered.length === 0) return;
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? filtered.length - 1
              : event.key === "ArrowDown"
                ? (active + 1) % filtered.length
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
      <input type="hidden" name={name} value={value} suppressHydrationWarning />
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        suppressHydrationWarning
        aria-label={`${ariaLabel}: ${selected?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
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
        <div className="picker-popover">
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
            {filtered.length === 0 ? <p className="picker-empty">{copy.common.picker.noResults}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
