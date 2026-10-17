import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronDown } from "../icons";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

interface TabBarProps<T extends string> {
  tabs: TabItem<T>[];
  /** Offered in the „Mehr“ menu; the menu button takes the label of the one that is open. */
  more: TabItem<T>[];
  current: T;
  onSelect: (tab: T) => void;
}

export function TabBar<T extends string>({ tabs, more, current, onSelect }: TabBarProps<T>) {
  const [open, setOpen] = useState(false);
  const [menuRight, setMenuRight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = more.find((item) => item.id === current);

  useEffect(() => {
    if (!open) return;
    const items = menu.current;
    (items?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (id: T) => {
    setOpen(false);
    trigger.current?.focus();
    onSelect(id);
  };

  const menuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="tabs" ref={root}>
      <div className="tabs__list" role="tablist">
        {tabs.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={id === current} className={id === current ? "is-active" : ""} onClick={() => onSelect(id)}>
            {label}
          </button>
        ))}
        {more.length > 0 && (
          <button
            ref={trigger}
            type="button"
            role="tab"
            aria-selected={active !== undefined}
            aria-haspopup="menu"
            aria-expanded={open}
            className={`tabs__more ${active ? "is-active" : ""}`}
            onClick={(e) => {
              const button = e.currentTarget;
              const right = button.offsetLeft + button.offsetWidth - (button.parentElement?.scrollLeft ?? 0);
              setMenuRight((root.current?.clientWidth ?? right) - right);
              setOpen(!open);
            }}
          >
            {active?.label ?? "Mehr"}
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {open && (
        <div ref={menu} className="menu tabs__menu" style={{ right: menuRight }} role="menu" aria-label="Weitere Bereiche" onKeyDown={menuKeyDown}>
          {more.map(({ id, label }) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={id === current} onClick={() => choose(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
