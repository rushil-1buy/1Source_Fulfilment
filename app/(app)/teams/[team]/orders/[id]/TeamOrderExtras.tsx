'use client';

/**
 * The two things a team needs beside its steps: the paperwork, and who carries
 * the cost and the risk.
 *
 * Both are narrowed views of what the order already holds. Neither introduces a
 * second source of truth — the documents are the order's documents, and the
 * liability is read from the same Incoterm definitions the master flow uses.
 */

import { FileText, ShieldCheck } from 'lucide-react';
import { EmptyState, KeyValue, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { IncotermTooltip } from '@/components/ui/IncotermTooltip';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { incotermFor, responsibilities } from '@/lib/domain/incoterms';
import { getStage } from '@/lib/domain/stages';

/**
 * Readable names for the document types.
 *
 * The enum is what the database stores; SUPPLIER_PI on a register a warehouse
 * clerk has to read is not a document name, it is a constant that leaked.
 */
const DOC_LABELS: Record<string, string> = {
  CUSTOMER_PO: "Customer's purchase order",
  CUSTOMER_PI: 'Proforma invoice to customer',
  SUPPLIER_PO: 'Purchase order to supplier',
  SUPPLIER_PI: "Supplier's proforma invoice",
  TEST_REQUEST: 'Test request',
  TEST_REPORT: 'Test report',
  AWB_LABEL: 'Air waybill',
  PACKING_LIST: 'Packing list',
  COO: 'Certificate of origin',
  BOE: 'Bill of entry',
  DUTY_CHALLAN: 'Duty challan',
  OUT_OF_CHARGE: 'Out-of-charge order',
  GRN: 'Goods receipt note',
  INSPECTION_REPORT: 'Inspection report',
  REPACK_SHEET: 'Repack sheet',
  POD: 'Proof of delivery',
  TAX_INVOICE: 'Tax invoice',
  CREDIT_NOTE: 'Credit note',
  ESCROW_AGREEMENT: 'Escrow agreement',
  RELEASE_INSTRUCTION: 'Release instruction',
  NCR: 'Non-conformance report',
  OTHER: 'Other',
};

const docLabel = (t: string) => DOC_LABELS[t] ?? t.replace(/_/g, ' ').toLowerCase();

const DOC_COLUMNS: ColumnSpec[] = [
  { key: 'title', label: 'Document', mobile: 'primary' },
  { key: 'kind', label: 'What it is', mobile: 'secondary', width: '210px' },
  { key: 'step', label: 'Step it belongs to', termKey: 'stage', mobile: 'meta', width: '230px' },
  { key: 'filedBy', label: 'Filed by', mobile: 'meta', width: '150px' },
  { key: 'when', label: 'Filed on', kind: 'datetime', mobile: 'meta', width: '170px' },
  { key: 'file', label: 'File', kind: 'mono', mobile: 'hidden', width: '200px' },
];

export interface OrderDoc {
  id: string;
  docType: string;
  title: string;
  fileName: string;
  stageId: string | null;
  uploadedBy: string;
  createdAt: string;
}

/**
 * Every document filed against this order, in one register.
 *
 * Deliberately NOT filtered to the team's own steps. A document is evidence
 * about the order, not about a desk: inspection needs the packing list somebody
 * else filed, and finance needs the bill of entry to settle duty. Hiding the
 * rest would make each team re-request paperwork the order already holds.
 */
export function TeamDocumentsPanel({ docs, team }: { docs: OrderDoc[]; team: Stakeholder }) {
  if (docs.length === 0) {
    return (
      <EmptyState
        title="No documents filed yet"
        description="Nothing has been attached to this order. Documents filed as evidence against any step — by any team — appear here."
      />
    );
  }

  const rows: RecordRow[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    kind: docLabel(d.docType),
    step: d.stageId ? `${getStage(d.stageId).code} ${getStage(d.stageId).label}` : 'Not tied to a step',
    filedBy: d.uploadedBy,
    when: d.createdAt,
    file: d.fileName,
  }));

  return (
    <div className="min-w-0">
      <p className="text-fg-tertiary mb-2.5 text-[11.5px] leading-relaxed">
        Every document on this order, whoever filed it — {docs.length} in all.{' '}
        {STAKEHOLDER_META[team].short} sees the whole register, because the paperwork one desk needs
        is usually the paperwork another one filed.
      </p>
      <RecordTable
        columns={DOC_COLUMNS}
        rows={rows}
        rowNoun="documents"
        searchPlaceholder="Search documents…"
        exportName="order-documents"
        emptyTitle="No documents match"
        emptyDescription="Nothing on this order matches that search."
      />
    </div>
  );
}

/**
 * Who pays, who carries the risk, and where it changes hands.
 *
 * Shown on the team's own view because the flow rail's per-step disclosure
 * answers "on this step", and a logistics desk booking a leg needs the whole
 * picture in one place before it books anything.
 *
 * Which side it reads is decided by the team, not by preference. Inbound work
 * runs on the term we BOUGHT on; outbound on the term we SOLD on. Showing a
 * warehouse clerk the buy term while they hand goods to the customer's carrier
 * is how the wrong party ends up paying for a leg.
 */
export function TeamLiabilityPanel({
  team,
  buyIncoterms,
  sellIncoterms,
}: {
  team: Stakeholder;
  buyIncoterms: string;
  sellIncoterms: string | null;
}) {
  const outbound = team === 'ONE_BUY_OUTBOUND';
  const side: 'BUY' | 'SELL' = outbound ? 'SELL' : 'BUY';
  const code = outbound ? sellIncoterms : buyIncoterms;
  const def = incotermFor(code);

  if (!def) {
    return (
      <Panel>
        <PanelHeader
          title="Who carries the cost and the risk"
          description="No delivery term is recorded on this side of the order yet, so nothing can be said about liability without guessing."
        />
      </Panel>
    );
  }

  const rows = responsibilities(def, side);

  return (
    <Panel>
      <PanelHeader
        title="Who carries the cost and the risk"
        description={
          outbound
            ? 'This is the term we SOLD on, because outbound legs are governed by our contract with the customer — not by how we bought.'
            : 'This is the term we BOUGHT on, which governs everything up to and including import clearance.'
        }
        actions={
          <Chip tone="accent" size="sm" icon={ShieldCheck}>
            {outbound ? 'Sold on' : 'Bought on'} {def.code}
          </Chip>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <KeyValue label={outbound ? 'Term we sold on' : 'Term we bought on'}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono">{def.code}</span>
            <span className="text-fg-secondary truncate">{def.name}</span>
            <IncotermTooltip code={def.code} />
          </span>
        </KeyValue>
        <KeyValue label="Risk transfers">{def.riskTransfersAt}</KeyValue>
      </div>

      {/* One line per obligation, in the order somebody moving goods meets them.
          A table would imply the rows are comparable across columns; they are
          not — each is a separate question with one answer. */}
      <ul className="border-line-subtle mt-3 flex min-w-0 flex-col border-t">
        {rows.map((r) => (
          <li
            key={r.key}
            className="border-line-subtle flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-2 last:border-b-0"
          >
            <span className="text-fg-tertiary w-[150px] shrink-0 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
              {r.label}
            </span>
            <span className="text-fg shrink-0 text-[13px] font-medium">{r.party}</span>
            <span className="text-fg-secondary min-w-0 flex-1 text-[12.5px] leading-relaxed">
              {r.detail}
            </span>
            {r.obligatory && (
              <Chip tone="neutral" size="sm">
                Required by the term
              </Chip>
            )}
            {/* The warning text IS the gap — when the term obliges nobody, this
                says what is uncovered rather than leaving a blank row. */}
            {r.warning && (
              <Chip tone="warning" size="sm">
                {r.warning}
              </Chip>
            )}
          </li>
        ))}
      </ul>

      <p className="text-fg-tertiary mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed">
        <FileText className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        Each step in the flow below repeats the part of this that applies to it, so you never have to
        hold the whole term in your head while working a single step.
      </p>
    </Panel>
  );
}
