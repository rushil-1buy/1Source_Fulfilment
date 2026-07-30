import { PageHeader, PageShell } from '@/components/ui/Layout';
import { TabbedTables, type TableSection } from '@/components/ui/TabbedTables';
import { listMasters } from '@/lib/queries/modules';

export const metadata = { title: 'Masters' };

export default async function MastersPage() {
  const m = await listMasters();

  const sections: TableSection[] = [
    {
      id: 'customers',
      addType: 'customers',
      label: 'Customers',
      description: 'Their state decides whether an invoice splits into central and state tax or uses a single integrated tax.',
      rows: m.customers,
      columns: [
        { key: 'name', label: 'Customer', mobile: 'primary' },
        { key: 'code', label: 'Customer code', kind: 'mono', mobile: 'hidden', width: '130px' },
        { key: 'gstin', label: 'Tax registration number', termKey: 'gstin', kind: 'mono', mobile: 'secondary', width: '180px' },
        { key: 'state', label: 'State', mobile: 'meta', width: '170px' },
        { key: 'city', label: 'City', mobile: 'hidden' },
        { key: 'treatment', label: 'Tax treatment', termKey: 'taxTreatment', kind: 'chip', mobile: 'meta', width: '220px' },
        { key: 'paymentTerms', label: 'Payment terms', termKey: 'paymentTerms', mobile: 'meta', width: '140px' },
        { key: 'creditLimit', label: 'Credit limit', kind: 'money', mobile: 'hidden' },
        { key: 'contact', label: 'Main contact', mobile: 'hidden' },
      ],
    },
    {
      id: 'suppliers',
      addType: 'suppliers',
      label: 'Suppliers',
      description: 'Overseas suppliers bring customs and import tax into play; domestic ones charge tax on their own invoice.',
      rows: m.suppliers,
      columns: [
        { key: 'name', label: 'Supplier', mobile: 'primary' },
        { key: 'code', label: 'Supplier code', kind: 'mono', mobile: 'hidden', width: '130px' },
        { key: 'origin', label: 'Origin', kind: 'chip', mobile: 'meta', width: '120px' },
        { key: 'country', label: 'Country', mobile: 'secondary', width: '160px' },
        { key: 'city', label: 'City', mobile: 'hidden' },
        { key: 'gstin', label: 'Tax registration number', termKey: 'gstin', kind: 'mono', mobile: 'hidden', width: '180px' },
        { key: 'currency', label: 'Currency', kind: 'chip', mobile: 'meta', width: '100px' },
        { key: 'incoterms', label: 'Delivery terms', termKey: 'incoterms', kind: 'chip', mobile: 'hidden', width: '130px' },
        { key: 'bank', label: 'Beneficiary bank', mobile: 'hidden' },
        { key: 'swift', label: 'Bank identifier code', kind: 'mono', mobile: 'hidden', width: '150px' },
        { key: 'contact', label: 'Main contact', mobile: 'hidden' },
      ],
    },
    {
      id: 'rates',
      addType: 'rates',
      label: 'Tax rate master',
      description:
        'Rates are looked up by product code AND date, so a historic invoice is taxed at the rate that applied then. Rows with no end date are the ones currently in force.',
      rows: m.rates,
      columns: [
        { key: 'hsnCode', label: 'Product code', termKey: 'hsnCode', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'description', label: 'Description', mobile: 'secondary' },
        { key: 'cgstRate', label: 'Central tax rate', termKey: 'cgst', kind: 'number', mobile: 'meta', width: '150px' },
        { key: 'sgstRate', label: 'State tax rate', termKey: 'sgst', kind: 'number', mobile: 'meta', width: '140px' },
        { key: 'igstRate', label: 'Integrated tax rate', termKey: 'igst', kind: 'number', mobile: 'meta', width: '160px' },
        { key: 'cessRate', label: 'Cess rate', kind: 'number', mobile: 'hidden', width: '110px' },
        { key: 'effectiveFrom', label: 'In force from', kind: 'date', mobile: 'meta', width: '140px' },
        { key: 'effectiveTo', label: 'In force until', kind: 'date', mobile: 'hidden', width: '140px', empty: 'Still current' },
        { key: 'current', label: 'Currently in force', kind: 'boolean', mobile: 'meta', width: '160px' },
      ],
    },
    {
      id: 'labs',
      addType: 'labs',
      label: 'Testing laboratories',
      rows: m.labs,
      columns: [
        { key: 'name', label: 'Laboratory', mobile: 'primary' },
        { key: 'code', label: 'Laboratory code', kind: 'mono', mobile: 'hidden', width: '150px' },
        { key: 'origin', label: 'Tax handling', kind: 'chip', mobile: 'meta', width: '250px' },
        { key: 'country', label: 'Country', mobile: 'secondary', width: '130px' },
        { key: 'city', label: 'City', mobile: 'hidden' },
        { key: 'gstin', label: 'Tax registration number', termKey: 'gstin', kind: 'mono', mobile: 'hidden', width: '180px' },
        { key: 'accreditations', label: 'Accreditations' },
        { key: 'contact', label: 'Intake address', mobile: 'hidden' },
      ],
    },
    {
      id: 'carriers',
      addType: 'carriers',
      label: 'Carriers',
      rows: m.carriers,
      columns: [
        { key: 'name', label: 'Carrier', mobile: 'primary' },
        { key: 'code', label: 'Carrier code', kind: 'mono', mobile: 'secondary', width: '140px' },
        { key: 'integrated', label: 'Connected to the platform', kind: 'boolean', mobile: 'meta', width: '210px' },
        { key: 'supportsPod', label: 'Provides delivery proof', kind: 'boolean', mobile: 'meta', width: '200px' },
      ],
    },
    {
      id: 'parameters',
      addType: 'parameters',
      label: 'Test parameters',
      description: 'Test scopes are built from this list rather than typed as free text, so two orders asking for the same check ask for exactly the same thing.',
      rows: m.testParameters,
      columns: [
        { key: 'code', label: 'Parameter code', kind: 'mono', mobile: 'primary', width: '150px' },
        { key: 'name', label: 'Check performed', mobile: 'secondary' },
        { key: 'category', label: 'Category', kind: 'chip', mobile: 'meta', width: '150px' },
        { key: 'method', label: 'Standard or method', mobile: 'meta' },
        { key: 'unit', label: 'Unit', mobile: 'hidden', width: '100px' },
        { key: 'isDefault', label: 'Included by default', kind: 'boolean', mobile: 'meta', width: '170px' },
      ],
    },
  ];

  return (
    <PageShell width="full">
      <PageHeader
        title="Masters"
        plainTitle="Reference data"
        description="The reference data every screen draws on. Changing a tax rate or a part's product code here changes what future documents compute."
      />
      <TabbedTables sections={sections} />
    </PageShell>
  );
}
