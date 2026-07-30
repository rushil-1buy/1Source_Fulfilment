'use client';

/**
 * The screen-only strip above a printed sheet. Hidden by @media print, so it
 * never appears on the paper or in the saved file.
 *
 * "Save as PDF" and "Print" are the same browser dialog — they are offered as
 * two buttons because operators look for the words they already have in mind,
 * and a single ambiguous button is where non-technical users stall.
 */

import { useRouter } from 'next/navigation';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';

export function PrintToolbar({
  title,
  subtitle,
  backHref,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
}) {
  const router = useRouter();
  const print = () => window.print();

  return (
    <div className="doc-toolbar">
      <div className="doc-toolbar-title">
        <strong>{title}</strong>
        {subtitle}
      </div>
      <button
        type="button"
        className="doc-btn"
        onClick={() => (backHref ? router.push(backHref) : router.back())}
      >
        <ArrowLeft size={14} aria-hidden />
        Back
      </button>
      <button type="button" className="doc-btn" onClick={print}>
        <FileDown size={14} aria-hidden />
        Save as PDF
      </button>
      <button type="button" className="doc-btn doc-btn-primary" onClick={print}>
        <Printer size={14} aria-hidden />
        Print
      </button>
    </div>
  );
}
