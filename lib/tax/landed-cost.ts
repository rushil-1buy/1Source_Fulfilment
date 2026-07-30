/**
 * LANDED COST & MARGIN (master prompt §9 correctness rule).
 *
 * The rule that materially changes reported margin:
 *   INCLUDE  — supplier value (at locked FX), BCD, Social Welfare Surcharge,
 *              other non-creditable levies, freight, insurance, testing,
 *              repack, clearance, escrow fees.
 *   EXCLUDE  — IGST paid at import and any other creditable GST, because those
 *              are recoverable as Input Tax Credit and are NOT a cost.
 *
 * Getting this backwards overstates cost and understates margin on every single
 * import, so both figures are reported side by side:
 *   marginBeforeCredits — what you'd see if creditable taxes were wrongly expensed
 *   trueMargin          — the correct figure
 */

export interface LandedCostInput {
  /** Supplier value converted to base currency at the locked FX rate. */
  buyValue: number;
  // Customs levies
  dutyBcd: number;
  dutySws: number;
  dutyIgst: number;
  dutyCess: number;
  // Other creditable GST (freight GST, testing GST, repack GST)
  creditableGstOther: number;
  // Cost components
  freightCost: number;
  insuranceCost: number;
  testingCost: number;
  repackCost: number;
  clearanceCost: number;
  escrowFee: number;
}

export interface CostComponent {
  key: string;
  label: string;
  plainLabel: string;
  amount: number;
  included: boolean;
  /** Why it is or is not part of landed cost. */
  reason: string;
}

export interface LandedCostResult {
  components: CostComponent[];
  /** Sum of everything that is genuinely a cost. */
  landedCost: number;
  /** Sum of taxes we get back as Input Tax Credit — deliberately NOT a cost. */
  creditableTaxes: number;
  /** Levies that are real costs because they cannot be credited. */
  nonCreditableLevies: number;
  explain: string[];
}

export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const components: CostComponent[] = [
    {
      key: 'buyValue',
      label: 'Supplier value (at locked FX)',
      plainLabel: 'What we pay the supplier',
      amount: input.buyValue,
      included: true,
      reason: 'The price of the goods themselves.',
    },
    {
      key: 'dutyBcd',
      label: 'Basic Customs Duty (BCD)',
      plainLabel: 'Import duty',
      amount: input.dutyBcd,
      included: true,
      reason: 'Not creditable — this is a real, unrecoverable cost.',
    },
    {
      key: 'dutySws',
      label: 'Social Welfare Surcharge (SWS)',
      plainLabel: 'Extra import charge',
      amount: input.dutySws,
      included: true,
      reason: 'Not creditable — a real, unrecoverable cost.',
    },
    {
      key: 'dutyIgst',
      label: 'IGST paid at import',
      plainLabel: 'Import GST (we get this back)',
      amount: input.dutyIgst,
      included: false,
      reason: 'Recoverable as Input Tax Credit, so it is NOT a cost. Excluded by design.',
    },
    {
      key: 'dutyCess',
      label: 'Compensation cess',
      plainLabel: 'Cess (we get this back)',
      amount: input.dutyCess,
      included: false,
      reason:
        'Creditable (utilisation is restricted to cess liability), so it is excluded from cost.',
    },
    {
      key: 'creditableGstOther',
      label: 'Other creditable GST (freight, testing, repack)',
      plainLabel: 'Other GST we get back',
      amount: input.creditableGstOther,
      included: false,
      reason: 'Recoverable as Input Tax Credit, so not a cost.',
    },
    {
      key: 'freightCost',
      label: 'Freight',
      plainLabel: 'Shipping charges',
      amount: input.freightCost,
      included: true,
      reason: 'Cost of moving the goods (the GST on it is credited separately).',
    },
    {
      key: 'insuranceCost',
      label: 'Insurance',
      plainLabel: 'Insurance',
      amount: input.insuranceCost,
      included: true,
      reason: 'Cost of insuring the consignment.',
    },
    {
      key: 'testingCost',
      label: 'Laboratory testing',
      plainLabel: 'Lab testing charges',
      amount: input.testingCost,
      included: true,
      reason: 'Third-party testing is a cost of getting saleable goods.',
    },
    {
      key: 'repackCost',
      label: 'Rebrand & repack',
      plainLabel: 'Relabelling and repacking',
      amount: input.repackCost,
      included: true,
      reason: 'Our own value-add cost as Merchant of Record.',
    },
    {
      key: 'clearanceCost',
      label: 'Customs clearance charges',
      plainLabel: 'Customs agent fees',
      amount: input.clearanceCost,
      included: true,
      reason: "The customs agent's fees.",
    },
    {
      key: 'escrowFee',
      label: 'Escrow fees',
      plainLabel: 'Escrow charges',
      amount: input.escrowFee,
      included: true,
      reason: 'Cost of using escrow to de-risk the payment.',
    },
  ];

  const landedCost = components
    .filter((c) => c.included)
    .reduce((acc, c) => acc + c.amount, 0);
  const creditableTaxes = components
    .filter((c) => !c.included)
    .reduce((acc, c) => acc + c.amount, 0);
  const nonCreditableLevies = input.dutyBcd + input.dutySws;

  return {
    components,
    landedCost,
    creditableTaxes,
    nonCreditableLevies,
    explain: [
      'Landed cost includes BCD and Social Welfare Surcharge because those cannot be recovered.',
      'It EXCLUDES import IGST and other creditable GST, because we claim those back as Input Tax Credit — treating them as cost would understate margin on every import.',
    ],
  };
}

export interface MarginResult {
  /** Sell value excluding GST — output GST is not revenue. */
  sellValue: number;
  landedCost: number;
  creditableTaxes: number;
  /** The correct margin. */
  trueMargin: number;
  trueMarginPct: number;
  /** What margin would look like if creditable taxes were wrongly expensed. */
  marginBeforeCredits: number;
  marginBeforeCreditsPct: number;
  /** How much the credits are worth — the gap between the two figures. */
  creditBenefit: number;
  belowFloor: boolean;
  explain: string[];
}

export function computeMargin(params: {
  sellValue: number;
  landed: LandedCostResult;
  marginFloorPct?: number;
}): MarginResult {
  const { sellValue, landed } = params;
  const floor = params.marginFloorPct ?? 0;
  const trueMargin = sellValue - landed.landedCost;
  const marginBeforeCredits = sellValue - (landed.landedCost + landed.creditableTaxes);
  const pct = (m: number) => (sellValue > 0 ? (m / sellValue) * 100 : 0);

  return {
    sellValue,
    landedCost: landed.landedCost,
    creditableTaxes: landed.creditableTaxes,
    trueMargin,
    trueMarginPct: pct(trueMargin),
    marginBeforeCredits,
    marginBeforeCreditsPct: pct(marginBeforeCredits),
    creditBenefit: trueMargin - marginBeforeCredits,
    belowFloor: pct(trueMargin) < floor,
    explain: [
      'Sell value excludes the GST we charge the customer — that tax is collected on the government\'s behalf, not revenue.',
      `True margin of ${pct(trueMargin).toFixed(1)}% is the correct figure. The lower "before credits" figure of ${pct(
        marginBeforeCredits,
      ).toFixed(1)}% is what you would wrongly report if recoverable taxes were treated as cost.`,
    ],
  };
}
