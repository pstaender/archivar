import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  type Modifier,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

// Same distance as the mouse sensor's activation: moving further is a drag, not a click.
export const DRAG_DISTANCE = 8;

/** What a dragged card carries; `onFolderDrop` makes the sidebar's folders drop targets for it. */
export interface DragData {
  label: string;
  /** How many items the drag moves (e.g. the whole selection), shown next to the label. */
  count?: () => number;
  onFolderDrop?: (folder: string) => void;
}

interface FolderDropData {
  folder: string;
}

const FOLDER_PREFIX = "folder:";

const isFolder = (data: unknown): data is FolderDropData => typeof (data as FolderDropData | undefined)?.folder === "string";

// Folders count when the pointer is on them; otherwise the closest card, for sorting.
const collisionDetection: CollisionDetection = (args) => {
  const folders = args.droppableContainers.filter((container) => isFolder(container.data.current));
  const onFolder = args.pointerCoordinates ? pointerWithin({ ...args, droppableContainers: folders }) : [];
  if (onFolder.length > 0) return onFolder;
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => !isFolder(container.data.current)) });
};

const CHIP_OFFSET = 12;

// The chip starts at the dragged card's corner; it belongs next to the pointer (keyboard drags keep the corner).
const followPointer: Modifier = ({ activatorEvent, activeNodeRect, transform }) => {
  const start = activatorEvent && getEventCoordinates(activatorEvent);
  if (!start || !activeNodeRect) return transform;
  return { ...transform, x: transform.x + start.x - activeNodeRect.left + CHIP_OFFSET, y: transform.y + start.y - activeNodeRect.top + CHIP_OFFSET };
};

const InsideDragArea = createContext(false);

/**
 * The drag context of the sidebar and the page, so cards can be dropped onto folders. Nested areas reuse the outer
 * one; a page rendered on its own (as in tests) gets its own.
 */
export function DragArea({ children }: { children: ReactNode }) {
  const nested = useContext(InsideDragArea);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragged, setDragged] = useState<{ label: string; count: number } | null>(null);
  const { t } = useTranslation();
  if (nested) return children;

  const onDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as DragData | undefined;
    setDragged(data ? { label: data.label, count: data.count?.() ?? 1 } : null);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null);
    const data = active.data.current as DragData | undefined;
    const target = over?.data.current;
    if (isFolder(target)) data?.onFolderDrop?.(target.folder);
  };

  return (
    <InsideDragArea.Provider value={true}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragged(null)}
        accessibility={{ screenReaderInstructions: { draggable: t("grid.instructions") } }}
      >
        {children}
        <DragOverlay dropAnimation={null} modifiers={[followPointer]}>
          {dragged && (
            <div className="drag-chip">
              <span className="drag-chip__label">{dragged.label}</span>
              {dragged.count > 1 && <span className="drag-chip__count">{t("dragDrop.more", { count: dragged.count - 1 })}</span>}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </InsideDragArea.Provider>
  );
}

/** Makes a folder a drop target for cards that can be filed; `isOver` while such a card is dragged onto it. */
export function useFolderDropTarget(folder: string) {
  const { setNodeRef, isOver, active } = useDroppable({ id: FOLDER_PREFIX + folder, data: { folder } satisfies FolderDropData });
  const accepts = Boolean((active?.data.current as DragData | undefined)?.onFolderDrop);
  return { setNodeRef, isOver: isOver && accepts };
}
