'use client';

/**
 * Bringing part lines in from a spreadsheet.
 *
 * Forty MPNs typed by hand is where wrong part numbers come from, so the lines
 * arrive from the file the buyer was already working in.
 *
 * Three principles the layout follows:
 *
 *  · **The format is shown, not described.** A filled-in sample table sits on the
 *    screen with a download beside it. "MPN, Quantity, Unit Price…" in a sentence
 *    is a specification nobody reads correctly the first time.
 *  · **Nothing imports unseen.** The parsed rows are previewed before they replace
 *    or extend the order, so a mis-detected column is caught here rather than
 *    discovered on the printed purchase order.
 *  · **Rejected rows are named.** Every row that could not be read is listed with
 *    its number and what was wrong. Silently importing 38 of 40 lines is how an
 *    order goes out short.
 */

import { useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Plus,
  Replace,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  IMPORT_TEMPLATE_HEADERS,
  IMPORT_TEMPLATE_ROWS,
  importTemplateCsv,
  parseLineImport,
  type ImportedLine,
} from '@/lib/domain/line-import';
import { isLegacyXls, isXlsx, xlsxToDelimitedText } from '@/lib/domain/xlsx-lite';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { cn } from '@/lib/utils';

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[12.5px] outline-none';

export function BulkLineImportDialog({
  onOpenChange,
  onImport,
  existingLineCount,
}: {
  onOpenChange: (open: boolean) => void;
  /** `mode` decides whether the current lines are kept. */
  onImport: (lines: ImportedLine[], mode: 'replace' | 'append') => void;
  existingLineCount: number;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const result = useMemo(() => (text.trim() ? parseLineImport(text) : null), [text]);
  const usable = result?.lines.length ?? 0;
  /** Duplicate notes are advisory; everything else rejected a row. */
  const rejections = result?.problems.filter((p) => !p.message.includes('appears')) ?? [];
  const notes = result?.problems.filter((p) => p.message.includes('appears')) ?? [];

  const readFile = async (file: File) => {
    if (isLegacyXls(file.name)) {
      toast.error('That is the old .xls format.', {
        description:
          'Open it in Excel and save as .xlsx or CSV — the binary .xls format cannot be read reliably in a browser.',
        duration: 11000,
      });
      return;
    }
    setReading(true);
    try {
      if (isXlsx(file.name)) {
        setText(await xlsxToDelimitedText(await file.arrayBuffer()));
      } else {
        setText(await file.text());
      }
      setFileName(file.name);
    } catch (err) {
      toast.error('That file could not be read.', {
        description: err instanceof Error ? err.message : String(err),
        duration: 11000,
      });
    } finally {
      setReading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([importTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '1buy-parts-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const commit = (mode: 'replace' | 'append') => {
    if (!result || result.lines.length === 0) return;
    onImport(result.lines, mode);
    toast.success(
      `${result.lines.length} line${result.lines.length === 1 ? '' : 's'} ${
        mode === 'replace' ? 'imported' : 'added'
      }.`,
      {
        description:
          rejections.length > 0
            ? `${rejections.length} row${rejections.length === 1 ? '' : 's'} could not be read and were left out — see the list in the dialog.`
            : 'Part details fill in from the catalogue where the part number matches.',
        duration: 9000,
      },
    );
    onOpenChange(false);
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Dialog.Title className="text-fg min-w-0 text-[15px] font-semibold">
                <FileSpreadsheet className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
                Import part lines from a spreadsheet
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="text-fg-tertiary hover:bg-surface-3 hover:text-fg ml-auto grid size-7 shrink-0 place-items-center rounded-[7px] transition-colors"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-fg-secondary mt-1.5 text-[12.5px] leading-relaxed">
              Upload a CSV or Excel file, or paste the rows straight from the sheet. Only the part
              number and quantity are required — everything else fills in from the catalogue where
              the part number matches.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              {/* ── The format, shown ────────────────────────────────────── */}
              <section className="min-w-0">
                <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <SectionLabel>The format</SectionLabel>
                  <Button size="sm" variant="secondary" icon={Download} onClick={downloadTemplate}>
                    Download the template
                  </Button>
                </div>
                <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                  <table className="w-full min-w-[860px] border-collapse text-left">
                    <thead className="bg-surface-inset">
                      <tr className="border-line-subtle border-b">
                        {IMPORT_TEMPLATE_HEADERS.map((h, i) => (
                          <th
                            key={h}
                            scope="col"
                            className="text-fg-tertiary px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase"
                          >
                            {h}
                            {i < 2 && <span className="text-danger ml-0.5">*</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {IMPORT_TEMPLATE_ROWS.map((row, ri) => (
                        <tr key={ri} className="border-line-subtle border-b last:border-0">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className={cn(
                                'text-fg-secondary px-2.5 py-1.5 text-[11px] whitespace-nowrap',
                                ci === 0 && 'text-fg font-mono',
                                (ci === 1 || ci === 2) && 'tnum',
                              )}
                            >
                              {cell || <span className="text-fg-tertiary">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-fg-tertiary mt-1.5 text-[11px] leading-relaxed">
                  <span className="text-danger">*</span> required. Column names are matched loosely —
                  &ldquo;Part No&rdquo;, &ldquo;MPN&rdquo; and &ldquo;Manufacturer Part Number&rdquo;
                  all work, in any order. Without a header row the columns are read in the order
                  above. Quantities may carry commas or units; prices may carry a currency symbol.
                </p>
              </section>

              {/* ── Getting the data in ──────────────────────────────────── */}
              <section className="min-w-0">
                <SectionLabel>Your data</SectionLabel>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    accept=".csv,.tsv,.txt,.xlsx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="secondary"
                    icon={Upload}
                    disabled={reading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {reading ? 'Reading…' : 'Choose a file'}
                  </Button>
                  {fileName && (
                    <Chip tone="success" size="sm">
                      {fileName}
                    </Chip>
                  )}
                  <span className="text-fg-tertiary text-[11.5px]">
                    CSV, TSV or .xlsx — or paste below
                  </span>
                </div>

                <div className="mt-2">
                  <textarea
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setFileName(null);
                    }}
                    rows={6}
                    placeholder={`MPN,Quantity,Unit Price\nSTM32F407VGT6,1200,985\nW25Q128JVSIQ,3000,152`}
                    className={cn(field, 'resize-y font-mono text-[11.5px] leading-relaxed')}
                  />
                  <p className="text-fg-tertiary mt-1 text-[11px]">
                    <ClipboardPaste className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                    Copying a block of cells out of Excel and pasting here works — the columns arrive
                    tab-separated and are read the same way.
                  </p>
                </div>
              </section>

              {/* ── What will be imported ───────────────────────────────── */}
              {result && (
                <section className="min-w-0">
                  <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
                    <SectionLabel>What will be imported</SectionLabel>
                    <Chip tone={usable > 0 ? 'success' : 'danger'} size="sm">
                      {usable} line{usable === 1 ? '' : 's'} readable
                    </Chip>
                    {rejections.length > 0 && (
                      <Chip tone="danger" size="sm" icon={TriangleAlert}>
                        {rejections.length} row{rejections.length === 1 ? '' : 's'} rejected
                      </Chip>
                    )}
                    {result.assumedPositional && (
                      <Chip tone="warning" size="sm">
                        No header row found — columns read in template order
                      </Chip>
                    )}
                  </div>

                  {result.detectedColumns.length > 0 && (
                    <p className="text-fg-tertiary mb-2 text-[11px] leading-relaxed">
                      Read as: {result.detectedColumns.join(' · ')}
                    </p>
                  )}

                  {usable > 0 && (
                    <div className="border-line-subtle min-w-0 overflow-x-auto rounded-[9px] border">
                      <table className="w-full min-w-[720px] border-collapse text-left">
                        <thead className="bg-surface-inset">
                          <tr className="border-line-subtle border-b">
                            {['Row', 'Part', 'Qty', 'Price', 'Manufacturer', 'HSN', 'Lead', 'Testing'].map(
                              (h) => (
                                <th
                                  key={h}
                                  scope="col"
                                  className="text-fg-tertiary px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase"
                                >
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {result.lines.slice(0, 60).map((l) => (
                            <tr key={l.rowNo} className="border-line-subtle border-b last:border-0">
                              <td className="text-fg-tertiary tnum px-2.5 py-1.5 text-[11px]">
                                {l.rowNo}
                              </td>
                              <td className="text-fg px-2.5 py-1.5 font-mono text-[11.5px]">{l.mpn}</td>
                              <td className="tnum text-fg px-2.5 py-1.5 text-[11.5px]">
                                {l.quantity.toLocaleString('en-IN')}
                              </td>
                              <td className="tnum text-fg-secondary px-2.5 py-1.5 text-[11.5px]">
                                {l.unitPrice ?? '—'}
                              </td>
                              <td className="text-fg-secondary max-w-[180px] truncate px-2.5 py-1.5 text-[11.5px]">
                                {l.manufacturer ?? '—'}
                              </td>
                              <td className="text-fg-secondary px-2.5 py-1.5 font-mono text-[11px]">
                                {l.hsnCode ?? '—'}
                              </td>
                              <td className="tnum text-fg-secondary px-2.5 py-1.5 text-[11.5px]">
                                {l.leadTimeDays ?? '—'}
                              </td>
                              <td className="px-2.5 py-1.5 text-[11.5px]">
                                {l.testingRequired ? (
                                  <Chip tone="warning" size="sm">
                                    Yes
                                  </Chip>
                                ) : (
                                  <span className="text-fg-tertiary">no</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {result.lines.length > 60 && (
                        <p className="text-fg-tertiary border-line-subtle border-t px-2.5 py-1.5 text-[11px]">
                          Showing the first 60 of {result.lines.length}. All of them will be imported.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Every rejected row, named. */}
                  {rejections.length > 0 && (
                    <div className="border-danger/40 bg-danger-subtle mt-2 rounded-[9px] border px-3 py-2.5">
                      <div className="text-danger flex items-center gap-1.5 text-[12px] font-semibold">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        These rows will not be imported
                      </div>
                      <ul className="mt-1.5 grid gap-1">
                        {rejections.slice(0, 12).map((p, i) => (
                          <li key={i} className="text-fg-secondary min-w-0 text-[11.5px] leading-relaxed">
                            <span className="text-fg-tertiary tnum">Row {p.rowNo}:</span> {p.message}
                            {p.raw && (
                              <span className="text-fg-tertiary block truncate font-mono text-[10.5px]">
                                {p.raw}
                              </span>
                            )}
                          </li>
                        ))}
                        {rejections.length > 12 && (
                          <li className="text-fg-tertiary text-[11px]">
                            …and {rejections.length - 12} more.
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {notes.length > 0 && (
                    <div className="border-warning/40 bg-warning-subtle mt-2 rounded-[9px] border px-3 py-2.5">
                      <ul className="grid gap-1">
                        {notes.map((p, i) => (
                          <li key={i} className="text-fg-secondary text-[11.5px] leading-relaxed">
                            {p.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <span className="text-fg-tertiary mr-auto text-[11.5px]">
              {usable === 0
                ? 'Nothing readable yet'
                : `${usable} line${usable === 1 ? '' : 's'} ready · ${existingLineCount} already on the order`}
            </span>
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="secondary"
              icon={Plus}
              wrap
              disabled={usable === 0}
              disabledReason={usable === 0 ? 'Nothing readable to import yet.' : undefined}
              onClick={() => commit('append')}
            >
              Add to the order
            </Button>
            <Button
              variant="primary"
              icon={Replace}
              wrap
              disabled={usable === 0}
              disabledReason={usable === 0 ? 'Nothing readable to import yet.' : undefined}
              onClick={() => commit('replace')}
            >
              Replace all lines
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
