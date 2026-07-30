import { PageHeader, PageShell, Panel, Money } from '@/components/ui/Layout';
import { TabbedTables, type TableSection } from '@/components/ui/TabbedTables';
import { taxRegisters } from '@/lib/queries/modules';

export const metadata = { title: 'Tax & Goods and Services Tax' };

export default async function TaxPage() {
  const r = await taxRegisters();

  const outputTax = r.outputRegister.reduce(
    (a, i) => a + Number(i.cgstAmount ?? 0) + Number(i.sgstAmount ?? 0) + Number(i.igstAmount ?? 0),
    0,
  );
  const inputCredit = r.itcLedger
    .filter((c) => c.eligible)
    .reduce((a, c) => a + Number(c.totalCredit ?? 0), 0);
  const reverseChargeLiability = r.reverseCharge.reduce((a, x) => a + Number(x.igstAmount ?? 0), 0);
  const netPayable = Math.max(0, outputTax + reverseChargeLiability - inputCredit);

  const sections: TableSection[] = [
    {
      id: 'output',
      label: 'Output tax register',
      description:
        'Every tax invoice we have raised. The treatment column shows which rule applied — same state splits into central and state tax, a different state uses a single integrated tax, and exports or special economic zones are zero-rated.',
      rows: r.outputRegister,
      columns: [
        { key: 'invoiceNumber', label: 'Invoice number', kind: 'mono', mobile: 'primary', width: '160px' },
        { key: 'invoiceDate', label: 'Invoice date', kind: 'date', mobile: 'meta', width: '130px' },
        { key: 'customer', label: 'Customer', mobile: 'secondary' },
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'hidden', width: '150px' },
        { key: 'placeOfSupply', label: 'Place of supply', termKey: 'placeOfSupply', mobile: 'meta', width: '170px' },
        { key: 'treatment', label: 'Tax treatment', termKey: 'taxTreatment', kind: 'chip', mobile: 'meta', width: '160px' },
        { key: 'taxableValue', label: 'Taxable value', termKey: 'taxableValue', kind: 'money', mobile: 'meta' },
        { key: 'cgstAmount', label: 'Central tax', termKey: 'cgst', kind: 'money', mobile: 'hidden' },
        { key: 'sgstAmount', label: 'State tax', termKey: 'sgst', kind: 'money', mobile: 'hidden' },
        { key: 'igstAmount', label: 'Integrated tax', termKey: 'igst', kind: 'money', mobile: 'hidden' },
        { key: 'totalAmount', label: 'Invoice total', kind: 'money', mobile: 'meta' },
        { key: 'eInvoice', label: 'Electronic invoice', termKey: 'irn', kind: 'status', mobile: 'hidden', width: '160px' },
        { key: 'hasEWayBill', label: 'Way bill raised', termKey: 'ewayBill', kind: 'boolean', mobile: 'hidden', width: '140px' },
        { key: 'status', label: 'Payment status', kind: 'status', mobile: 'hidden', width: '140px' },
      ],
    },
    {
      id: 'credit',
      label: 'Input tax credit ledger',
      description:
        'Tax we have already paid that we set against the tax we collect. This is real money back, and it is exactly why import tax must never be counted as a cost.',
      rows: r.itcLedger,
      columns: [
        { key: 'source', label: 'Credit source', kind: 'chip', mobile: 'primary', width: '150px' },
        { key: 'documentRef', label: 'Document reference', kind: 'mono', mobile: 'secondary', width: '180px' },
        { key: 'documentDate', label: 'Document date', kind: 'date', mobile: 'hidden', width: '130px' },
        { key: 'supplier', label: 'Paid to', mobile: 'meta' },
        { key: 'supplierGstin', label: 'Their tax registration', termKey: 'gstin', kind: 'mono', mobile: 'hidden', width: '170px' },
        { key: 'taxableValue', label: 'Taxable value', kind: 'money', mobile: 'hidden' },
        { key: 'totalCredit', label: 'Credit claimed', termKey: 'itc', kind: 'money', mobile: 'meta' },
        { key: 'eligible', label: 'Eligible', kind: 'boolean', mobile: 'meta', width: '110px' },
        { key: 'status', label: 'Government statement match', termKey: 'gstr2b', kind: 'status', mobile: 'meta', width: '200px' },
        { key: 'taxPeriod', label: 'Tax period', kind: 'chip', mobile: 'hidden', width: '120px' },
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'hidden', width: '150px' },
      ],
    },
    {
      id: 'reverse',
      label: 'Reverse charge',
      description:
        'Where we bought a service from abroad, we raise a self-invoice, owe the tax, and claim the same amount back — so the net cash effect is nil but it must still be recorded.',
      rows: r.reverseCharge,
      columns: [
        { key: 'invoiceNumber', label: 'Self-invoice number', kind: 'mono', mobile: 'primary', width: '170px' },
        { key: 'invoiceDate', label: 'Invoice date', kind: 'date', mobile: 'meta', width: '130px' },
        { key: 'vendor', label: 'Overseas vendor', mobile: 'secondary' },
        { key: 'vendorCountry', label: 'Country', kind: 'chip', mobile: 'meta', width: '120px' },
        { key: 'serviceType', label: 'Service', kind: 'chip', mobile: 'meta', width: '120px' },
        { key: 'hsnSacCode', label: 'Service code', kind: 'mono', mobile: 'hidden', width: '130px' },
        { key: 'taxableValue', label: 'Taxable value', kind: 'money', mobile: 'meta' },
        { key: 'igstRate', label: 'Tax rate', kind: 'number', mobile: 'hidden', width: '110px' },
        { key: 'igstAmount', label: 'Tax self-charged', kind: 'money', mobile: 'meta' },
        { key: 'order', label: 'Work order', kind: 'mono', mobile: 'hidden', width: '150px' },
      ],
    },
    {
      id: 'hsn',
      label: 'Product code summary',
      description:
        'Sales grouped by the government product classification code, which is what the return requires.',
      rows: r.hsnSummary,
      columns: [
        { key: 'hsnCode', label: 'Product code', termKey: 'hsnCode', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'lines', label: 'Invoice lines', kind: 'number', mobile: 'meta', width: '130px' },
        { key: 'quantity', label: 'Quantity sold', kind: 'number', mobile: 'meta' },
        { key: 'taxableValue', label: 'Taxable value', kind: 'money', mobile: 'meta' },
        { key: 'cgst', label: 'Central tax', kind: 'money', mobile: 'hidden' },
        { key: 'sgst', label: 'State tax', kind: 'money', mobile: 'hidden' },
        { key: 'igst', label: 'Integrated tax', kind: 'money', mobile: 'hidden' },
      ],
    },
    {
      id: 'waybills',
      label: 'Way bill register',
      description:
        'The electronic permits required to move goods above the configured value. Each one expires, so an overdue movement needs a fresh permit.',
      rows: r.eWayBills,
      columns: [
        { key: 'ewbNumber', label: 'Way bill number', termKey: 'ewayBill', kind: 'mono', mobile: 'primary', width: '170px' },
        { key: 'invoiceNumber', label: 'Against invoice', kind: 'mono', mobile: 'secondary', width: '160px' },
        { key: 'customer', label: 'Customer', mobile: 'meta' },
        { key: 'transportMode', label: 'Transport', kind: 'chip', mobile: 'meta', width: '120px' },
        { key: 'vehicleNumber', label: 'Vehicle', kind: 'mono', mobile: 'hidden', width: '140px' },
        { key: 'distanceKm', label: 'Distance in kilometres', kind: 'number', mobile: 'hidden', width: '180px' },
        { key: 'generatedAt', label: 'Generated', kind: 'date', mobile: 'hidden', width: '130px' },
        { key: 'validUntil', label: 'Valid until', kind: 'date', mobile: 'meta', width: '130px' },
        { key: 'status', label: 'Status', kind: 'status', mobile: 'meta', width: '120px' },
      ],
    },
    {
      id: 'returns',
      label: 'Return working sheets',
      description:
        'Period-by-period working figures for the outward supplies and summary returns. These are working sheets, not filed returns.',
      rows: r.periods,
      columns: [
        { key: 'taxPeriod', label: 'Tax period', kind: 'chip', mobile: 'primary', width: '130px' },
        { key: 'invoiceCount', label: 'Invoices raised', kind: 'number', mobile: 'meta', width: '140px' },
        { key: 'outputTaxable', label: 'Taxable value', kind: 'money', mobile: 'meta' },
        { key: 'outputCgst', label: 'Central tax', kind: 'money', mobile: 'hidden' },
        { key: 'outputSgst', label: 'State tax', kind: 'money', mobile: 'hidden' },
        { key: 'outputIgst', label: 'Integrated tax', kind: 'money', mobile: 'hidden' },
        { key: 'zeroRatedValue', label: 'Zero-rated value', kind: 'money', mobile: 'hidden' },
        { key: 'inputCredit', label: 'Input credit claimed', kind: 'money', mobile: 'meta' },
        { key: 'reverseChargeLiability', label: 'Reverse charge owed', kind: 'money', mobile: 'hidden' },
        { key: 'netPayable', label: 'Net payable', kind: 'money', mobile: 'meta' },
        { key: 'status', label: 'Status', kind: 'status', mobile: 'hidden', width: '120px' },
      ],
    },
  ];

  return (
    <PageShell width="full">
      <PageHeader
        title="Tax & Goods and Services Tax (India)"
        plainTitle="Tax"
        description="Every figure here is computed by the tax engine from the product code and the place of supply, and each one can be traced back to the rule and rate that produced it."
      />
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Panel><Stat label="Output tax charged" value={<Money amount={outputTax} withSymbol compact />} /></Panel>
        <Panel><Stat label="Input credit available" value={<Money amount={inputCredit} withSymbol compact />} tone="success" /></Panel>
        <Panel><Stat label="Reverse charge owed" value={<Money amount={reverseChargeLiability} withSymbol compact />} tone="warning" /></Panel>
        <Panel><Stat label="Net tax payable" value={<Money amount={netPayable} withSymbol compact />} /></Panel>
      </div>
      <TabbedTables sections={sections} />
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warning' | 'success' }) {
  return (
    <div className="min-w-0">
      <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.05em] uppercase">{label}</div>
      <div className={`tnum mt-1 text-[19px] leading-none font-semibold ${tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-fg'}`}>{value}</div>
    </div>
  );
}
