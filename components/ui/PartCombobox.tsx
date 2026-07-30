'use client';

/**
 * Part-number picker for the line editors.
 *
 * Replaces a native <datalist>, which cannot be styled at all: the browser drew
 * it at full window height, in operating-system colours that ignored the app's
 * theme, floating over the rest of the form. This is a real combobox — it obeys
 * the design tokens, caps its own height, and shows the manufacturer and
 * description alongside the part number so the right one can be picked without
 * knowing the code by heart.
 *
 * Free text is still allowed. A part that is not in the catalogue yet has to be
 * enterable, so this narrows a list rather than restricting the field.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PartOption {
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode?: string;
}

/** Bounded so a long catalogue cannot produce an unusable list. */
const MAX_VISIBLE = 40;

export function PartCombobox({
  value,
  options,
  onChange,
  onPick,
  placeholder = 'Part number',
  className,
}: {
  value: string;
  options: PartOption[];
  /** Every keystroke — free text is permitted. */
  onChange: (value: string) => void;
  /** A catalogue entry was chosen, so the rest of the line can be filled in. */
  onPick: (option: PartOption) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  /**
   * The list is portalled to the body and positioned in viewport coordinates.
   * The parts table scrolls horizontally, and an absolutely-positioned child of a
   * scroll container gets clipped by it — the panel has to escape that box.
   */
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 320);
    // Flip above when there is not enough room below.
    const below = window.innerHeight - r.bottom;
    const openUp = below < 240 && r.top > below;
    setRect({
      top: openUp ? Math.max(8, r.top - 8) : r.bottom + 4,
      // Keep it on screen when the input sits near the right edge.
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Any scroll or resize moves the anchor, so follow it.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return options.slice(0, MAX_VISIBLE);
    const starts: PartOption[] = [];
    const contains: PartOption[] = [];
    for (const o of options) {
      const mpn = o.mpn.toLowerCase();
      if (mpn.startsWith(query)) starts.push(o);
      else if (
        mpn.includes(query) ||
        o.manufacturer.toLowerCase().includes(query) ||
        o.description.toLowerCase().includes(query)
      ) {
        contains.push(o);
      }
    }
    // A prefix match is what the operator meant; substring matches follow.
    return [...starts, ...contains].slice(0, MAX_VISIBLE);
  }, [options, query]);

  const exact = options.some((o) => o.mpn.toLowerCase() === query);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The list lives outside this subtree now, so check it explicitly.
      if (!wrapRef.current?.contains(t) && !listRef.current?.closest('[data-part-list]')?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (o: PartOption) => {
    onPick(o);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((i) => {
        const n = matches.length;
        if (n === 0) return 0;
        return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      });
      return;
    }
    if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      commit(matches[active]);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={wrapRef} className={cn('relative min-w-0', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn(
            'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary',
            'w-full rounded-[7px] border py-1.5 pr-7 pl-2.5 font-mono text-[12px] outline-none',
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Hide part list' : 'Show part list'}
          onClick={() => {
            setOpen((v) => !v);
            inputRef.current?.focus();
          }}
          className="text-fg-tertiary hover:text-fg absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-[5px]"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
        <div
          data-part-list
          style={{ top: rect.top, left: rect.left, width: rect.width }}
          className={cn(
            'bg-surface-1 border-line shadow-e4 fixed z-50',
            'overflow-hidden rounded-[10px] border',
          )}
        >
          {matches.length === 0 ? (
            <p className="text-fg-tertiary px-3 py-2.5 text-[11.5px] leading-relaxed">
              No catalogue part matches “{value}”. You can still type it in — the rest of the line
              will need filling in by hand.
            </p>
          ) : (
            <>
              <div className="border-line-subtle text-fg-tertiary flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[10.5px]">
                <Search className="size-3" aria-hidden />
                {query ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Catalogue'}
                {matches.length === MAX_VISIBLE && <span>· keep typing to narrow</span>}
              </div>
              {/* Capped height with its own scroll, so the list can never take over
                  the page the way the native control did. */}
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                className="max-h-[min(18rem,50vh)] overflow-y-auto py-1"
              >
                {matches.map((o, i) => (
                  <li
                    key={o.mpn}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(o);
                    }}
                    className={cn(
                      'cursor-pointer px-2.5 py-1.5',
                      i === active ? 'bg-accent-subtle' : 'hover:bg-surface-3',
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span
                        className={cn(
                          'shrink-0 font-mono text-[12px] font-semibold',
                          i === active ? 'text-accent-text' : 'text-fg',
                        )}
                      >
                        <Highlight text={o.mpn} query={query} />
                      </span>
                      <span className="text-fg-tertiary min-w-0 truncate text-[11px]">
                        {o.manufacturer}
                      </span>
                    </span>
                    <span className="text-fg-secondary mt-0.5 block truncate text-[11px]">
                      {o.description}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {query && !exact && matches.length > 0 && (
            <div className="border-line-subtle text-fg-tertiary border-t px-2.5 py-1.5 text-[10.5px]">
              Enter picks the highlighted part. Leave it as typed for a part not in the catalogue.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Marks the typed portion so the reason a row matched is visible. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/25 text-inherit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}
