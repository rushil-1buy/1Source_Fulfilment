'use client';

/**
 * The two things a team needs beside its steps: the paperwork, and who carries
 * the cost and the risk.
 *
 * Both are narrowed views of what the order already holds. Neither introduces a
 * second source of truth — the documents are the order's documents, and the
 * liability is read from the same Incoterm definitions the master flow uses.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bot, FileCheck2, FileText, ShieldCheck, Wallet } from 'lucide-react';
import { Button, EmptyState, KeyValue, Money, Panel, PanelHeader } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';
import { IncotermTooltip } from '@/components/ui/IncotermTooltip';
import { DocumentSheetDialog } from '@/components/documents/DocumentSheet';
import { AgentRunDialog } from '@/components/portal/AgentRunDialog';
import { fileDocsOnESanchit } from '@/lib/actions/portal-filing';
import type { AgentRun } from '@/lib/domain/portal-agents';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { incotermFor, responsibilities } from '@/lib/domain/incoterms';
import { cashPosition } from '@/lib/domain/cash-flows';
import type { DeliverableInput } from '@/lib/domain/deliverables/types';
import { getStage } from '@/lib/domain/stages';
import {
  docFlowFor,
  docRelevanceFor,
  normaliseDocType,
  type DocRelevance,
} from '@/lib/domain/document-flow';
import { cn, formatDate } from '@/lib/utils';

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
  ORM: 'Outward Remittance Message',
  OTHER: 'Other',
};

/**
 * A readable name for a document type, whichever vocabulary named it.
 *
 * The table above is keyed on the stored enum, but the evidence gate files
 * under its own camelCase ids — so `pod` and `taxInvoice` missed the table
 * entirely and fell through to a fallback that printed them verbatim. A
 * register listing "pod" and "taxinvoice" is the constant leaking again, just
 * from a different subsystem. Normalising first catches both, and the last
 * resort now splits the words rather than flattening them.
 */
const docLabel = (t: string) => {
  const direct = DOC_LABELS[t];
  if (direct) return direct;
  const key = normaliseDocType(t).toUpperCase();
  if (DOC_LABELS[key]) return DOC_LABELS[key];
  const words = normaliseDocType(t).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const DOC_COLUMNS: ColumnSpec[] = [
  { key: 'title', label: 'Document', mobile: 'primary' },
  {
    /*
     * Why this document is on THIS desk's register.
     *
     * Owing a document and needing one imply opposite actions — the chase comes
     * to you, or goes from you — so a register that scopes to a desk has to say
     * which, or the desk ends up chasing its own paperwork.
     */
    key: 'yours',
    label: 'Why it is yours',
    mobile: 'secondary',
    width: '150px',
  },
  { key: 'kind', label: 'What it is', mobile: 'secondary', width: '200px' },
  {
    /*
     * Who OWES it, which is not who uploaded it.
     *
     * `filedBy` records whoever attached the file — usually us, filing
     * something a counterparty sent. A chase goes to the party answerable for
     * producing it, and that party is not knowable from an upload record.
     */
    key: 'providedBy',
    label: 'Provided by',
    mobile: 'secondary',
    width: '170px',
  },
  {
    /* The column that turns a gap into a reason to act: "the certificate of
       origin is missing" is a fact; "and the CHA cannot file the Bill of Entry
       without it" is a phone call. */
    key: 'requiredBy',
    label: 'Needed by',
    mobile: 'meta',
    width: '210px',
  },
  { key: 'step', label: 'Step it belongs to', termKey: 'stage', mobile: 'meta', width: '210px' },
  { key: 'filedBy', label: 'Filed by', mobile: 'hidden', width: '150px' },
  { key: 'when', label: 'Filed on', kind: 'datetime', mobile: 'meta', width: '170px' },
  { key: 'file', label: 'File', kind: 'mono', mobile: 'hidden', width: '190px' },
];

export interface OrderDoc {
  id: string;
  docType: string;
  title: string;
  fileName: string;
  stageId: string | null;
  uploadedBy: string;
  createdAt: string;
  version: number;
  sizeBytes: number;
  bodyText: string | null;
}

/**
 * The documents on this order that are THIS desk's business.
 *
 * Scoped by the flow map, not by who filed it or which step it hangs off: a
 * document is on the register if the desk is answerable for producing it, or if
 * its own work is blocked without it. That keeps the paperwork another desk
 * filed but this one needs — inspection needs the packing list, finance needs
 * the bill of entry — while dropping the documents that are somebody else's
 * business entirely.
 *
 * WHAT IS HIDDEN IS COUNTED, NOT ERASED. A desk seeing four documents on an
 * order that holds twenty-seven would reasonably conclude the order is thin.
 * The count of the rest is stated, without listing them, so the register reads
 * as scoped rather than as short.
 */
export function TeamDocumentsPanel({
  docs,
  team,
  orderAlias,
}: {
  docs: OrderDoc[];
  team: Stakeholder;
  orderAlias: string;
}) {
  /** Which document the viewer has open, if any. */
  const [openDoc, setOpenDoc] = useState<OrderDoc | null>(null);

  // Scoped to the desk: produced by them, or blocking them. Everything else on
  // the order is another desk's business and is counted rather than listed.
  const mine = docs
    .map((d) => ({ doc: d, rel: docRelevanceFor(d.docType, team) }))
    .filter((x): x is { doc: OrderDoc; rel: DocRelevance } => x.rel !== null);
  const elsewhere = docs.length - mine.length;

  if (docs.length === 0) {
    return (
      <EmptyState
        title="No documents filed yet"
        description="Nothing has been attached to this order. Documents you are answerable for, and documents your work depends on, appear here as they are filed."
      />
    );
  }

  if (mine.length === 0) {
    return (
      <EmptyState
        title="Nothing here is yours yet"
        description={`${elsewhere} document${elsewhere === 1 ? '' : 's'} ${elsewhere === 1 ? 'is' : 'are'} filed against this order, but none of them are ${STAKEHOLDER_META[team].short}'s to produce and none of them block your work. They belong to other desks.`}
      />
    );
  }

  const rows: RecordRow[] = mine.map(({ doc: d, rel }) => {
    const flow = docFlowFor(d.docType)!;
    return {
      id: d.id,
      title: d.title,
      yours: rel.relation === 'PROVIDES' ? 'Yours to file' : 'You need it',
      kind: docLabel(d.docType),
      providedBy: STAKEHOLDER_META[flow.provider].short,
      requiredBy: flow.requiredBy.length
        ? flow.requiredBy.map((r) => STAKEHOLDER_META[r].short).join(', ')
        : 'Internal only',
      step: d.stageId
        ? `${getStage(d.stageId).code} ${getStage(d.stageId).label}`
        : 'Not tied to a step',
      filedBy: d.uploadedBy,
      when: d.createdAt,
      file: d.fileName,
    };
  });

  const owed = mine.filter((x) => x.rel.relation === 'PROVIDES').length;

  return (
    <div className="min-w-0">
      <p className="text-fg-tertiary mb-2.5 text-[11.5px] leading-relaxed">
        {STAKEHOLDER_META[team].short}&rsquo;s documents on this order — {mine.length} of them:{' '}
        {owed} {owed === 1 ? 'is' : 'are'} yours to produce, {mine.length - owed}{' '}
        {mine.length - owed === 1 ? 'is' : 'are'} paperwork your work depends on.{' '}
        {elsewhere > 0 && (
          <>
            The other {elsewhere} on this order {elsewhere === 1 ? 'belongs' : 'belong'} to other
            desks and {elsewhere === 1 ? 'is' : 'are'} not shown.
          </>
        )}
      </p>
      {/* A row IS the document — clicking it opens the sheet, not a route. */}
      <RecordTable
        columns={DOC_COLUMNS}
        rows={rows}
        rowNoun="documents"
        searchPlaceholder="Search documents…"
        exportName="order-documents"
        emptyTitle="No documents match"
        emptyDescription="Nothing on this order matches that search."
        onRowClick={(r) => setOpenDoc(mine.find((x) => x.doc.id === r.id)?.doc ?? null)}
      />
      <DocumentSheetDialog
        open={openDoc !== null}
        onOpenChange={(o) => !o && setOpenDoc(null)}
        doc={
          openDoc
            ? {
                id: openDoc.id,
                docType: openDoc.docType,
                kindLabel: docLabel(openDoc.docType),
                title: openDoc.title,
                fileName: openDoc.fileName,
                uploadedBy: openDoc.uploadedBy,
                createdAt: openDoc.createdAt,
                version: openDoc.version,
                sizeBytes: openDoc.sizeBytes,
                stepLabel: openDoc.stageId
                  ? `${getStage(openDoc.stageId).code} ${getStage(openDoc.stageId).label}`
                  : null,
                orderAlias,
                bodyText: openDoc.bodyText,
              }
            : null
        }
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
  /** Testing is decided per line — some parts on an order go to the lab, some do not. */
  testingRequired: boolean;
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
    {
      /*
       * Which parts go to the laboratory, on the line.
       *
       * The order-level flag only says the testing phase runs at all; it cannot
       * say WHICH parts, and that is the question the lab, the warehouse and
       * the supplier all actually ask. An order can send two of its three lines
       * and the third would otherwise look tested because the order was.
       */
      key: 'testing',
      label: 'Testing',
      kind: 'chip',
      mobile: 'meta',
      width: '120px',
    },
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
    testing: i.testingRequired ? 'Lab tested' : 'Not tested',
    ...(showCost ? { unitCost: i.unitCost ?? 0 } : {}),
  }));

  const totalQty = items.reduce((a, i) => a + i.quantity, 0);
  const tested = items.filter((i) => i.testingRequired).length;

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
          description={`${items.length} line${items.length === 1 ? '' : 's'}, ${totalQty.toLocaleString('en-IN')} pieces in total${
            tested > 0
              ? ` · ${tested} of ${items.length} going to the laboratory`
              : ' · none going to the laboratory'
          }. Search by part number — this is the list to check goods and paperwork against.`}
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

// ─────────────────────────────────────────────────────────────────────────────
// Finance: the live cash position — money, not goods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What has actually moved, what is committed, what is expected.
 *
 * The signed P&L is cut at the END of the flow, once the customer has settled.
 * Until then Finance watches this: a ledger of cash events keyed to the stages
 * that cause them, updating itself as the order advances. Nothing here is
 * typed in and nothing is guessed — it is the same order data the P&L will
 * eventually be drafted from, read live.
 */
export function LiveCashPanel({ input }: { input: DeliverableInput }) {
  const pos = cashPosition(input);

  const tone = (s: string) =>
    s === 'PAID' ? 'success' : s === 'COMMITTED' ? 'warning' : ('neutral' as const);
  const word = (s: string) => (s === 'PAID' ? 'Moved' : s === 'COMMITTED' ? 'Committed' : 'Expected');

  return (
    <Panel>
      <PanelHeader
        title="Cash in and out on this order"
        description="Rupees actually moving, keyed to the step that moves them. The signed P&L is cut at the end of the flow — this is the running position until then."
        actions={
          <Chip tone={pos.netCash < 0 ? 'warning' : 'success'} size="sm" icon={Wallet}>
            Net {pos.netCash < 0 ? '−' : '+'}
            <Money amount={Math.abs(pos.netCash)} withCode={false} />
          </Chip>
        }
      />

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <KeyValue label="Paid out so far">
          <Money amount={pos.paidOut} withCode={false} />
        </KeyValue>
        <KeyValue label="Received so far">
          <Money amount={pos.paidIn} withCode={false} />
        </KeyValue>
        <KeyValue label="Still to go out">
          <Money amount={pos.committedOut} withCode={false} />
        </KeyValue>
        <KeyValue label="Projected margin at close" termKey="trueMargin">
          <Money amount={pos.projectedMargin} withCode={false} />
        </KeyValue>
      </div>

      <ul className="border-line-subtle mt-3 flex min-w-0 flex-col border-t">
        {pos.rows.map((r) => (
          <li
            key={r.key}
            className="border-line-subtle flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-2 last:border-b-0"
          >
            <span
              className={cn(
                'w-[16px] shrink-0 text-center font-mono text-[12px] font-semibold',
                r.direction === 'OUT' ? 'text-danger' : 'text-success',
              )}
              aria-label={r.direction === 'OUT' ? 'Cash out' : 'Cash in'}
            >
              {r.direction === 'OUT' ? '↓' : '↑'}
            </span>
            <span className="text-fg min-w-0 text-[13px] font-medium">{r.label}</span>
            <Chip tone={tone(r.status)} size="sm">
              {word(r.status)}
            </Chip>
            <span className="text-fg-tertiary text-[11.5px]">{r.movesAt}</span>
            <span className="tnum text-fg ml-auto shrink-0 text-[13px] font-medium">
              <Money amount={r.amount} withCode={false} />
            </span>
            {r.note && (
              <span className="text-fg-tertiary w-full pl-[26px] text-[11.5px] leading-relaxed">
                {r.note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound: eSanchit — the CHA's document portal
// ─────────────────────────────────────────────────────────────────────────────

export interface ESanchitState {
  filed: boolean;
  reference: string | null;
  drns: { title: string; drn: string }[];
  lodgeable: number;
}

/**
 * Supporting documents on eSanchit, ahead of the Bill of Entry.
 *
 * The CHA files the BOE on ICEGATE, but the supporting paper — supplier
 * invoice, packing list, certificate of origin, airway bill — is lodged on
 * eSanchit FIRST, and each upload returns a DRN the BOE then quotes. An order
 * whose BOE is filed without its DRNs gets a customs query, which is a week of
 * dwell. This panel makes that state visible and gives Inbound the filing
 * agent to close it.
 */
export function ESanchitPanel({ orderId, status }: { orderId: string; status: ESanchitState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [run, setRun] = useState<AgentRun | null>(null);

  const lodge = () =>
    start(async () => {
      const res = await fileDocsOnESanchit(orderId);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 10000 });
        if (res.run) setRun(res.run);
        router.refresh();
      } else {
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });

  return (
    <Panel>
      <PanelHeader
        title="Customs documents on eSanchit"
        description="Supporting documents are lodged on eSanchit before the Bill of Entry is filed on ICEGATE — each upload returns a DRN the BOE quotes. The CHA files with their credential; the agent does the portal work."
        actions={
          status.filed ? (
            <Chip tone="success" size="sm" icon={FileCheck2}>
              Lodged · {status.reference}
            </Chip>
          ) : (
            <Chip tone="warning" size="sm">
              Not lodged yet
            </Chip>
          )
        }
      />

      {status.filed ? (
        <ul className="border-line-subtle flex min-w-0 flex-col border-t">
          {status.drns.map((d) => (
            <li
              key={d.drn}
              className="border-line-subtle flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-2 last:border-b-0"
            >
              <span className="text-fg min-w-0 flex-1 truncate text-[12.5px]">{d.title}</span>
              <span className="text-fg shrink-0 font-mono text-[12px] font-medium">{d.drn}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={Bot}
            onClick={lodge}
            disabled={pending || status.lodgeable === 0}
          >
            Lodge {status.lodgeable > 0 ? `${status.lodgeable} document${status.lodgeable === 1 ? '' : 's'}` : 'documents'} via the agent
          </Button>
          {status.lodgeable === 0 && (
            <span className="text-fg-tertiary text-[12px]">
              Nothing to lodge yet — the supplier invoice, packing list, certificate of origin and
              airway bill appear here as they are filed on the order.
            </span>
          )}
        </div>
      )}

      <AgentRunDialog
        run={run}
        title="Lodged on eSanchit"
        open={run !== null}
        onOpenChange={(o) => !o && setRun(null)}
      />
    </Panel>
  );
}
