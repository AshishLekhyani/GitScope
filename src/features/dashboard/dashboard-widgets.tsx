"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { WidgetLayoutItem } from "@/store/slices/dashboardSlice";
import { setWidgetOrder } from "@/store/slices/dashboardSlice";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

function SortableWidget({
  id,
  children,
}: {
  id: WidgetLayoutItem["type"];
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "border-primary/35 shadow-md ring-primary/20 relative rounded-none ring-2"
          : "relative"
      }
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-3 inline-flex cursor-grab touch-none rounded-none p-1 active:cursor-grabbing"
          aria-label="Drag to reorder widget"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function DashboardWidgets({
  childrenByType,
}: {
  childrenByType: Record<WidgetLayoutItem["type"], ReactNode>;
}) {
  const dispatch = useAppDispatch();
  const effectiveOrder = useAppSelector((s) => s.dashboard.widgetOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = effectiveOrder.indexOf(active.id as WidgetLayoutItem["type"]);
    const newIndex = effectiveOrder.indexOf(over.id as WidgetLayoutItem["type"]);
    if (oldIndex < 0 || newIndex < 0) return;
    dispatch(setWidgetOrder(arrayMove(effectiveOrder, oldIndex, newIndex)));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={effectiveOrder}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-4">
          {effectiveOrder.map((id) => (
            <SortableWidget key={id} id={id}>
              {childrenByType[id]}
            </SortableWidget>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
