"use client";

import { useRef } from "react";
import { Picker, type PickerOption } from "@/components/picker";

/** A filter that applies itself: choosing an option submits the GET form around it. */
export function AutoPicker({ name, defaultValue, options, ariaLabel }: {
  name: string;
  defaultValue: string;
  options: PickerOption[];
  ariaLabel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <Picker
        name={name}
        defaultValue={defaultValue}
        options={options}
        ariaLabel={ariaLabel}
        onValueChange={() => {
          // The hidden input takes the new value on this render; submit after it.
          requestAnimationFrame(() => root.current?.closest("form")?.requestSubmit());
        }}
      />
    </div>
  );
}
