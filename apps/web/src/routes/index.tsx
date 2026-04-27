/**
 * Dashboard route — customizable grid of widgets.
 *
 * Layout state lives in `useWidgetStore` (persisted to localStorage).
 * Users can:
 *   - Click "Customize" → enter customize mode (drag handles + remove
 *     buttons appear)
 *   - Click "Add widget" → modal with all available widgets
 *   - Drag any widget by its handle to reorder (uses @dnd-kit/sortable)
 *   - Click X on a widget → remove from layout
 *   - "Reset" → restore the default layout
 *
 * Each widget is its own self-contained component (see ./widgets.tsx)
 * and is sized via `cols` 1-2 in a 4-column responsive grid.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Settings, RotateCcw, GripVertical, X, Check } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/features/dashboard/queries";
import { relativeTime } from "@/lib/format";
import { useWidgetStore } from "@/features/dashboard/widget-store";
import { REGISTRY } from "@/features/dashboard/widgets";
import { AddWidgetDialog } from "@/features/dashboard/AddWidgetDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: DashboardRoute });

function DashboardRoute() {
  const { data } = useDashboard();
  const { layout, customizing, setLayout, toggleCustomizing, reset } = useWidgetStore();
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = layout.indexOf(String(active.id));
    const newIdx = layout.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    setLayout(arrayMove(layout, oldIdx, newIdx));
  }

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={data?.lastRunAt ? `Last scan: ${relativeTime(data.lastRunAt)}` : "Track your job pipeline and application progress"}
        actions={
          <>
            {customizing && (
              <>
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus size={14} /> Add widget
                </Button>
                <Button variant="warning" size="sm" onClick={reset}>
                  <RotateCcw size={13} /> Reset
                </Button>
              </>
            )}
            <Button variant={customizing ? "success" : "outline"} size="sm" onClick={toggleCustomizing}>
              {customizing ? <><Check size={14} /> Done</> : <><Settings size={14} /> Customize</>}
            </Button>
          </>
        }
      />
      <div className="p-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={layout} strategy={rectSortingStrategy}>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
              {layout.map((id) => {
                const spec = REGISTRY[id];
                if (!spec) return null;
                return <SortableWidget key={id} id={id} cols={spec.cols ?? 1} customizing={customizing} />;
              })}
              {layout.length === 0 && (
                <div className="col-span-full rounded-lg border border-dashed border-[hsl(var(--border))] p-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  No widgets on your dashboard. Click <strong>Customize</strong> then <strong>Add widget</strong> to start.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <AddWidgetDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function SortableWidget({ id, cols, customizing }: { id: string; cols: number; customizing: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { remove } = useWidgetStore();
  const spec = REGISTRY[id];
  const Component = spec.Component;
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        cols === 2 ? "lg:col-span-2" : "lg:col-span-1",
        isDragging && "opacity-90 ring-2 ring-[hsl(var(--ring))] rounded-xl",
      )}
    >
      {customizing && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="h-7 w-7 grid place-items-center rounded-md bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--accent))] cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            <GripVertical size={13} />
          </button>
          <button
            type="button"
            onClick={() => remove(id)}
            className="h-7 w-7 grid place-items-center rounded-md bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
            aria-label="Remove widget"
            title="Remove widget"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <Component />
    </div>
  );
}
