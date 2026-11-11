"use client";

import { useEffect, useId, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { copy, text } from "@/lib/copy";
import { itemsInPreferredOrder, moveItem } from "@/lib/question-order";

const alongTheList: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * A list put in order by its grips. A mouse or a finger drags the grip; a tap on
 * it opens plain Up and Down buttons on that row instead, since dragging isn't
 * everyone's option (WCAG 2.5.7); and the keyboard picks a row up with Space or
 * Enter on the grip, carries it with the arrow keys and sets it down again.
 * Each move saves at once and the list shows the order the server kept.
 */
export function SortableList<T extends { id: string }>({ items: fresh, label, nameOf, move, rowClassName = "", disabled = false, stepsInRow = false, children }: {
  items: T[];
  /** The list's accessible name. */
  label: string;
  /** How a row is named in announcements and on its grip. */
  nameOf: (item: T) => string;
  /** Saves a move; resolves to the order as saved. */
  move: (id: string, targetIndex: number) => Promise<string[]>;
  rowClassName?: string;
  /** Hold the order still, as for someone who can't change it. */
  disabled?: boolean;
  /** Hand each row its step buttons to place in its own panel, instead of opening them from the grip. */
  stepsInRow?: boolean;
  children: (item: T, index: number, steps: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const contextId = useId();
  const [orderedIds, setOrderedIds] = useState(() => fresh.map((item) => item.id));
  // Another edit can reorder the list on the server (a turn-taker asked now goes to the back):
  // a new order from the page replaces the one kept here.
  const freshOrder = fresh.map((item) => item.id).join(" ");
  const [shownOrder, setShownOrder] = useState(freshOrder);
  if (freshOrder !== shownOrder) {
    setShownOrder(freshOrder);
    setOrderedIds(fresh.map((item) => item.id));
  }
  const items = itemsInPreferredOrder(orderedIds, fresh);
  const [stepping, setStepping] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();
  // Where focus goes back to once a step has moved the row it was on.
  const refocus = useRef<{ id: string; control: string } | null>(null);
  const root = useRef<HTMLOListElement>(null);
  // A drag ends with the pointer lifted on the grip, which the browser also calls a click:
  // that one shouldn't open Up and Down.
  const dragging = useRef(false);
  // Where the carried row was last said to be. dnd-kit reports the row over its own place
  // the moment it is picked up, and again whenever it re-measures the list (a refresh, a
  // scroll, WebKit settling the lifted card): only a new place is worth saying, or the
  // repeats talk over "Picked up".
  const spokenOver = useRef<string | number | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before it counts as a drag, so a tap still reaches the grip.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Spoken once: left in the page, a browse-mode reader would hear it again long after.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 3000);
    return () => clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    const control = root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(target.id)}"][data-control="${target.control}"]`);
    if (control && (!document.activeElement || document.activeElement === document.body || !root.current?.contains(document.activeElement))) control.focus();
    control?.closest("li")?.scrollIntoView({ block: "nearest" });
    if (!pending) refocus.current = null;
  }, [orderedIds, pending]);

  function commit(id: string, targetIndex: number) {
    const before = items.map((item) => item.id);
    const from = before.indexOf(id);
    if (from < 0 || targetIndex < 0 || targetIndex >= before.length || targetIndex === from) return;
    const name = nameOf(items[from]);
    setOrderedIds(moveItem(before, from, targetIndex));
    setFailed(false);
    setAnnouncement("");
    startTransition(async () => {
      try {
        const saved = await move(id, targetIndex);
        setOrderedIds(saved);
        setAnnouncement(text(copy.reorder.moved, { item: name, position: saved.indexOf(id) + 1, total: saved.length }));
        router.refresh();
      } catch {
        setOrderedIds(before);
        setFailed(true);
      }
    });
  }

  const named = (id: string | number) => {
    const item = items.find((candidate) => candidate.id === id);
    return item ? nameOf(item) : "";
  };
  const place = (id: string | number) => items.findIndex((item) => item.id === id) + 1;

  return (
    <>
      <DndContext
        id={contextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[alongTheList]}
        // Picking a row up folds away Up and Down if another row had them open, which moves
        // the rows under the drag: measured once, the next arrow key would aim at where they were.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={() => { dragging.current = true; setStepping(null); }}
        onDragEnd={({ active, over }: DragEndEvent) => {
          setTimeout(() => { dragging.current = false; }, 0);
          if (over && active.id !== over.id) commit(String(active.id), place(over.id) - 1);
        }}
        onDragCancel={() => { setTimeout(() => { dragging.current = false; }, 0); }}
        accessibility={{
          screenReaderInstructions: { draggable: copy.reorder.instructions },
          announcements: {
            onDragStart: ({ active }) => {
              spokenOver.current = active.id;
              return text(copy.reorder.pickedUp, { item: named(active.id), position: place(active.id), total: items.length });
            },
            onDragOver: ({ active, over }) => {
              if (!over || over.id === spokenOver.current) return undefined;
              spokenOver.current = over.id;
              return text(copy.reorder.over, { item: named(active.id), position: place(over.id), total: items.length });
            },
            // The move itself is announced once it has saved.
            onDragEnd: () => undefined,
            onDragCancel: ({ active }) => text(copy.reorder.cancelled, { item: named(active.id) }),
          },
        }}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ol ref={root} className="sortable-list" aria-label={label}>
            {items.map((item, index) => (
              <SortableRow
                key={item.id}
                id={item.id}
                name={nameOf(item)}
                className={rowClassName}
                locked={pending || disabled}
                hidden={disabled}
                first={index === 0}
                last={index === items.length - 1}
                stepping={stepping === item.id}
                inline={stepsInRow}
                onToggleSteps={() => { if (!dragging.current) setStepping((current) => (current === item.id ? null : item.id)); }}
                onStep={(control, offset) => {
                  refocus.current = { id: item.id, control };
                  commit(item.id, index + offset);
                }}
                onJump={(control, target) => {
                  refocus.current = { id: item.id, control };
                  commit(item.id, target === "top" ? 0 : items.length - 1);
                }}
              >
                {(steps) => children(item, index, steps)}
              </SortableRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {/* Seen as well as heard: where the move happened says it happened. */}
      <p role="status" aria-live="polite" className={announcement ? "reorder-note" : "sr-only"}>{announcement}</p>
      <p role="alert" className={failed ? "toast toast--danger" : "sr-only"}>{failed ? copy.reorder.error : ""}</p>
    </>
  );
}

const STEP_PATHS = {
  up: "M10 15V5M5.5 9.5 10 5l4.5 4.5",
  down: "M10 5v10M5.5 10.5 10 15l4.5-4.5",
  top: "M5 4.5h10M10 16V8M5.5 11.5 10 7l4.5 4.5",
  bottom: "M5 15.5h10M10 4v8M5.5 8.5 10 13l4.5-4.5",
} as const;

/** Up, down, to the top, to the bottom: plain buttons, for anyone who can't or won't drag (WCAG 2.5.7). */
function StepButtons({ id, name, locked, first, last, icons, onStep, onJump }: {
  id: string;
  name: string;
  locked: boolean;
  first: boolean;
  last: boolean;
  icons: boolean;
  onStep: (control: "up" | "down", offset: number) => void;
  onJump: (control: "top" | "bottom", target: "top" | "bottom") => void;
}) {
  const controls = [
    { control: "up", blocked: first, label: copy.reorder.upLabel, word: copy.reorder.up, run: () => onStep("up", -1) },
    { control: "down", blocked: last, label: copy.reorder.downLabel, word: copy.reorder.down, run: () => onStep("down", 1) },
    { control: "top", blocked: first, label: copy.reorder.topLabel, word: copy.reorder.top, run: () => onJump("top", "top") },
    { control: "bottom", blocked: last, label: copy.reorder.bottomLabel, word: copy.reorder.bottom, run: () => onJump("bottom", "bottom") },
  ] as const;
  return (
    <div className={icons ? "sortable-steps sortable-steps--icons" : "sortable-steps"} role="group" aria-label={copy.questions.thisRound.stepsLabel}>
      {controls.map(({ control, blocked, label, word, run }) => (
        <button
          key={control}
          type="button"
          data-row={id}
          data-control={control}
          aria-disabled={locked || blocked ? true : undefined}
          aria-label={text(label, { item: name })}
          title={icons ? word : undefined}
          onClick={() => { if (!locked && !blocked) run(); }}
          className={icons ? "step-icon aria-disabled:cursor-not-allowed aria-disabled:opacity-45" : "btn btn-quiet min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"}
        >
          {icons ? (
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path d={STEP_PATHS[control]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : word}
        </button>
      ))}
    </div>
  );
}

function SortableRow({ id, name, className, locked, hidden, first, last, stepping, inline, onToggleSteps, onStep, onJump, children }: {
  id: string;
  name: string;
  className: string;
  locked: boolean;
  hidden: boolean;
  first: boolean;
  last: boolean;
  stepping: boolean;
  /** The caller places the step buttons itself (children gets them), so the grip only drags. */
  inline: boolean;
  onToggleSteps: () => void;
  onStep: (control: "up" | "down", offset: number) => void;
  onJump: (control: "top" | "bottom", target: "top" | "bottom") => void;
  children: ReactNode | ((steps: ReactNode) => ReactNode);
}) {
  const steps = hidden || (!inline && !stepping) ? null : (
    <StepButtons id={id} name={name} locked={locked} first={first} last={last} icons={inline} onStep={onStep} onJump={onJump} />
  );
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: locked,
    attributes: { roleDescription: copy.reorder.roleDescription },
  });
  const style: CSSProperties = {
    // The whole card follows the pointer, lifted a little. Moved, never stretched: rows differ in
    // height, and squashing one to fit another's slot would squash its words.
    transform: transform || isDragging
      ? `translate3d(0, ${Math.round(transform?.y ?? 0)}px, 0)${isDragging ? " scale(1.02)" : ""}`
      : undefined,
    transition: isDragging ? undefined : transition,
  };
  return (
    <li ref={setNodeRef} style={style} data-dragging={isDragging ? "" : undefined} data-locked={locked ? "" : undefined} className={`sortable-row ${className}`}>
      {hidden ? null : (
        <button
          {...attributes}
          {...listeners}
          ref={setActivatorNodeRef}
          type="button"
          // A plain button to assistive tech; the grip's job is in its name and the instructions.
          role={undefined}
          data-row={id}
          data-control="grip"
          aria-label={text(copy.reorder.gripLabel, { item: name })}
          aria-expanded={inline ? undefined : stepping}
          title={inline ? copy.reorder.gripTitleInline : copy.reorder.gripTitle}
          className="sortable-grip"
          // A keyboard's Space or Enter carries no pointer detail: there it picks the row up instead.
          onClick={(event) => { if (!inline && event.detail !== 0) onToggleSteps(); }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 flex-none" fill="currentColor">
            {[4, 10, 16].flatMap((y) => [7, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
          </svg>
        </button>
      )}
      <div className="sortable-body">
        {typeof children === "function" ? children(inline ? steps : null) : children}
        {inline ? null : steps}
      </div>
    </li>
  );
}
