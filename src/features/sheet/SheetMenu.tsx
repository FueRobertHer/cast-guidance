import { Ellipsis, type LucideIcon } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { buttonClass } from '@/ui/Button';

export interface SheetMenuItem {
  label: string;
  icon: LucideIcon;
  /** Destroys data: drawn in `danger`, and always behind a confirmation. */
  danger?: boolean;
  /** Opens a dialog, which the item advertises as a menu button does. */
  dialog?: boolean;
  onSelect: () => void;
}

/**
 * The sheet header's overflow: what is done to the whole character now and
 * then (History, Export, Delete), kept off the header so Edit is the one
 * action there.
 *
 * A menu button (WAI-ARIA APG): Enter, Space or Down opens it on the first
 * item and Up on the last; Up and Down move round the items, Home and End jump
 * to the ends, and a letter jumps to the next item starting with it. Escape
 * closes it with focus back on the button, Tab closes it and moves on, and so
 * does a press anywhere outside it. Picking an item puts focus back on the
 * button before the item runs, so the dialog an item opens hands focus back
 * there too (`dialogs.tsx` keeps whatever had focus when it opened).
 */
export function SheetMenu({
  label,
  items,
  buttonRef,
}: {
  /** The button's accessible name; it has only an icon to show. */
  label: string;
  items: readonly SheetMenuItem[];
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  // Which item has focus while open; null while closed.
  const [active, setActive] = useState<number | null>(null);
  const open = active !== null;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (active !== null) itemRefs.current[active]?.focus();
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setActive(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setActive(null);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(event.key === 'ArrowDown' ? 0 : items.length - 1);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (active === null) return;
    const last = items.length - 1;
    const move = (to: number) => {
      event.preventDefault();
      setActive(to);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(active === last ? 0 : active + 1);
      case 'ArrowUp':
        return move(active === 0 ? last : active - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(last);
      case 'Escape':
        event.preventDefault();
        return close();
      case 'Tab':
        // Focus carries on to the next control on the page, as the key says.
        return setActive(null);
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const letter = event.key.toLowerCase();
        for (let step = 1; step <= items.length; step++) {
          const at = (active + step) % items.length;
          if (items[at]?.label.toLowerCase().startsWith(letter)) return move(at);
        }
      }
    }
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? close() : setActive(0))}
        onKeyDown={onButtonKeyDown}
        className={`${buttonClass({ variant: 'ghost', size: 'icon' })}${open ? ' bg-surface-raised text-ink' : ''}`}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-1 flex min-w-48 flex-col rounded-card bg-surface p-1 shadow-overlay ring-1 ring-line"
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-haspopup={item.dialog ? 'dialog' : undefined}
                onFocus={() => setActive(i)}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`flex min-h-tap items-center gap-3 rounded-control px-3 text-left text-body-strong hover:bg-surface-raised ${item.danger ? 'text-danger' : 'text-ink'}`}
              >
                <Icon size={18} aria-hidden="true" className="shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
