import { PageHeader, PageShell } from '@/components/ui/Layout';
import { TabbedTables, type TableSection } from '@/components/ui/TabbedTables';
import { listPurchaseOrders } from '@/lib/queries/modules';

export const metadata = { title: 'Created Purchase Orders' };

/**
 * Every purchase order raised in the platform, in two registers.
 *
 * Kept separate on purpose: a customer's order and our order to a supplier are
 * different documents, and the question asked of each is different — "has this
 * been sourced yet" versus "has the supplier acknowledged, and when does it
 * land". One merged list would need a direction column and leave half the cells
 * blank on every row.
 *
 * Every row links back to the work order it produced, so the register is a way
 * into the job rather than a dead end.
 */
export default async function PurchaseOrdersPage() {
  const { customerPos, supplierPos } = await listPurchaseOrders();

  const sections: TableSection[] = [
    {
      id: 'customer',
      label: 'From customers',
      rowNoun: 'customer orders',
      description:
        'Orders customers have placed with us. Sourcing is worked out from the line allocations, not stored as a label — "part sourced" means the quantities bought add up to less than the customer ordered. Open any row to see which lines are short and close the gap.',
      rows: customerPos,
      emptyTitle: 'No customer orders recorded yet',
      emptyDescription: 'Record one under Create Purchase Order and it will appear here.',
      columns: [
        { key: 'poNumber', label: 'Their order number', termKey: 'canonicalName', kind: 'mono', mobile: 'primary', width: '170px' },
        { key: 'customer', label: 'Customer', mobile: 'secondary' },
        { key: 'poDate', label: 'Order date', kind: 'date', mobile: 'meta', width: '120px' },
        { key: 'wantedBy', label: 'Wanted by', kind: 'date', mobile: 'meta', width: '120px' },
        { key: 'sourcingRef', label: 'RFQ / Sourcing ID', termKey: 'sourcingRef', kind: 'mono', mobile: 'hidden', width: '170px' },
        { key: 'lineCount', label: 'Lines', kind: 'number', mobile: 'hidden', width: '80px' },
        { key: 'totalQuantity', label: 'Total quantity', kind: 'number', mobile: 'hidden', width: '130px' },
        { key: 'totalValue', label: 'Order value', kind: 'money', mobile: 'meta', width: '150px' },
        { key: 'paymentTerms', label: 'Payment terms', termKey: 'paymentTerms', mobile: 'hidden', width: '140px' },
        { key: 'incoterms', label: 'Delivery terms', termKey: 'incoterms', kind: 'chip', mobile: 'hidden', width: '130px' },
        { key: 'testingLines', label: 'Lines needing testing', termKey: 'testingRequired', kind: 'number', mobile: 'hidden', width: '170px' },
        { key: 'ourQuote', label: 'Our quote', termKey: 'proformaInvoice', kind: 'mono', mobile: 'hidden', width: '140px' },
        // ── Is it sourced, and how do we know ──────────────────────────────
        { key: 'sourcing', label: 'Sourcing', kind: 'chip', mobile: 'meta', width: '170px' },
        { key: 'allocatedQty', label: 'Quantity covered', kind: 'number', mobile: 'hidden', width: '150px' },
        { key: 'shortfallQty', label: 'Still to buy', kind: 'number', mobile: 'meta', width: '130px' },
        { key: 'suppliers', label: 'Sourced from', mobile: 'hidden', width: '200px' },
        { key: 'workOrders', label: 'Work orders', termKey: 'workOrder', mobile: 'meta', width: '180px' },
        { key: 'coverage', label: '', action: 'customerPoCoverage', align: 'right', mobile: 'actions', width: '170px' },
      ],
    },
    {
      id: 'supplier',
      label: 'To suppliers',
      rowNoun: 'supplier orders',
      description:
        'Orders we have placed with approved suppliers. Where an order is linked, the customer order it serves is shown alongside it. A row marked Bulk came from a demand aggregation and serves several customer orders at once — it opens the pool rather than a single job. An order placed ahead of demand starts unlinked; the last column attaches it to a customer order and creates the work order.',
      rows: supplierPos,
      emptyTitle: 'No supplier orders raised yet',
      emptyDescription:
        'Raise one under Create Purchase Order → Supplier PO. Only suppliers approved on the Approved Vendor List can be chosen.',
      columns: [
        { key: 'poNumber', label: 'Our order number', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'voucherNo', label: 'Voucher number', kind: 'mono', mobile: 'hidden', width: '180px' },
        { key: 'supplier', label: 'Supplier', mobile: 'secondary' },
        { key: 'origin', label: 'Origin', kind: 'chip', mobile: 'meta', width: '150px' },
        { key: 'poDate', label: 'Order date', kind: 'date', mobile: 'meta', width: '120px' },
        { key: 'requiredBy', label: 'Required by', kind: 'date', mobile: 'hidden', width: '120px' },
        { key: 'leadTimeDays', label: 'Longest lead time', kind: 'number', mobile: 'meta', width: '160px' },
        { key: 'sourcingRef', label: 'RFQ / Sourcing ID', termKey: 'sourcingRef', kind: 'mono', mobile: 'hidden', width: '170px' },
        { key: 'lineCount', label: 'Lines', kind: 'number', mobile: 'hidden', width: '80px' },
        { key: 'totalQuantity', label: 'Total quantity', kind: 'number', mobile: 'hidden', width: '130px' },
        { key: 'totalValue', label: 'Order value', kind: 'money', mobile: 'meta', width: '150px' },
        { key: 'paymentMethod', label: 'Payment method', termKey: 'paymentMethod', kind: 'chip', mobile: 'hidden', width: '150px' },
        { key: 'incoterms', label: 'Delivery terms', termKey: 'incoterms', kind: 'chip', mobile: 'hidden', width: '130px' },
        { key: 'testingLines', label: 'Lines needing testing', termKey: 'testingRequired', kind: 'number', mobile: 'hidden', width: '170px' },
        { key: 'theirQuote', label: 'Their proforma invoice', termKey: 'proformaInvoice', kind: 'mono', mobile: 'hidden', width: '180px' },
        { key: 'status', label: 'Order status', kind: 'chip', mobile: 'hidden', width: '140px' },
        // ── Whose demand this serves, once linked ──────────────────────────
        { key: 'linked', label: 'Linked', kind: 'chip', mobile: 'meta', width: '190px' },
        // Wider and non-mono for the plural case: a bulk order lists several
        // customer order numbers here, not one.
        { key: 'customerOrder', label: "Customer's order", termKey: 'canonicalName', mobile: 'meta', width: '230px' },
        { key: 'customerOrderCount', label: 'Customer orders served', kind: 'number', mobile: 'hidden', width: '180px' },
        { key: 'aggregationRef', label: 'Pooled from', kind: 'mono', mobile: 'hidden', width: '150px' },
        { key: 'customer', label: 'Customer', mobile: 'meta', width: '200px' },
        { key: 'ourQuote', label: 'Our quote to them', termKey: 'proformaInvoice', kind: 'mono', mobile: 'hidden', width: '150px' },
        { key: 'workOrder', label: 'Work order', termKey: 'workOrder', mobile: 'meta', width: '210px' },
        { key: 'link', label: '', action: 'supplierPoLink', align: 'right', mobile: 'actions', width: '190px' },
      ],
    },
  ];

  return (
    <PageShell width="full">
      <PageHeader
        title="Created Purchase Orders"
        plainTitle="Purchase orders"
        termKey="workOrder"
        description={`Every purchase order raised in the platform — ${customerPos.length} received from customers and ${supplierPos.length} placed with suppliers. Click any row to open the work order it belongs to.`}
      />
      <TabbedTables sections={sections} />
    </PageShell>
  );
}
