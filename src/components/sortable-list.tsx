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
export function SortableList<T extends { id: string }>({ items: fresh, label, nameOf, move, rowClassName = "", disabled = false, children }: {
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
  children: (item: T, index: number) => ReactNode;
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
                onToggleSteps={() => { if (!dragging.current) setStepping((current) => (current === item.id ? null : item.id)); }}
                onStep={(control, offset) => {
                  refocus.current = { id: item.id, control };
                  commit(item.id, index + offset);
                }}
              >
                {children(item, index)}
              </SortableRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <p role="alert" className={failed ? "toast toast--danger" : "sr-only"}>{failed ? copy.reorder.error : ""}</p>
    </>
  );
}

function SortableRow({ id, name, className, locked, hidden, first, last, stepping, onToggleSteps, onStep, children }: {
  id: string;
  name: string;
  className: string;
  locked: boolean;
  hidden: boolean;
  first: boolean;
  last: boolean;
  stepping: boolean;
  onToggleSteps: () => void;
  onStep: (control: "up" | "down", offset: number) => void;
  children: ReactNode;
}) {
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
          aria-expanded={stepping}
          title={copy.reorder.gripTitle}
          className="sortable-grip"
          // A keyboard's Space or Enter carries no pointer detail: there it picks the row up instead.
          onClick={(event) => { if (event.detail !== 0) onToggleSteps(); }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 flex-none" fill="currentColor">
            {[4, 10, 16].flatMap((y) => [7, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
          </svg>
        </button>
      )}
      <div className="sortable-body">
        {children}
        {stepping && !hidden ? (
          <div className="sortable-steps">
            <button
              type="button"
              data-row={id}
              data-control="up"
              aria-disabled={locked || first ? true : undefined}
              aria-label={text(copy.reorder.upLabel, { item: name })}
              onClick={() => { if (!locked && !first) onStep("up", -1); }}
              className="btn btn-quiet min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            >
              {copy.reorder.up}
            </button>
            <button
              type="button"
              data-row={id}
              data-control="down"
              aria-disabled={locked || last ? true : undefined}
              aria-label={text(copy.reorder.downLabel, { item: name })}
              onClick={() => { if (!locked && !last) onStep("down", 1); }}
              className="btn btn-quiet min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            >
              {copy.reorder.down}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
