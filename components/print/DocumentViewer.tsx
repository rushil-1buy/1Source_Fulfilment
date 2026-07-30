'use client';

/**
 * Views a printable document without leaving the order.
 *
 * The sheet is rendered by its own route inside an iframe rather than duplicated
 * here, so what you preview is byte-for-byte what prints — there is no second
 * implementation of the document that can drift from the first.
 *
 * The embedded copy is asked to drop its own toolbar (`?embedded=1`) because this
 * dialog supplies one.
 */

import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, FileText, Printer, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PrintableKind = 'purchase-order' | 'proforma-invoice' | 'work-order';

const KIND_LABEL: Record<PrintableKind, string> = {
  'purchase-order': 'Purchase Order',
  'proforma-invoice': 'Proforma Invoice',
  'work-order': 'Work Order',
};

export function documentHref(kind: PrintableKind, id: string): string {
  return `/print/${kind}/${id}`;
}

export function DocumentViewer({
  kind,
  id,
  title,
  open,
  onOpenChange,
}: {
  kind: PrintableKind;
  id: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const href = documentHref(kind, id);

  // Same-origin, so the embedded document can be driven straight to the printer.
  const print = () => frame.current?.contentWindow?.print();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex',
            'h-[min(94vh,1200px)] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2',
            'flex-col overflow-hidden rounded-[14px] border',
          )}
        >
          <div className="border-line-subtle flex min-w-0 flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
            <FileText className="text-fg-secondary size-4 shrink-0" strokeWidth={2} aria-hidden />
            <Dialog.Title className="text-fg min-w-0 truncate text-[13.5px] font-semibold">
              {KIND_LABEL[kind]}
              {title ? ` · ${title}` : ''}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              A preview of the printable {KIND_LABEL[kind].toLowerCase()}, exactly as it prints.
            </Dialog.Description>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <a
                href={href}
                target="_blank"
                rel="noopener"
                className="border-line-subtle text-fg-secondary hover:bg-surface-3 hover:text-fg inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors"
              >
                <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
                Open full page
              </a>
              <button
                type="button"
                onClick={print}
                disabled={!loaded}
                className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50"
              >
                <Printer className="size-3.5" strokeWidth={2} aria-hidden />
                Print or save as PDF
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="text-fg-tertiary hover:bg-surface-3 hover:text-fg grid size-7 place-items-center rounded-[7px] transition-colors"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 bg-[#e8e8e8]">
            {!loaded && (
              <div className="text-fg-tertiary absolute inset-0 grid place-items-center text-[12.5px]">
                Preparing the document…
              </div>
            )}
            <iframe
              ref={frame}
              src={`${href}?embedded=1`}
              title={`${KIND_LABEL[kind]} preview`}
              onLoad={() => setLoaded(true)}
              className="size-full border-0"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
