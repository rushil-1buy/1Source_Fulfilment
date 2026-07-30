import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { MIN_QUERY, PER_GROUP } from './search-contract';
import type { SearchGroup, SearchHit, SearchOutcome } from './search-contract';

/**
 * GLOBAL SEARCH — what the ⌘K bar actually looks through.
 *
 * The top bar has always said "Search orders, parts, documents…", so those three
 * are the floor. In practice an operator searching for an order rarely has its
 * work order alias to hand — they have whatever number the person on the phone
 * read out, which could be the customer's PO, our PO, either proforma invoice, or
 * a part number from the line items. All of those therefore resolve to the order
 * they belong to, because "find me the order this number is on" is the actual
 * question every time.
 *
 * Results are grouped rather than ranked into one list: an MPN and an order number
 * are not competing for the same slot, and a flat list would bury whichever kind
 * the operator did not happen to type first.
 */

/**
 * The result shape and its two bounds live in ./search-contract, which imports
 * nothing — so the command palette can read MIN_QUERY without pulling the
 * database into the browser bundle. Re-exported here so server callers still
 * have one import site.
 */
export { MIN_QUERY, PER_GROUP } from './search-contract';
export type {
  SearchGroup,
  SearchGroupId,
  SearchHit,
  SearchOutcome,
} from './search-contract';

export async function globalSearch(raw: string): Promise<SearchOutcome> {
  const q = raw.trim();
  if (q.length < MIN_QUERY) return { query: q, groups: [], total: 0, truncated: false };

  /**
   * Case-insensitive by virtue of the engine: SQLite's LIKE folds case for
   * ASCII, so "stm32" matches STM32F407VGT6 without further help.
   *
   * ON POSTGRES THIS LINE MUST GAIN `mode: 'insensitive'`. Postgres LIKE is
   * case-SENSITIVE, and the failure is silent — an empty result, not an error.
   * Prisma maps that flag to ILIKE. It is omitted here because SQLite rejects it.
   */
  const like = { contains: q };
  const take = PER_GROUP + 1; // one extra, purely to detect truncation

  const [orders, customerPos, supplierPos, proformas, parts, customers, suppliers, documents] =
    await Promise.all([
      db.workOrder.findMany({
        where: {
          OR: [
            { alias: like },
            { canonicalName: like },
            { provisionalName: like },
            // The numbers an operator is more likely to be holding.
            { customerPo: { poNumber: like } },
            { supplierPo: { poNumber: like } },
            // A part number, resolved to the orders carrying it.
            { supplierPo: { lines: { some: { mpn: like } } } },
          ],
        },
        select: {
          id: true,
          alias: true,
          stage: true,
          status: true,
          customerPo: { select: { poNumber: true, customer: { select: { name: true } } } },
          supplierPo: { select: { poNumber: true, supplier: { select: { name: true } } } },
        },
        orderBy: { stageEnteredAt: 'desc' },
        take,
      }),
      db.customerPO.findMany({
        where: { OR: [{ poNumber: like }, { customer: { name: like } }, { sourcingRef: like }] },
        select: {
          id: true,
          poNumber: true,
          status: true,
          customer: { select: { name: true } },
        },
        orderBy: { poDate: 'desc' },
        take,
      }),
      db.supplierPO.findMany({
        where: { OR: [{ poNumber: like }, { supplier: { name: like } }] },
        select: {
          id: true,
          poNumber: true,
          status: true,
          supplier: { select: { name: true } },
        },
        orderBy: { poDate: 'desc' },
        take,
      }),
      db.proformaInvoice.findMany({
        where: { OR: [{ piNumber: like }, { externalRef: like }] },
        select: { id: true, piNumber: true, direction: true, status: true },
        orderBy: { piDate: 'desc' },
        take,
      }),
      db.mpnCatalogueItem.findMany({
        where: {
          OR: [{ mpn: like }, { manufacturer: like }, { description: like }, { hsnCode: like }],
        },
        select: { id: true, mpn: true, manufacturer: true, description: true, hsnCode: true },
        orderBy: { mpn: 'asc' },
        take,
      }),
      db.customer.findMany({
        where: { OR: [{ name: like }, { code: like }, { gstin: like }] },
        select: { id: true, name: true, code: true, city: true },
        take: 4,
      }),
      db.supplier.findMany({
        where: { OR: [{ name: like }, { code: like }] },
        select: { id: true, name: true, code: true, city: true, country: true },
        take: 4,
      }),
      db.document.findMany({
        where: { OR: [{ title: like }, { fileName: like }] },
        select: {
          id: true,
          title: true,
          fileName: true,
          docType: true,
          workOrder: { select: { alias: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);

  let truncated = false;
  const cap = <T>(rows: T[]): T[] => {
    if (rows.length > PER_GROUP) truncated = true;
    return rows.slice(0, PER_GROUP);
  };

  /** Names the field that matched, when the label alone would not explain the hit. */
  const matchNote = (fields: (string | null | undefined)[], labels: string[]): string | undefined => {
    const lower = q.toLowerCase();
    for (const [i, f] of fields.entries()) {
      if (f && f.toLowerCase().includes(lower)) return labels[i];
    }
    return undefined;
  };

  const allGroups: SearchGroup[] = [
    {
      id: 'orders',
      label: 'Work orders',
      hits: cap(orders).map((o) => ({
        id: o.id,
        href: `/orders/${o.alias}`,
        label: o.alias,
        sublabel: `${o.customerPo.customer.name} · ${o.customerPo.poNumber} → ${o.supplierPo.poNumber}`,
        meta: getStage(o.stage).code,
        matchedOn: o.alias.toLowerCase().includes(q.toLowerCase())
          ? undefined
          : matchNote(
              [o.customerPo.poNumber, o.supplierPo.poNumber],
              ['customer PO', 'our PO'],
            ) ?? 'a line item',
      })),
    },
    {
      id: 'purchaseOrders',
      label: 'Purchase orders',
      hits: [
        ...cap(customerPos).map((p) => ({
          id: p.id,
          href: `/purchase-orders?q=${encodeURIComponent(p.poNumber)}`,
          label: p.poNumber,
          sublabel: `Customer order · ${p.customer.name}`,
          meta: p.status.replace(/_/g, ' ').toLowerCase(),
        })),
        ...cap(supplierPos).map((p) => ({
          id: p.id,
          href: `/purchase-orders?q=${encodeURIComponent(p.poNumber)}`,
          label: p.poNumber,
          sublabel: `Our order · ${p.supplier.name}`,
          meta: p.status.replace(/_/g, ' ').toLowerCase(),
        })),
      ].slice(0, PER_GROUP),
    },
    {
      id: 'proformas',
      label: 'Proforma invoices',
      hits: cap(proformas).map((p) => ({
        id: p.id,
        href: `/create-pi?ref=${encodeURIComponent(p.piNumber)}`,
        label: p.piNumber,
        sublabel: p.direction === 'CUSTOMER_PI' ? 'Our quote to a customer' : "A supplier's quote to us",
        meta: p.status.toLowerCase(),
      })),
    },
    {
      id: 'parts',
      label: 'Parts',
      hits: cap(parts).map((p) => ({
        id: p.id,
        href: `/masters?tab=parts&q=${encodeURIComponent(p.mpn)}`,
        label: p.mpn,
        sublabel: `${p.manufacturer} · ${p.description}`,
        meta: `HSN ${p.hsnCode}`,
        matchedOn: p.mpn.toLowerCase().includes(q.toLowerCase())
          ? undefined
          : matchNote(
              [p.manufacturer, p.description, p.hsnCode],
              ['manufacturer', 'description', 'HSN code'],
            ),
      })),
    },
    {
      id: 'parties',
      label: 'Customers and suppliers',
      hits: [
        ...customers.map((c) => ({
          id: c.id,
          href: `/masters?tab=customers&q=${encodeURIComponent(c.code)}`,
          label: c.name,
          sublabel: `Customer · ${c.code}`,
          meta: c.city,
        })),
        ...suppliers.map((s) => ({
          id: s.id,
          href: `/avl?q=${encodeURIComponent(s.code)}`,
          label: s.name,
          sublabel: `Supplier · ${s.code}`,
          meta: `${s.city}, ${s.country}`,
        })),
      ].slice(0, PER_GROUP),
    },
    {
      id: 'documents',
      label: 'Documents',
      hits: cap(documents).map((d) => ({
        id: d.id,
        href: d.workOrder ? `/orders/${d.workOrder.alias}?tab=documents` : '/documents',
        label: d.title,
        sublabel: d.workOrder
          ? `${d.docType.replace(/_/g, ' ').toLowerCase()} · ${d.workOrder.alias}`
          : d.docType.replace(/_/g, ' ').toLowerCase(),
        meta: d.fileName,
      })),
    },
  ];
  const groups = allGroups.filter((g) => g.hits.length > 0);

  return {
    query: q,
    groups,
    total: groups.reduce((a, g) => a + g.hits.length, 0),
    truncated,
  };
}
