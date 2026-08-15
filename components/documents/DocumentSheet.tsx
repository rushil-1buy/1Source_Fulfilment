'use client';

/**
 * The document viewer: click a row in a register, read the document.
 *
 * Documents in this build are simulated rather than uploaded binaries — the
 * schema keeps renderable content in `bodyText` precisely so that every
 * document opens to something real instead of a dead download link. This
 * dialog renders that content as a paper sheet: letterhead, reference block,
 * then the body.
 *
 * TWO BODY SHAPES, one viewer. Seeded and generated documents carry prose;
 * approved team deliverables are filed with their field values as JSON. A
 * JSON body renders as a labelled field grid — showing a warehouse clerk raw
 * JSON would be a constant leaking into a document, same rule as the doc-type
 * labels.
 *
 * PRINT / SAVE AS PDF uses the browser's own print pipeline with a
 * visibility-scoped print rule (see globals.css): the sheet is the only thing
 * on the page when printing, so "Save as PDF" in the print dialog produces a
 * clean one-document PDF without a PDF library in the bundle.
 */

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { formatDateTime } from '@/lib/utils';

export interface SheetDoc {
  id: string;
  docType: string;
  /** Human name for the type — resolved by the caller's label table. */
  kindLabel: string;
  title: string;
  fileName: string;
  uploadedBy: string;
  createdAt: string;
  version: number;
  sizeBytes: number;
  stepLabel: string | null;
  orderAlias: string;
  bodyText: string | null;
}

/** JSON bodies (approved deliverables) become a labelled grid, not raw JSON. */
function parseJsonBody(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** camelCase / snake_case keys read as words on paper. */
const humanise = (k: string) =>
  k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

export function DocumentSheetDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: SheetDoc | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [printing, setPrinting] = useState(false);

  // The print rule keys off a body attribute so everything except the sheet
  // vanishes from the printed page. Cleared on afterprint, and on unmount in
  // case the browser never fires it.
  useEffect(() => {
    if (!printing) return;
    document.body.setAttribute('data-print-doc', '');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
      document.body.removeAttribute('data-print-doc');
    };
  }, [printing]);

  if (!doc) return null;
  const json = doc.bodyText ? parseJsonBody(doc.bodyText) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          {/* ── Chrome: stays out of the print ─────────────────────────── */}
          <div className="border-line-subtle flex items-center gap-2 border-b px-4 py-3">
            <Dialog.Title className="text-fg min-w-0 flex-1 truncate text-[14px] font-semibold">
              {doc.title}
            </Dialog.Title>
            <Button variant="secondary" icon={Printer} onClick={() => setPrinting(true)}>
              Print / save as PDF
            </Button>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-fg-tertiary hover:text-fg hover:bg-surface-3 rounded-[7px] p-1.5 transition-colors"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Document viewer for {doc.title}
          </Dialog.Description>

          {/* ── The sheet: what prints ─────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="doc-sheet border-line bg-surface-1 mx-auto max-w-[660px] rounded-[4px] border px-7 py-6">
              {/* Letterhead */}
              <div className="border-b-2 border-current pb-3">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <span className="text-fg text-[16px] font-bold tracking-[-0.01em]">
                    1BUY Fulfilment
                  </span>
                  <span className="text-fg-tertiary text-[10.5px] tracking-[0.08em] uppercase">
                    Merchant of Record
                  </span>
                </div>
                <div className="text-fg-secondary mt-1 text-[11.5px]">
                  {doc.kindLabel} · {doc.orderAlias}
                </div>
              </div>

              {/* Reference block */}
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-3">
                {[
                  ['Document', doc.fileName],
                  ['Filed by', doc.uploadedBy],
                  ['Filed on', formatDateTime(doc.createdAt)],
                  ['Version', `v${doc.version}`],
                  ['Belongs to step', doc.stepLabel ?? 'Not tied to a step'],
                  ['Size', `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                      {k}
                    </dt>
                    <dd className="text-fg mt-0.5 break-words">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* Body */}
              <div className="border-line-subtle mt-4 border-t pt-4">
                {!doc.bodyText ? (
                  <p className="text-fg-tertiary text-[12.5px] leading-relaxed">
                    This file was recorded without captured content — in the live system this is
                    where the uploaded PDF would render.
                  </p>
                ) : json ? (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-2">
                    {Object.entries(json)
                      .filter(([, v]) => v !== '' && v !== null)
                      .map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">
                            {humanise(k)}
                          </dt>
                          <dd className="text-fg mt-0.5 break-words whitespace-pre-wrap">
                            {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <pre className="text-fg font-sans text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
                    {doc.bodyText}
                  </pre>
                )}
              </div>

              <div className="border-line-subtle text-fg-tertiary mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[10.5px]">
                <span>Generated by the 1BUY Fulfilment Platform — demonstration document.</span>
                <Chip tone="muted" size="sm">
                  Simulated
                </Chip>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
