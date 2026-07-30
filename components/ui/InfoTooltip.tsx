'use client';

/**
 * THE MANDATORY COLUMN-HEADER TOOLTIP — §8.1.
 *
 * Rules this component enforces so no screen can skip them:
 *  * The ⓘ is VISIBLE AT REST at ~40% opacity — hover-only discovery fails the
 *    technology-resistant users this platform is built for.
 *  * Content always follows What it is / Why it matters / Example (+ optionally
 *    Who fills it in), pulled from the glossary DATA, never hardcoded.
 *  * Keyboard accessible: focusable trigger, Escape dismisses, aria-describedby.
 *  * Touch friendly: tap opens.
 */

import { useId, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import { glossary, type GlossaryEntry } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/components/providers/Preferences';

export interface InfoTooltipProps {
  /** Glossary key — the normal way to use this. */
  termKey?: string;
  /** Inline override, for one-off fields not worth a glossary entry. */
  entry?: Partial<GlossaryEntry> & { term: string };
  className?: string;
  /** Slightly larger target where there is room. */
  size?: 'sm' | 'md';
}

function resolve(props: InfoTooltipProps): GlossaryEntry | null {
  if (props.entry) {
    return {
      key: props.entry.key ?? 'inline',
      term: props.entry.term,
      plainTerm: props.entry.plainTerm,
      whatItIs: props.entry.whatItIs ?? '',
      whyItMatters: props.entry.whyItMatters ?? '',
      example: props.entry.example ?? '',
      whoFillsItIn: props.entry.whoFillsItIn,
      category: props.entry.category ?? 'general',
    };
  }
  if (props.termKey) return glossary(props.termKey) ?? null;
  return null;
}

export function InfoTooltip(props: InfoTooltipProps) {
  const entry = resolve(props);
  const [open, setOpen] = useState(false);
  const describedBy = useId();

  if (!entry) return null;

  const iconSize = props.size === 'md' ? 'size-[15px]' : 'size-[13px]';

  const trigger = (
    <button
      type="button"
      // Visible at rest — this is the whole point (§8.1).
      className={cn(
        'text-fg-tertiary hover:text-accent focus-visible:text-accent inline-grid shrink-0 place-items-center rounded-full opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100',
        open && 'text-accent opacity-100',
        props.className,
      )}
      aria-label={`What does "${entry.term}" mean?`}
      aria-describedby={open ? describedBy : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }}
    >
      <Info className={iconSize} strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          id={describedBy}
          role="tooltip"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="bg-surface-2 border-line shadow-e4 z-50 w-[320px] rounded-[12px] border p-0 text-left outline-none"
          // Escape and outside-click both dismiss (Radix default), and we stop
          // clicks bubbling so opening a tooltip never sorts the column beneath.
          onClick={(e) => e.stopPropagation()}
        >
          <TooltipBody entry={entry} />
          <Popover.Arrow className="fill-[var(--surface-2)]" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TooltipBody({ entry }: { entry: GlossaryEntry }) {
  const { plainEnglish } = usePreferences();
  const displayTerm = plainEnglish && entry.plainTerm ? entry.plainTerm : entry.term;

  return (
    <div className="text-[12.5px] leading-[1.55]">
      <div className="border-line-subtle flex items-baseline gap-2 border-b px-3.5 py-2.5">
        <span className="text-fg font-semibold">{displayTerm}</span>
        {entry.plainTerm && entry.plainTerm !== displayTerm && (
          <span className="text-fg-tertiary text-[11px]">also called “{entry.plainTerm}”</span>
        )}
        {plainEnglish && entry.plainTerm && (
          <span className="text-fg-tertiary text-[11px]">technically “{entry.term}”</span>
        )}
      </div>
      <dl className="space-y-2 px-3.5 py-3">
        <Row label="What it is" value={entry.whatItIs} />
        <Row label="Why it matters" value={entry.whyItMatters} />
        <Row label="Example" value={entry.example} mono />
        {entry.whoFillsItIn && <Row label="Who fills it in" value={entry.whoFillsItIn} />}
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd className={cn('text-fg-secondary mt-0.5', mono && 'font-mono text-[11.5px]')}>{value}</dd>
    </div>
  );
}

/**
 * Column header with its mandatory tooltip. Every DataTable header goes through
 * this, which is how the requirement becomes structurally impossible to skip.
 */
export function ColumnHeader({
  label,
  plainLabel,
  termKey,
  entry,
  align = 'left',
  className,
}: {
  label: string;
  plainLabel?: string;
  termKey?: string;
  entry?: InfoTooltipProps['entry'];
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const { label: pick } = usePreferences();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        align === 'right' && 'flex-row-reverse',
        align === 'center' && 'justify-center',
        className,
      )}
    >
      <span className="truncate">{pick(label, plainLabel)}</span>
      <InfoTooltip termKey={termKey} entry={entry} />
    </span>
  );
}

/** Simple hover hint for controls that are not data columns. */
export function Hint({
  children,
  content,
  side = 'top',
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={12}
            className="bg-surface-2 border-line text-fg shadow-e3 z-50 max-w-[280px] rounded-[8px] border px-2.5 py-1.5 text-xs leading-snug"
          >
            {content}
            <Tooltip.Arrow className="fill-[var(--surface-2)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
