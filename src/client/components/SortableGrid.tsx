import { GripVertical } from "../icons";
import { type DragEndEvent, useDndMonitor } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type KeyboardEventHandler, type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DRAG_DISTANCE, DragArea, type DragData } from "./DragAndDrop";

interface SortableGridProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Without it the grid is not sortable. */
  onReorder?: (items: T[]) => void;
  /** Lets cards be dragged onto the sidebar's folders. */
  onFolderDrop?: (item: T, folder: string) => void;
  /** How many items dragging this card moves (e.g. the selection it belongs to). */
  dragCount?: (item: T) => number;
  className?: string;
  busy?: boolean;
}

/**
 * The library grid; with `onReorder`, cards can be dragged (mouse, touch after a short press, keyboard via the grip),
 * and with `onFolderDrop` onto folders.
 */
export function SortableGrid<T>(props: SortableGridProps<T>) {
  if (!props.onReorder && !props.onFolderDrop) {
    const { items, itemKey, renderItem, className = "grid", busy } = props;
    return (
      <div className={className} aria-busy={busy}>
        {items.map((item) => (
          <div key={itemKey(item)} className="grid__item" data-item-key={itemKey(item)}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <DragArea>
      <DraggableGrid {...props} />
    </DragArea>
  );
}

function DraggableGrid<T>({ items, itemKey, itemLabel, renderItem, onReorder, onFolderDrop, dragCount, className = "grid", busy }: SortableGridProps<T>) {
  const grid = useRef<HTMLDivElement>(null);
  const keys = items.map(itemKey);

  // Releasing a dragged card clicks its link, which must not open the document. dnd-kit stops that click's
  // propagation on window (so React never sees it) but not the link's default action, so this listener has to be a
  // native one on window that is registered before dnd-kit's.
  useEffect(() => {
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
  }, []);

  useDndMonitor({
    onDragEnd: ({ active, over }: DragEndEvent) => {
      if (!onReorder || !over || active.id === over.id) return;
      const from = keys.indexOf(String(active.id));
      const to = keys.indexOf(String(over.id));
      if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
    },
  });

  return (
    <SortableContext items={keys} strategy={rectSortingStrategy}>
      <div ref={grid} className={`${className} grid--sortable`} aria-busy={busy}>
        {items.map((item) => (
          <SortableItem
            key={itemKey(item)}
            id={itemKey(item)}
            sortable={Boolean(onReorder)}
            data={{
              label: itemLabel(item),
              count: dragCount && (() => dragCount(item)),
              onFolderDrop: onFolderDrop && ((folder) => onFolderDrop(item, folder)),
            }}
          >
            {renderItem(item)}
          </SortableItem>
        ))}
      </div>
    </SortableContext>
  );
}

function SortableItem({ id, sortable, data, children }: { id: string; sortable: boolean; data: DragData; children: ReactNode }) {
  // Cards that are only dragged onto folders are no drop targets, so the others do not move aside.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled: { draggable: false, droppable: !sortable },
  });
  const { t } = useTranslation();
  // Enter on the card's link has to open it, so only the grip starts a keyboard drag.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return (
    <div
      ref={setNodeRef}
      className={`grid__item ${isDragging ? "is-dragging" : ""}`}
      data-item-key={id}
      style={sortable ? { transform: CSS.Translate.toString(transform), transition } : undefined}
      {...pointerListeners}
    >
      {children}
      {sortable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="grid__grip"
          {...attributes}
          onKeyDown={onKeyDown as KeyboardEventHandler | undefined}
          aria-label={t("grid.move", { label: data.label })}
          title={t("grid.dragTitle")}
        >
          <GripVertical size={14} />
        </button>
      )}
    </div>
  );
}
