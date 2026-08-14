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
import { EmptyState, KeyValue, Money, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { IncotermTooltip } from '@/components/ui/IncotermTooltip';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { incotermFor, responsibilities } from '@/lib/domain/incoterms';
import { getStage } from '@/lib/domain/stages';
import { formatDate } from '@/lib/utils';

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

// ─────────────────────────────────────────────────────────────────────────────
// What the order actually is: the reference facts, and the parts on it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teams that may see what we PAID.
 *
 * Everyone sees the parts, the quantities and what the customer is paying —
 * those are on the customer's own order and any desk may need them. The
 * supplier's unit cost is different: it is commercially sensitive, it is not
 * needed to pick a carton or check a marking, and the two teams whose work
 * actually turns on it are the two who negotiate and account for it.
 */
const SEES_COST = new Set<Stakeholder>(['ONE_BUY_SOURCING', 'ONE_BUY_FINANCE']);

export interface OrderItem {
  id: string;
  lineNo: number;
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  lineTotal: number;
  unitCost: number | null;
  buyCurrency: string;
}

export interface OrderFacts {
  alias: string;
  soNumber: string | null;
  customerPo: string;
  customerPi: string | null;
  supplierPo: string;
  supplierPi: string | null;
  customer: string;
  customerGstin: string | null;
  supplier: string;
  supplierCountry: string | null;
  paymentMethod: string;
  creditDays: number | null;
  testingRequired: boolean;
  testScope: string | null;
  buyIncoterms: string;
  sellIncoterms: string | null;
  buyCurrency: string;
  fxRate: number;
  sellValue: number;
  buyValue: number;
  requestedDelivery: string | null;
  createdAt: string;
}

/**
 * The reference facts and the parts, on one tab.
 *
 * A team narrowed to its own steps still has to know WHAT it is handling —
 * inspection cannot check a marking without the part number, and outbound
 * cannot pack without the quantities. Withholding that in the name of focus
 * would mean opening the full order for the most basic fact about it.
 */
export function TeamOrderFactsPanel({
  facts,
  items,
  team,
}: {
  facts: OrderFacts;
  items: OrderItem[];
  team: Stakeholder;
}) {
  const showCost = SEES_COST.has(team);

  const columns: ColumnSpec[] = [
    { key: 'lineNo', label: 'Line', kind: 'number', mobile: 'meta', width: '70px' },
    { key: 'mpn', label: 'Part number', termKey: 'mpn', kind: 'mono', mobile: 'primary', width: '190px' },
    { key: 'manufacturer', label: 'Manufacturer', mobile: 'secondary', width: '160px' },
    { key: 'description', label: 'Description', mobile: 'meta' },
    { key: 'hsnCode', label: 'HSN', kind: 'mono', mobile: 'hidden', width: '110px' },
    { key: 'quantity', label: 'Quantity', kind: 'number', mobile: 'secondary', width: '120px' },
    { key: 'uom', label: 'Unit', mobile: 'hidden', width: '80px' },
    { key: 'unitPrice', label: 'Unit price to customer', kind: 'number', mobile: 'meta', width: '170px' },
    { key: 'lineTotal', label: 'Line total', kind: 'money', mobile: 'meta', width: '150px' },
    ...(showCost
      ? [{ key: 'unitCost', label: 'Our unit cost', kind: 'number' as const, mobile: 'meta' as const, width: '150px' }]
      : []),
  ];

  const rows: RecordRow[] = items.map((i) => ({
    id: i.id,
    lineNo: i.lineNo,
    mpn: i.mpn,
    manufacturer: i.manufacturer,
    description: i.description,
    hsnCode: i.hsnCode,
    quantity: i.quantity,
    uom: i.uom,
    unitPrice: i.unitPrice,
    lineTotal: i.lineTotal,
    ...(showCost ? { unitCost: i.unitCost ?? 0 } : {}),
  }));

  const totalQty = items.reduce((a, i) => a + i.quantity, 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── The reference facts ──────────────────────────────────────────── */}
      <div className="min-w-0">
        <PanelHeader
          title="Order details"
          description="The commercial facts of this order, so the basics never require opening the full record."
        />
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <KeyValue label="Work order">{facts.alias}</KeyValue>
          <KeyValue label="Sales order">
            {facts.soNumber ?? <span className="text-fg-tertiary">Not raised yet</span>}
          </KeyValue>
          <KeyValue label="Customer">{facts.customer}</KeyValue>
          <KeyValue label="Supplier">{facts.supplier}</KeyValue>

          <KeyValue label="Customer PO">{facts.customerPo}</KeyValue>
          <KeyValue label="Our PO to supplier">{facts.supplierPo}</KeyValue>
          <KeyValue label="Proforma to customer">
            {facts.customerPi ?? <span className="text-fg-tertiary">Not issued</span>}
          </KeyValue>
          <KeyValue label="Supplier's proforma">
            {facts.supplierPi ?? <span className="text-fg-tertiary">Not received</span>}
          </KeyValue>

          <KeyValue label="Bought on">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono">{facts.buyIncoterms}</span>
              <IncotermTooltip code={facts.buyIncoterms} />
            </span>
          </KeyValue>
          <KeyValue label="Sold on">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono">{facts.sellIncoterms ?? '—'}</span>
              {facts.sellIncoterms && <IncotermTooltip code={facts.sellIncoterms} />}
            </span>
          </KeyValue>
          <KeyValue label="Payment method">
            {facts.paymentMethod.toLowerCase()}
            {facts.creditDays ? ` · ${facts.creditDays} days` : ''}
          </KeyValue>
          <KeyValue label="Testing">
            {facts.testingRequired
              ? `Required${facts.testScope ? ` · ${facts.testScope.replace(/_/g, ' ').toLowerCase()}` : ''}`
              : 'Not required'}
          </KeyValue>

          <KeyValue label="Order value" termKey="sellValue">
            <Money amount={facts.sellValue} withCode={false} />
          </KeyValue>
          {showCost && (
            <KeyValue label="Supplier value">
              <Money amount={facts.buyValue} withCode={false} />
            </KeyValue>
          )}
          <KeyValue label="Rate locked at">
            {facts.buyCurrency} 1 = {facts.fxRate}
          </KeyValue>
          <KeyValue label="Wanted by">
            {facts.requestedDelivery ? formatDate(facts.requestedDelivery) : '—'}
          </KeyValue>
        </div>
      </div>

      {/* ── The parts ────────────────────────────────────────────────────── */}
      <div className="border-line-subtle min-w-0 border-t pt-4">
        <PanelHeader
          title="Parts on this order"
          description={`${items.length} line${items.length === 1 ? '' : 's'}, ${totalQty.toLocaleString('en-IN')} pieces in total. Search by part number — this is the list to check goods and paperwork against.`}
        />
        {items.length === 0 ? (
          <EmptyState
            title="No lines on this order"
            description="Nothing has been added to the customer's purchase order yet."
          />
        ) : (
          <RecordTable
            columns={columns}
            rows={rows}
            rowNoun="lines"
            searchPlaceholder="Search by part number, manufacturer or description…"
            exportName={`${facts.alias}-lines`}
            emptyTitle="No parts match"
            emptyDescription="Nothing on this order matches that search."
          />
        )}
        {!showCost && (
          <p className="text-fg-tertiary mt-2.5 text-[11.5px] leading-relaxed">
            Supplier pricing is not shown here. It is not needed to check or handle the goods, and
            it stays with the two teams that negotiate and account for it.
          </p>
        )}
      </div>
    </div>
  );
}
