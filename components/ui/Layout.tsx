'use client';

import { useState } from 'react';
import { Check, Copy, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatPct } from '@/lib/domain/money';
import { InfoTooltip } from './InfoTooltip';

// ── Page scaffolding ────────────────────────────────────────────────────────

export function PageShell({
  children,
  className,
  width = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  /** `full` for data tables that should bleed; `default` caps for readability. */
  width?: 'default' | 'full' | 'narrow';
}) {
  return (
    <div
      className={cn(
        // min-w-0 so grid/flex children can shrink instead of forcing the page wide
        'min-w-0 px-3 py-4 sm:px-5 sm:py-5 lg:px-7',
        width === 'default' && 'mx-auto max-w-[1560px]',
        width === 'narrow' && 'mx-auto max-w-[980px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  plainTitle,
  description,
  termKey,
  actions,
  meta,
}: {
  title: string;
  plainTitle?: string;
  description?: string;
  termKey?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-fg truncate text-[20px] leading-tight font-semibold tracking-[-0.01em]">
            {title}
          </h1>
          {termKey && <InfoTooltip termKey={termKey} size="md" />}
        </div>
        {description && (
          <p className="text-fg-tertiary mt-1 max-w-[min(76ch,100%)] text-[13px] leading-relaxed">
            {description}
          </p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className,
  padded = true,
  elevated = false,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  elevated?: boolean;
}) {
  return (
    <section
      className={cn(
        'bg-surface-1 border-line-subtle rounded-[12px] border',
        elevated && 'shadow-e2',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  termKey,
  actions,
  icon: Icon,
  className,
}: {
  title: string;
  description?: string;
  termKey?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="text-fg-tertiary size-4 shrink-0" strokeWidth={1.8} aria-hidden />}
          <h2 className="text-fg truncate text-[13.5px] font-semibold">{title}</h2>
          {termKey && <InfoTooltip termKey={termKey} />}
        </div>
        {description && (
          <p className="text-fg-tertiary mt-0.5 text-[12px] leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-fg-tertiary mb-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </div>
  );
}

// ── Empty / loading / error states — no dead ends (§8.1, §10.4) ─────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
      )}
    >
      {Icon && (
        <div className="bg-surface-3 text-fg-tertiary mb-3 grid size-11 place-items-center rounded-full">
          <Icon className="size-5" strokeWidth={1.6} aria-hidden />
        </div>
      )}
      <h3 className="text-fg text-[14px] font-semibold">{title}</h3>
      {description && (
        <p className="text-fg-tertiary mt-1.5 max-w-[min(46ch,100%)] text-[12.5px] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="skeleton h-4"
              style={{ width: c === 0 ? '22%' : `${Math.max(8, 78 / (cols - 1))}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Money, numbers, IDs ─────────────────────────────────────────────────────

export function Money({
  amount,
  currency = 'INR',
  compact,
  className,
  tone,
  showSign,
  withSymbol,
  withCode,
}: {
  amount: number;
  currency?: string;
  compact?: boolean;
  className?: string;
  tone?: 'auto' | 'none';
  showSign?: boolean;
  /** Show the currency symbol instead of the ISO code — reads better on tiles. */
  withSymbol?: boolean;
  /** Suppress the ISO code, for table columns where the currency is in the header. */
  withCode?: boolean;
}) {
  const negative = amount < 0;
  const toneClass =
    tone === 'auto' ? (negative ? 'text-danger' : amount > 0 ? 'text-success' : undefined) : undefined;
  return (
    <span className={cn('tnum whitespace-nowrap', toneClass, className)}>
      {showSign && amount > 0 && '+'}
      {formatMoney(amount, currency, {
        compact,
        withCode: withCode ?? (withSymbol ? false : !compact),
        withSymbol,
      })}
    </span>
  );
}

export function Pct({
  value,
  className,
  tone,
}: {
  value: number;
  className?: string;
  tone?: 'auto';
}) {
  const toneClass =
    tone === 'auto' ? (value < 0 ? 'text-danger' : value > 0 ? 'text-success' : undefined) : undefined;
  return <span className={cn('tnum whitespace-nowrap', toneClass, className)}>{formatPct(value)}</span>;
}

/** Reference codes in mono, with one-click copy (§10.4). */
export function MonoId({
  value,
  className,
  copyable = true,
  truncate,
}: {
  value: string;
  className?: string;
  copyable?: boolean;
  truncate?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the value is still selectable */
    }
  };

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className={cn('font-mono text-[11.5px]', truncate && 'truncate')} title={value}>
        {value}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : `Copy ${value}`}
          className="text-fg-tertiary hover:text-accent shrink-0 opacity-50 transition-opacity hover:opacity-100"
        >
          {copied ? (
            <Check className="text-success size-3" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
        </button>
      )}
      {copied && <span className="text-success text-[10px]">Copied</span>}
    </span>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface-1 text-fg border-line hover:bg-surface-3',
  ghost: 'bg-transparent text-fg-secondary border-transparent hover:bg-surface-3 hover:text-fg',
  danger: 'bg-danger text-danger-fg hover:opacity-90 border-transparent',
  success: 'bg-success text-success-fg hover:opacity-90 border-transparent',
};

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  disabledReason,
  wrap,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  /** Why the button is disabled — surfaced instead of a dead control (§9.1). */
  disabledReason?: string;
  /**
   * Lets the label wrap. Needed whenever the text is data rather than a fixed
   * word — a stage name can be forty characters, and nowrap makes the button
   * force its container open and push the layout off the page.
   */
  wrap?: boolean;
}) {
  const disabled = rest.disabled || Boolean(disabledReason);
  const btn = (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      title={disabledReason}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[8px] border font-medium transition-colors',
        wrap ? 'min-w-0 text-left [text-wrap:balance]' : 'whitespace-nowrap',
        size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-1.5 text-[13px]',
        BUTTON_VARIANTS[variant],
        disabled && 'pointer-events-none opacity-45',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
          strokeWidth={2}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
  return btn;
}

// ── Key/value display used across every detail panel ────────────────────────

export function KeyValue({
  label,
  termKey,
  children,
  align = 'left',
  className,
}: {
  label: string;
  termKey?: string;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right', className)}>
      <div
        className={cn(
          'text-fg-tertiary flex items-center gap-1 text-[10.5px] font-medium tracking-[0.04em] uppercase',
          align === 'right' && 'justify-end',
        )}
      >
        <span className="truncate">{label}</span>
        {termKey && <InfoTooltip termKey={termKey} />}
      </div>
      <div className="text-fg mt-0.5 text-[13px] font-medium">{children}</div>
    </div>
  );
}
