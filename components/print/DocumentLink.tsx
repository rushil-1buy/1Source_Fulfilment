'use client';

/**
 * The one way to open a printable document, used everywhere a document is named
 * so the affordance is identical in every place.
 *
 * Opens inside the application by default — an operator checking a figure should
 * not have to leave the order they are working. The viewer itself offers a full
 * page and a print, for when the paper is the point.
 */

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocumentViewer, documentHref, type PrintableKind } from './DocumentViewer';

export { documentHref };
export type { PrintableKind };

const KIND_LABEL: Record<PrintableKind, string> = {
  'purchase-order': 'purchase order',
  'proforma-invoice': 'proforma invoice',
  'work-order': 'work order',
};

export function DocumentLink({
  kind,
  id,
  label = 'Open document',
  /** Shown in the viewer's title bar, e.g. the voucher number. */
  documentTitle,
  variant = 'link',
  className,
}: {
  kind: PrintableKind;
  id: string;
  label?: string;
  documentTitle?: string;
  /** `link` is inline and quiet; `button` is a bordered control. */
  variant?: 'link' | 'button';
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`View the ${KIND_LABEL[kind]}`}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 transition-colors',
          variant === 'button'
            ? 'border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg rounded-[7px] border px-2 py-1 text-[11.5px]'
            : 'text-accent-text hover:text-accent text-[11.5px] font-medium hover:underline',
          className,
        )}
      >
        <FileText className="size-3.5" strokeWidth={2} aria-hidden />
        {label}
      </button>
      {/* Mounted only once opened: an order page shows several of these, and
          three idle iframes would each fetch a document nobody asked to see. */}
      {open && (
        <DocumentViewer
          kind={kind}
          id={id}
          title={documentTitle}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
