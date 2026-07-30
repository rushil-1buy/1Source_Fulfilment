import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "3 days", "4 hours", "22 minutes" — for stage ageing and reply ageing. */
export function humanDuration(hours: number): string {
  if (hours < 1 / 60) return 'just now';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Relative timestamp, with the absolute value available on hover (§10.4). */
export function relativeTime(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const future = diffMs < 0;
  const hours = Math.abs(diffMs) / 36e5;
  const body = humanDuration(hours);
  if (body === 'just now') return body;
  return future ? `in ${body}` : `${body} ago`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${formatDate(d)}, ${d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
