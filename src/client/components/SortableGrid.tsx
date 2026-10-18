import { GripVertical } from "../icons";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type KeyboardEventHandler, type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface SortableGridProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Without it the grid is not sortable. */
  onReorder?: (items: T[]) => void;
  busy?: boolean;
}

// Same distance as the mouse sensor's activation: moving further is a drag, not a click.
const DRAG_DISTANCE = 8;

/** The library grid; with `onReorder`, cards can be dragged (mouse, touch after a short press, keyboard via the grip). */
export function SortableGrid<T>({ items, itemKey, itemLabel, renderItem, onReorder, busy }: SortableGridProps<T>) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const grid = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const sortable = Boolean(onReorder);

  // Releasing a dragged card clicks its link, which must not open the document. dnd-kit stops that click's
  // propagation on window (so React never sees it) but not the link's default action, so this listener has to be a
  // native one on window that is registered before dnd-kit's.
  useEffect(() => {
    if (!sortable) return;
    let pressedAt: { x: number; y: number } | null = null;
    const inGrid = (event: Event) => event.target instanceof Node && Boolean(grid.current?.contains(event.target));
    const press = (event: PointerEvent) => {
      pressedAt = inGrid(event) ? { x: event.clientX, y: event.clientY } : null;
    };
    const click = (event: MouseEvent) => {
      const start = pressedAt;
      pressedAt = null;
      if (start && inGrid(event) && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_DISTANCE) event.preventDefault();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("click", click, true);
    };
  }, [sortable]);

  if (!onReorder) {
    return (
      <div className="grid" aria-busy={busy}>
        {items.map((item) => (
          <div key={itemKey(item)} className="grid__item" data-item-key={itemKey(item)}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }

  const keys = items.map(itemKey);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(items, keys.indexOf(String(active.id)), keys.indexOf(String(over.id))));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: t("grid.instructions") } }}
    >
      <SortableContext items={keys} strategy={rectSortingStrategy}>
        <div ref={grid} className="grid grid--sortable" aria-busy={busy}>
          {items.map((item) => (
            <SortableItem key={itemKey(item)} id={itemKey(item)} label={itemLabel(item)}>
              {renderItem(item)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { t } = useTranslation();
  // Enter on the card's link has to open it, so only the grip starts a keyboard drag.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return (
    <div
      ref={setNodeRef}
      className={`grid__item ${isDragging ? "is-dragging" : ""}`}
      data-item-key={id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...pointerListeners}
    >
      {children}
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="grid__grip"
        {...attributes}
        onKeyDown={onKeyDown as KeyboardEventHandler | undefined}
        aria-label={t("grid.move", { label })}
        title={t("grid.dragTitle")}
      >
        <GripVertical size={14} />
      </button>
    </div>
  );
}
