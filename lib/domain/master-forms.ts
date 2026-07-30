/**
 * What it takes to add an entry to each reference directory.
 *
 * Declared as data, in one place, so the Add form, the validation and the write
 * cannot disagree about what a customer or a supplier needs. Adding a field here
 * makes it appear in the form and be validated on the server — there is no
 * second list to keep in step.
 *
 * `help` text is mandatory on anything a non-specialist would hesitate over.
 * That is the same rule the table headers follow.
 */

import { INCOTERMS, INCOTERM_DEFS } from './incoterms';

export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface MasterField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Sensible starting value so the form is usable without typing everything. */
  defaultValue?: string | number | boolean;
  /** Halves the field so two sit on one row. */
  half?: boolean;
}

export interface MasterFormDef {
  /** Matches the section id on the Masters page. */
  type: string;
  /** Singular, for the button and the dialog title: "Add customer". */
  noun: string;
  description: string;
  fields: MasterField[];
}

const INDIAN_STATES: { value: string; label: string }[] = [
  ['27', 'Maharashtra'],
  ['07', 'Delhi'],
  ['29', 'Karnataka'],
  ['33', 'Tamil Nadu'],
  ['24', 'Gujarat'],
  ['36', 'Telangana'],
  ['06', 'Haryana'],
  ['09', 'Uttar Pradesh'],
  ['19', 'West Bengal'],
  ['32', 'Kerala'],
  ['23', 'Madhya Pradesh'],
  ['08', 'Rajasthan'],
  ['03', 'Punjab'],
  ['30', 'Goa'],
].map(([value, label]) => ({ value, label: `${label} (${value})` }));

export const MASTER_FORMS: MasterFormDef[] = [
  {
    type: 'customers',
    noun: 'customer',
    description:
      'Their registered state decides whether an invoice splits into central and state tax or carries a single integrated tax, so get it right here once.',
    fields: [
      { key: 'name', label: 'Registered name', type: 'text', required: true, half: true },
      {
        key: 'code',
        label: 'Customer code',
        type: 'text',
        required: true,
        half: true,
        help: 'A short internal handle. Must be unique.',
        placeholder: 'CUST-014',
      },
      {
        key: 'gstin',
        label: 'Goods and Services Tax Identification Number',
        type: 'text',
        half: true,
        help: 'Fifteen characters. Leave blank for an unregistered buyer — the invoice will then be treated as a supply to an unregistered person.',
        placeholder: '27AAACZ1234A1Z5',
      },
      {
        key: 'stateCode',
        label: 'State of registration',
        type: 'select',
        required: true,
        half: true,
        options: INDIAN_STATES,
        help: 'The place of supply. Same state as us means central plus state tax; a different state means integrated tax.',
        defaultValue: '27',
      },
      { key: 'addressLine1', label: 'Address', type: 'text', required: true },
      { key: 'city', label: 'City', type: 'text', required: true, half: true },
      { key: 'pincode', label: 'Postcode', type: 'text', required: true, half: true },
      {
        key: 'isSez',
        label: 'Special Economic Zone unit',
        type: 'boolean',
        help: 'Supplies to a zone unit are zero rated, and we raise them under our Letter of Undertaking rather than charging tax.',
      },
      {
        key: 'isExport',
        label: 'Export customer',
        type: 'boolean',
        help: 'Goods leaving India. Also zero rated.',
      },
      { key: 'contactName', label: 'Main contact', type: 'text', required: true, half: true },
      { key: 'contactEmail', label: 'Contact email', type: 'text', required: true, half: true },
      { key: 'contactPhone', label: 'Contact telephone', type: 'text', half: true },
      {
        key: 'paymentTerms',
        label: 'Payment terms',
        type: 'select',
        half: true,
        defaultValue: '30 days',
        options: ['Advance', '15 days', '30 days', '45 days', '60 days', '90 days'].map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        key: 'creditLimit',
        label: 'Credit limit',
        type: 'number',
        half: true,
        help: 'In rupees. Zero means every order must be paid in advance.',
        defaultValue: 0,
      },
    ],
  },
  {
    type: 'suppliers',
    noun: 'supplier',
    description:
      'An overseas supplier brings customs duty and import tax into the order; a domestic one charges tax on its own invoice. Bank details are printed on their proforma invoice.',
    fields: [
      { key: 'name', label: 'Registered name', type: 'text', required: true, half: true },
      {
        key: 'code',
        label: 'Supplier code',
        type: 'text',
        required: true,
        half: true,
        placeholder: 'SUP-021',
      },
      {
        key: 'isForeign',
        label: 'Overseas supplier',
        type: 'boolean',
        defaultValue: true,
        help: 'Turn this on for anyone outside India. It is what brings customs clearance and import tax into the order.',
      },
      { key: 'addressLine1', label: 'Address', type: 'text', required: true },
      { key: 'city', label: 'City', type: 'text', required: true, half: true },
      {
        key: 'country',
        label: 'Country',
        type: 'text',
        required: true,
        half: true,
        defaultValue: 'India',
      },
      { key: 'postcode', label: 'Postcode', type: 'text', half: true },
      {
        key: 'gstin',
        label: 'Goods and Services Tax Identification Number',
        type: 'text',
        half: true,
        help: 'Domestic suppliers only. Leave blank for an overseas supplier.',
      },
      {
        key: 'currency',
        label: 'Trading currency',
        type: 'select',
        required: true,
        half: true,
        defaultValue: 'USD',
        options: ['USD', 'INR', 'EUR', 'SGD', 'GBP', 'CNY', 'HKD', 'JPY'].map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        key: 'incoterms',
        label: 'Default delivery terms',
        type: 'select',
        half: true,
        defaultValue: 'FOB',
        options: INCOTERMS.map((v) => ({
          value: v,
          label: `${v} — ${INCOTERM_DEFS[v].name}`,
        })),
        help: 'Who pays for carriage and insurance, and where risk passes to us.',
      },
      { key: 'contactName', label: 'Main contact', type: 'text', required: true, half: true },
      { key: 'contactEmail', label: 'Contact email', type: 'text', required: true, half: true },
      { key: 'contactPhone', label: 'Contact telephone', type: 'text', half: true },
      { key: 'contactFax', label: 'Fax', type: 'text', half: true },
      { key: 'bankName', label: 'Beneficiary bank', type: 'text', half: true },
      { key: 'bankAddress', label: 'Bank address', type: 'text', half: true },
      { key: 'bankAccount', label: 'Beneficiary account number', type: 'text', half: true },
      {
        key: 'swiftCode',
        label: 'Society for Worldwide Interbank Financial Telecommunication code',
        type: 'text',
        half: true,
        help: 'The bank identifier used for an international transfer. Eight or eleven characters.',
      },
    ],
  },
  {
    type: 'rates',
    noun: 'tax rate',
    description:
      'Rates are looked up by product code AND date, so a historic invoice is taxed at the rate that applied then. Leave the end date blank for the rate currently in force.',
    fields: [
      {
        key: 'hsnCode',
        label: 'Product code',
        type: 'text',
        required: true,
        half: true,
        help: 'The Harmonised System of Nomenclature code the rate attaches to.',
        placeholder: '85423100',
      },
      {
        key: 'gstRate',
        label: 'Total tax rate',
        type: 'number',
        required: true,
        half: true,
        help: 'The full rate as a percentage. Within one state it is split half to central and half to state tax; across states the whole rate is charged as integrated tax. We work that out — enter the total.',
        defaultValue: 18,
      },
      { key: 'description', label: 'What the code covers', type: 'text', required: true },
      {
        key: 'cessRate',
        label: 'Compensation cess',
        type: 'number',
        half: true,
        defaultValue: 0,
        help: 'An extra levy on a few categories. Usually zero.',
      },
      {
        key: 'effectiveFrom',
        label: 'In force from',
        type: 'date',
        required: true,
        half: true,
        help: 'An invoice dated before this keeps whichever rate applied then.',
      },
      {
        key: 'effectiveTo',
        label: 'In force until',
        type: 'date',
        half: true,
        help: 'Leave blank while this is the current rate.',
      },
    ],
  },
  {
    type: 'labs',
    noun: 'testing laboratory',
    description: 'Where parts are sent for independent verification before we pay the supplier.',
    fields: [
      { key: 'name', label: 'Laboratory name', type: 'text', required: true, half: true },
      { key: 'code', label: 'Laboratory code', type: 'text', required: true, half: true },
      {
        key: 'isForeign',
        label: 'Outside India',
        type: 'boolean',
        help: 'Testing abroad happens before the goods are imported, which changes where the cost lands.',
      },
      { key: 'addressLine1', label: 'Address', type: 'text' },
      { key: 'city', label: 'City', type: 'text', half: true },
      {
        key: 'country',
        label: 'Country',
        type: 'text',
        half: true,
        defaultValue: 'India',
      },
      {
        key: 'gstin',
        label: 'Goods and Services Tax Identification Number',
        type: 'text',
        half: true,
        help: 'Indian laboratories only — it is what lets us reclaim the tax on their invoice.',
      },
      { key: 'contactEmail', label: 'Contact email', type: 'text', half: true },
      {
        key: 'accreditations',
        label: 'Accreditations',
        type: 'text',
        help: 'The standards they are accredited to, comma separated. This is what makes their report defensible.',
        placeholder: 'ISO/IEC 17025, NABL',
      },
    ],
  },
  {
    type: 'carriers',
    noun: 'carrier',
    description: 'Who moves the goods, and how much of their tracking we can read automatically.',
    fields: [
      { key: 'name', label: 'Carrier name', type: 'text', required: true, half: true },
      { key: 'code', label: 'Carrier code', type: 'text', required: true, half: true },
      {
        key: 'isIntegrated',
        label: 'Connected to their system',
        type: 'boolean',
        help: 'On means we can pull tracking automatically. Off means someone updates the shipment by hand — which is fine, it just has to be visible.',
      },
      {
        key: 'supportsPod',
        label: 'Provides proof of delivery',
        type: 'boolean',
        defaultValue: true,
        help: 'Whether they return a signed receipt. Without one, the customer settlement stage has no evidence behind it.',
      },
    ],
  },
  {
    type: 'parameters',
    noun: 'test parameter',
    description:
      'The checks a laboratory can be asked to perform. Selecting them on an order builds its test request.',
    fields: [
      { key: 'name', label: 'Parameter', type: 'text', required: true, half: true },
      { key: 'code', label: 'Parameter code', type: 'text', required: true, half: true },
      {
        key: 'category',
        label: 'Category',
        type: 'select',
        required: true,
        half: true,
        defaultValue: 'ELECTRICAL',
        options: [
          { value: 'ELECTRICAL', label: 'Electrical' },
          { value: 'FUNCTIONAL', label: 'Functional' },
          { value: 'XRAY', label: 'X-ray' },
          { value: 'DECAP', label: 'De-capsulation' },
          { value: 'SOLDERABILITY', label: 'Solderability' },
          { value: 'MARKING', label: 'Marking and packaging' },
          { value: 'MSL_BAKE', label: 'Moisture sensitivity bake' },
          { value: 'VISUAL', label: 'Visual' },
        ],
      },
      {
        key: 'method',
        label: 'Method or standard',
        type: 'text',
        half: true,
        help: 'The published method the laboratory follows, so a result means the same thing every time.',
      },
      {
        key: 'unit',
        label: 'Unit of measurement',
        type: 'text',
        half: true,
        help: 'Leave blank for a pass or fail check with no measured value.',
      },
      {
        key: 'isDefault',
        label: 'Include by default',
        type: 'boolean',
        help: 'On means this check is pre-selected whenever testing is requested.',
      },
    ],
  },
];

export function masterForm(type: string): MasterFormDef | undefined {
  return MASTER_FORMS.find((f) => f.type === type);
}
