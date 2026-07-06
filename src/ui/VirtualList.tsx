import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useRef } from 'react';

export interface VirtualListProps<T> {
  items: readonly T[];
  estimateSize?: number;
  className?: string;
  renderRow: (item: T, index: number) => ReactNode;
}

/** Simple windowed list for 1000+-row collections (items, spells). */
export function VirtualList<T>({
  items,
  estimateSize = 52,
  className,
  renderRow,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className={`overflow-y-auto ${className ?? ''}`}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {renderRow(items[row.index] as T, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
