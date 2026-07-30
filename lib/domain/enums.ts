/**
 * Authoritative union types for the enum-ish String columns in the Prisma
 * schema. SQLite has no native enum, so these are the single source of truth
 * and are validated with Zod at every write boundary.
 */

export const STAKEHOLDERS = [
  'ONE_BUY',
  'CUSTOMER',
  'SUPPLIER',
  'ESCROW',
  'WHL',
  'WHA',
  'LOGISTICS',
] as const;
export type Stakeholder = (typeof STAKEHOLDERS)[number];

/**
 * No abbreviations in the interface. `short` exists only for genuinely tight
 * spaces, and even there it holds a real word rather than a two-letter code —
 * "CUS", "SUP", "ESC" and "1B" told a new operator nothing.
 */
export const STAKEHOLDER_META: Record<
  Stakeholder,
  { label: string; short: string; plainLabel: string; token: string }
> = {
  ONE_BUY: { label: '1BUY', short: '1BUY', plainLabel: 'Us (1BUY)', token: 'onebuy' },
  CUSTOMER: { label: 'Customer', short: 'Customer', plainLabel: 'Customer', token: 'customer' },
  SUPPLIER: { label: 'Supplier', short: 'Supplier', plainLabel: 'Supplier', token: 'supplier' },
  ESCROW: {
    label: 'Escrow Provider',
    short: 'Escrow',
    plainLabel: 'Escrow provider (holds the money)',
    token: 'escrow',
  },
  WHL: {
    label: 'Testing Laboratory',
    short: 'Testing Lab',
    plainLabel: 'Independent testing laboratory',
    token: 'whl',
  },
  WHA: {
    label: 'Customs Agent',
    short: 'Customs Agent',
    plainLabel: 'Customs and compliance agent',
    token: 'wha',
  },
  LOGISTICS: {
    label: 'Logistics Partner',
    short: 'Logistics',
    plainLabel: 'Courier or freight partner',
    token: 'logistics',
  },
};

export const ROLES = [
  'Admin',
  'SalesOps',
  'Procurement',
  'Finance',
  'QCWarehouse',
  'Compliance',
  'Viewer',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  Admin: { label: 'Admin', description: 'Full access, including settings and demo controls.' },
  SalesOps: { label: 'Sales / Ops', description: 'Customer POs, PIs, customer communication.' },
  Procurement: { label: 'Procurement', description: 'Supplier POs, AVL, testing, logistics.' },
  Finance: {
    label: 'Finance',
    description: 'Sole authority for escrow release. Final release needs two Finance approvers.',
  },
  QCWarehouse: { label: 'QC / Warehouse', description: 'Inbound, inspection, repack, outbound.' },
  Compliance: { label: 'Compliance', description: 'Customs, tax, registers and audit.' },
  Viewer: { label: 'Viewer / Auditor', description: 'Read-only across everything.' },
};

export const PAYMENT_METHODS = ['ADVANCE', 'ESCROW', 'CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_META: Record<PaymentMethod, { label: string; plainLabel: string }> = {
  ADVANCE: { label: 'Advance', plainLabel: 'Paid up front' },
  ESCROW: { label: 'Escrow', plainLabel: 'Money held by a neutral third party' },
  CREDIT: { label: 'Credit', plainLabel: 'Pay later, on agreed terms' },
};

export const TEST_SCOPES = ['LOT_SAMPLE', 'FULL_BATCH'] as const;
export type TestScope = (typeof TEST_SCOPES)[number];

export const TEST_SCOPE_META: Record<TestScope, { label: string; plainLabel: string }> = {
  LOT_SAMPLE: { label: 'Lot sample', plainLabel: 'Test a sample from the lot' },
  FULL_BATCH: { label: 'Full batch', plainLabel: 'Test every piece' },
};

export const TEST_VERDICTS = ['PASS', 'FAIL', 'PARTIAL'] as const;
export type TestVerdict = (typeof TEST_VERDICTS)[number];

export const PROVENANCES = ['MANUAL', 'API', 'MOCK'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_META: Record<
  Provenance,
  { label: string; description: string; tone: 'neutral' | 'info' | 'warning' }
> = {
  MANUAL: {
    label: 'Manual',
    description: 'A person typed or uploaded this.',
    tone: 'neutral',
  },
  API: {
    label: 'API',
    description: 'Fetched automatically from the connected external system.',
    tone: 'info',
  },
  MOCK: {
    label: 'Mock',
    description: 'Produced by the built-in simulator, not a live external system.',
    tone: 'warning',
  },
};

export const CONNECTOR_IDS = ['WHL', 'DHL', 'ICEGATE', 'ESCROW', 'GST_GSP'] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const CONNECTOR_MODES = [
  'MOCK',
  'MANUAL',
  'SANDBOX',
  'LIVE',
  'NOT_CONFIGURED',
] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number];

export const CONNECTOR_MODE_META: Record<
  ConnectorMode,
  { label: string; description: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }
> = {
  MOCK: {
    label: 'Mock',
    description: 'Built-in simulator returns deterministic data. Nothing leaves this machine.',
    tone: 'warning',
  },
  MANUAL: {
    label: 'Manual',
    description: 'No automation. Everything is entered by a person.',
    tone: 'neutral',
  },
  SANDBOX: { label: 'Sandbox', description: "Vendor's test environment.", tone: 'info' },
  LIVE: { label: 'Live', description: 'Real production traffic.', tone: 'success' },
  NOT_CONFIGURED: {
    label: 'Not configured',
    description: 'No credentials supplied yet.',
    tone: 'danger',
  },
};

export const TAX_TREATMENTS = [
  'INTRA_STATE',
  'INTER_STATE',
  'ZERO_RATED_SEZ',
  'ZERO_RATED_EXPORT',
] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TAX_TREATMENT_META: Record<
  TaxTreatment,
  { label: string; plainLabel: string; heads: string }
> = {
  INTRA_STATE: {
    label: 'Intra-state',
    plainLabel: 'Same state — split tax',
    heads: 'CGST + SGST',
  },
  INTER_STATE: {
    label: 'Inter-state',
    plainLabel: 'Different state — single tax',
    heads: 'IGST',
  },
  ZERO_RATED_SEZ: {
    label: 'Zero-rated (SEZ)',
    plainLabel: 'Special zone — no tax charged',
    heads: 'None',
  },
  ZERO_RATED_EXPORT: {
    label: 'Zero-rated (export)',
    plainLabel: 'Sent abroad — no tax charged',
    heads: 'None',
  },
};

export const SHIPMENT_LEGS = ['TEST_OUT', 'TEST_RETURN', 'IMPORT', 'OUTBOUND'] as const;
export type ShipmentLeg = (typeof SHIPMENT_LEGS)[number];

export const SHIPMENT_LEG_META: Record<
  ShipmentLeg,
  { label: string; legNo: number; plainLabel: string; route: string }
> = {
  TEST_OUT: {
    label: 'Leg 1 · Test dispatch',
    legNo: 1,
    plainLabel: 'Parts going to the testing lab',
    route: 'Supplier → Testing Laboratory',
  },
  TEST_RETURN: {
    label: 'Leg 2 · Test return',
    legNo: 2,
    plainLabel: 'Parts coming back from the lab',
    route: 'Testing Laboratory → Supplier',
  },
  IMPORT: {
    label: 'Leg 3 · Import',
    legNo: 3,
    plainLabel: 'Full shipment coming to us',
    route: 'Supplier → 1BUY',
  },
  OUTBOUND: {
    label: 'Leg 4 · Outbound',
    legNo: 4,
    plainLabel: 'Final delivery to the customer',
    route: '1BUY → Customer',
  },
};

export const EXCEPTION_TYPES = [
  'TEST_FAIL',
  'CUSTOMS_HOLD',
  'SHORT_SHIPMENT',
  'DAMAGED_INBOUND',
  'ESCROW_DISPUTE',
  'SUPPLIER_DELAY',
  'CHANGE_ORDER',
  'DELIVERY_FAILURE',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/**
 * Who funds the escrow, and against which value. Negotiated per order in the
 * terms between 1BUY and the supplier, so the platform must never assume one.
 */
export const ESCROW_FUNDERS = ['SUPPLIER', 'ONE_BUY', 'BOTH'] as const;
export type EscrowFunder = (typeof ESCROW_FUNDERS)[number];

/**
 * `partyLabel` is the mid-sentence form — "funded by the supplier". Prose that
 * needs it must read it from here rather than lower-casing the code, or the
 * voucher ends up saying "funded by one buy".
 */
export const ESCROW_FUNDER_META: Record<
  EscrowFunder,
  { label: string; partyLabel: string; plainLabel: string }
> = {
  SUPPLIER: {
    label: 'Supplier funds',
    partyLabel: 'the supplier',
    plainLabel: 'The supplier puts the money into escrow',
  },
  ONE_BUY: {
    label: '1BUY funds',
    partyLabel: 'us',
    plainLabel: 'We put the money in from our own working capital',
  },
  BOTH: {
    label: 'Shared',
    partyLabel: 'both parties',
    plainLabel: 'The supplier funds part, we fund the balance',
  },
};

/** Reads the meta for a stored value, falling back to the platform default. */
export function escrowFunderMeta(code: string | null | undefined) {
  return ESCROW_FUNDER_META[(code as EscrowFunder) ?? 'ONE_BUY'] ?? ESCROW_FUNDER_META.ONE_BUY;
}

export const ESCROW_BASES = ['SELL_VALUE', 'BUY_VALUE', 'CUSTOM'] as const;
export type EscrowBasis = (typeof ESCROW_BASES)[number];

export const ESCROW_BASIS_META: Record<EscrowBasis, { label: string; plainLabel: string }> = {
  SELL_VALUE: {
    label: 'Sell value',
    plainLabel: 'What the customer owes us',
  },
  BUY_VALUE: {
    label: 'Buy value',
    plainLabel: 'What we owe the supplier',
  },
  CUSTOM: {
    label: 'Negotiated amount',
    plainLabel: 'A specific figure agreed in the terms',
  },
};

export const ESCROW_MILESTONES = ['TEST_ENABLEMENT', 'FINAL_SETTLEMENT'] as const;
export type EscrowMilestone = (typeof ESCROW_MILESTONES)[number];

export const ESCROW_MILESTONE_META: Record<
  EscrowMilestone,
  { label: string; plainLabel: string; gate: string }
> = {
  TEST_ENABLEMENT: {
    label: 'Test enablement',
    plainLabel: 'Part-payment so the supplier can send parts for testing',
    gate: 'Escrow must be funded',
  },
  FINAL_SETTLEMENT: {
    label: 'Final settlement',
    plainLabel: 'Full remaining payment to the supplier',
    gate: 'Inbound inspection must have passed, and two Finance approvers must sign',
  },
};

export const COMM_CHANNELS = [
  'EMAIL',
  'WHATSAPP',
  'PHONE',
  'PORTAL',
  'MEETING',
  'COURIER',
  'SYSTEM',
] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export const COMM_CHANNEL_META: Record<CommChannel, { label: string; icon: string }> = {
  EMAIL: { label: 'Email', icon: 'Mail' },
  WHATSAPP: { label: 'WhatsApp', icon: 'MessageCircle' },
  PHONE: { label: 'Phone call', icon: 'Phone' },
  PORTAL: { label: 'Portal message', icon: 'MonitorSmartphone' },
  MEETING: { label: 'Meeting', icon: 'Users' },
  COURIER: { label: 'Letter / courier', icon: 'Package' },
  SYSTEM: { label: 'System event', icon: 'Activity' },
};

export const CURRENCY_META: Record<string, { symbol: string; minorPerMajor: number; label: string }> =
  {
    INR: { symbol: '₹', minorPerMajor: 100, label: 'Indian Rupee' },
    USD: { symbol: '$', minorPerMajor: 100, label: 'US Dollar' },
    EUR: { symbol: '€', minorPerMajor: 100, label: 'Euro' },
    SGD: { symbol: 'S$', minorPerMajor: 100, label: 'Singapore Dollar' },
  };

/** Indian state codes used for place-of-supply derivation. */
export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '19', name: 'West Bengal' },
  { code: '21', name: 'Odisha' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
];

export function stateName(code: string): string {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
}
