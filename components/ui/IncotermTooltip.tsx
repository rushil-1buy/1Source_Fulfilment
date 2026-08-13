'use client';

/**
 * The ⓘ beside a specific Incoterm.
 *
 * Wraps InfoTooltip so every site rendering a term code explains THAT term
 * rather than the concept. Falls back to the generic glossary entry when the
 * code is unrecognised — an unfamiliar term is exactly when somebody needs the
 * tooltip most, so it must never render nothing.
 */

import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { incotermGlossary } from '@/lib/domain/incoterms';

export function IncotermTooltip({
  code,
  size,
  className,
}: {
  code: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const entry = incotermGlossary(code);
  if (!entry) return <InfoTooltip termKey="incoterms" size={size} className={className} />;
  return <InfoTooltip entry={entry} size={size} className={className} />;
}
