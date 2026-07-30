/**
 * GLOSSARY & TOOLTIP CONTENT — §8.1 / §8.2.
 *
 * Tooltip text is DATA, never hardcoded in components. These are the defaults;
 * they are seeded into the `GlossaryTerm` table and can then be edited by ops
 * leads in Settings → Glossary & Tooltip Editor without a developer.
 *
 * Every entry follows the mandatory standard: What it is / Why it matters /
 * Example, plus optionally Who fills it in — written in plain English at roughly
 * an 8th-grade reading level, with no unexpanded acronyms.
 */

export interface GlossaryEntry {
  key: string;
  term: string;
  /** Plain English mode label (§8.2). */
  plainTerm?: string;
  whatItIs: string;
  whyItMatters: string;
  example: string;
  whoFillsItIn?: string;
  category:
    | 'po'
    | 'pi'
    | 'order'
    | 'tax'
    | 'logistics'
    | 'customs'
    | 'escrow'
    | 'testing'
    | 'inspection'
    | 'general';
}

export const GLOSSARY: GlossaryEntry[] = [
  // ── Parts & purchase orders ──────────────────────────────────────────────
  {
    key: 'mpn',
    term: 'MPN',
    plainTerm: 'Manufacturer part number',
    whatItIs: "The manufacturer's own code for a specific electronic part.",
    whyItMatters:
      'It is the only reliable way to be sure we buy and ship exactly the part the customer asked for. A near-match is the wrong part.',
    example: 'STM32F407VGT6',
    whoFillsItIn: "Taken straight from the customer's order.",
    category: 'po',
  },
  {
    key: 'manufacturer',
    term: 'Manufacturer',
    whatItIs: 'The company that actually makes the part.',
    whyItMatters:
      'The same part number can exist at different makers with different quality. It also affects which supplier we can source from.',
    example: 'STMicroelectronics',
    category: 'po',
  },
  {
    key: 'hsnCode',
    term: 'HSN Code',
    plainTerm: 'Customs product code',
    whatItIs: "The government's product code used to classify this part for customs and tax.",
    whyItMatters:
      'It decides how much import duty and GST apply. A wrong code causes customs delays, penalties, and wrong tax on the invoice.',
    example: '85423100',
    whoFillsItIn: "Procurement, from the manufacturer's datasheet.",
    category: 'po',
  },
  {
    key: 'quantity',
    term: 'Quantity',
    whatItIs: 'How many pieces of this part are being bought or sold.',
    whyItMatters: 'Drives the price, the packaging, and whether we can fully cover the order.',
    example: '5,000',
    category: 'po',
  },
  {
    key: 'uom',
    term: 'UoM',
    plainTerm: 'Unit of measure',
    whatItIs: 'The unit the quantity is counted in.',
    whyItMatters:
      'Reels, trays and loose pieces are not interchangeable. Getting this wrong changes the real quantity delivered.',
    example: 'PCS (pieces)',
    category: 'po',
  },
  {
    key: 'unitPrice',
    term: 'Unit price',
    whatItIs: 'The price of one piece, before tax.',
    whyItMatters: 'The basis for the line total, the tax and the margin.',
    example: '0.8500',
    category: 'po',
  },
  {
    key: 'lineTotal',
    term: 'Line total',
    whatItIs: 'Quantity multiplied by unit price, before tax.',
    whyItMatters: 'Adds up to the order value we invoice and the amount we owe the supplier.',
    example: 'INR 4,250.00',
    category: 'po',
  },
  {
    key: 'sourcingRef',
    term: 'RFQ / Sourcing ID',
    plainTerm: 'Enquiry number',
    whatItIs:
      'The reference for the enquiry this order came out of, from the sourcing step where suppliers were approached and quotes compared.',
    whyItMatters:
      'Sourcing happens before this platform picks the order up, so this is the one handle that ties the two together. With it, an auditor asking "why this supplier at this price" can be taken straight back to the quotes that were compared. Without it, that trail stops here.',
    example: 'RFQBUNDLE_7741',
    whoFillsItIn: 'Whoever ran the enquiry — Procurement or Sales / Ops.',
    category: 'po',
  },
  {
    key: 'incoterms',
    term: 'Incoterms',
    plainTerm: 'Delivery terms',
    whatItIs:
      'The standard three-letter code that says who pays for shipping and insurance, and where responsibility passes from seller to buyer.',
    whyItMatters:
      'It decides whether freight and insurance are our cost, and at what point the goods become our risk.',
    example: 'FOB (Free On Board)',
    category: 'po',
  },
  {
    key: 'paymentTerms',
    term: 'Payment terms',
    whatItIs: 'How long the buyer has to pay after being invoiced.',
    whyItMatters: 'Drives our cash flow and when the money actually arrives.',
    example: '30 days from invoice',
    category: 'po',
  },
  {
    key: 'testingRequired',
    term: 'Testing required',
    plainTerm: 'Needs lab testing',
    whatItIs: 'Whether this part must be checked by an independent lab before the full shipment moves.',
    whyItMatters:
      'Testing protects us from counterfeit or faulty parts, but it adds time and cost. It changes the whole path the order takes.',
    example: 'Yes',
    whoFillsItIn: 'Agreed between us and the customer, then with the supplier.',
    category: 'testing',
  },
  {
    key: 'dateCodeLot',
    term: 'Date code / Lot',
    whatItIs: 'The batch marking on the part showing when and where it was made.',
    whyItMatters:
      'Customers often refuse parts that are too old. It is also how we trace a problem back to a specific batch.',
    example: '2438 / LOT-A7734',
    category: 'po',
  },
  {
    key: 'msl',
    term: 'MSL',
    plainTerm: 'Moisture sensitivity level',
    whatItIs: 'How sensitive the part is to moisture in the air once its sealed bag is opened.',
    whyItMatters:
      'A moisture-sensitive part exposed too long can crack during soldering. It dictates how we store and repack it.',
    example: 'MSL 3 (168 hours exposure)',
    category: 'po',
  },
  {
    key: 'rohs',
    term: 'RoHS',
    plainTerm: 'Lead-free compliant',
    whatItIs: 'Whether the part meets the rules restricting hazardous substances such as lead.',
    whyItMatters: 'Non-compliant parts cannot legally be sold into many markets.',
    example: 'Yes',
    category: 'po',
  },
  {
    key: 'countryOfOrigin',
    term: 'Country of origin',
    whatItIs: 'The country the goods were manufactured in.',
    whyItMatters:
      'It affects the duty rate and whether any trade agreement applies. Customs will check it against the paperwork.',
    example: 'Malaysia',
    category: 'customs',
  },
  {
    key: 'leadTimeDays',
    term: 'Lead time',
    whatItIs: 'How many days the supplier needs before they can ship.',
    whyItMatters: "Tells us whether we can meet the customer's requested date.",
    example: '21 days',
    category: 'po',
  },

  // ── Proforma invoices ────────────────────────────────────────────────────
  {
    key: 'proformaInvoice',
    term: 'Proforma Invoice (PI)',
    plainTerm: 'Price quote invoice',
    whatItIs:
      'A formal quote laid out like an invoice. It is not a tax invoice and no tax is due on it.',
    whyItMatters:
      'It is what the customer approves and pays against before we commit to a supplier. It locks in price and terms.',
    example: 'PI-1B-0031',
    category: 'pi',
  },
  {
    key: 'piValidUntil',
    term: 'Valid until',
    whatItIs: 'The date after which our quoted prices are no longer guaranteed.',
    whyItMatters:
      'Component prices move fast. An expired quote we still honour can wipe out the margin.',
    example: '15 Aug 2026',
    category: 'pi',
  },

  // ── Work order & commercials ─────────────────────────────────────────────
  {
    key: 'workOrder',
    term: 'Work Order',
    plainTerm: 'Internal job',
    whatItIs:
      "The single internal job that ties together the customer's order, our quote, our supplier order and the supplier's quote.",
    whyItMatters:
      'It is the one place to see the whole deal end to end, instead of four disconnected documents.',
    example: 'CPO-ACME-0042_PI-1B-0031_PO-1B-0107_SPI-NXT-0088',
    category: 'order',
  },
  {
    key: 'canonicalName',
    term: 'Work Order name',
    whatItIs:
      "The full name built from four document numbers: customer's order, our quote, our supplier order, supplier's quote.",
    whyItMatters:
      'Anyone can tell at a glance exactly which four documents this job covers, without opening anything.',
    example: 'CPO-ACME-0042_PI-1B-0031_PO-1B-0107_SPI-PENDING',
    category: 'order',
  },
  {
    key: 'stage',
    term: 'Stage',
    plainTerm: 'Current step',
    whatItIs: 'Exactly which step of the process this order is sitting at right now.',
    whyItMatters:
      'It tells you who is holding the ball and what has to happen next. Everything else follows from it.',
    example: 'Testing in progress',
    category: 'order',
  },
  {
    key: 'paymentMethod',
    term: 'Payment method',
    whatItIs:
      'How the supplier gets paid: up front (advance), through a neutral third party (escrow), or later (credit).',
    whyItMatters:
      'It changes the risk we carry and adds or removes whole steps from the process.',
    example: 'Escrow',
    category: 'escrow',
  },
  {
    key: 'sellValue',
    term: 'Sell value',
    whatItIs: 'What we invoice the customer, before GST.',
    whyItMatters: 'The top line of the deal. GST is not included because it is not our money.',
    example: 'INR 14,00,000.00',
    category: 'order',
  },
  {
    key: 'buyValue',
    term: 'Buy value',
    whatItIs: 'What we pay the supplier, converted at the locked exchange rate.',
    whyItMatters: 'The biggest single component of our cost.',
    example: 'INR 10,00,000.00',
    category: 'order',
  },
  {
    key: 'landedCost',
    term: 'Landed cost',
    plainTerm: 'True total cost',
    whatItIs:
      'Everything it really costs to get saleable goods into our warehouse: the supplier price, non-recoverable duty, freight, insurance, testing, repacking and clearance.',
    whyItMatters:
      'It deliberately EXCLUDES the import GST, because we claim that back. Treating recoverable tax as cost makes every deal look worse than it is.',
    example: 'INR 12,16,000.00',
    category: 'tax',
  },
  {
    key: 'trueMargin',
    term: 'True margin',
    whatItIs: 'Sell value minus landed cost, with recoverable taxes correctly left out of cost.',
    whyItMatters: 'This is the real profit on the deal. It is the number to make decisions on.',
    example: 'INR 1,84,000.00 (13.1%)',
    category: 'tax',
  },
  {
    key: 'marginBeforeCredits',
    term: 'Margin before tax credits',
    whatItIs: 'What the margin would look like if recoverable taxes were wrongly counted as cost.',
    whyItMatters:
      'Shown next to true margin so you can see how much the tax credits are worth. On imports it can be the difference between an apparent loss and a real profit.',
    example: 'INR -24,800.00 (-1.8%)',
    category: 'tax',
  },
  {
    key: 'fxRate',
    term: 'Exchange rate (locked)',
    whatItIs: 'The currency rate we fixed when the terms were agreed.',
    whyItMatters:
      'Customs will use their own rate on the day, which will differ. We show the gap so nobody is surprised.',
    example: '1 USD = 83.20 INR',
    category: 'order',
  },
  {
    key: 'slaStatus',
    term: 'Timing',
    plainTerm: 'Running late?',
    whatItIs: 'Whether this order has been sitting at its current step longer than expected.',
    whyItMatters: 'Catches stuck orders before the customer notices.',
    example: 'At risk — 3 days over',
    category: 'order',
  },
  {
    key: 'coverage',
    term: 'Coverage',
    whatItIs: "How much of the customer's ordered quantity is actually covered by supplier orders.",
    whyItMatters:
      'Anything under 100% means we have promised something we have not yet bought.',
    example: '80% covered',
    category: 'order',
  },

  // ── Escrow ───────────────────────────────────────────────────────────────
  {
    key: 'escrowRef',
    term: 'Escrow reference',
    whatItIs: "The escrow provider's own number for the account holding this order's money.",
    whyItMatters: 'Quote it in any conversation with the escrow provider about this order.',
    example: 'ESC-2026-00418',
    category: 'escrow',
  },
  {
    key: 'escrowMilestone',
    term: 'Milestone',
    whatItIs:
      'The business condition a release is tied to — either enabling testing, or final settlement.',
    whyItMatters:
      'Money is never released as a loose amount. It is always tied to something that has actually happened.',
    example: 'Test enablement',
    category: 'escrow',
  },
  {
    key: 'escrowHeld',
    term: 'Held',
    whatItIs: 'Money sitting in escrow that has not yet been released to anyone.',
    whyItMatters: 'This is our exposure on the deal at this moment.',
    example: 'INR 8,00,000.00',
    category: 'escrow',
  },
  {
    key: 'dualAuthorisation',
    term: 'Dual authorisation',
    plainTerm: 'Two-person approval',
    whatItIs: 'Two different Finance users must each approve before the final release goes out.',
    whyItMatters:
      'One person can never release the full payment alone. It is the main control against error and fraud.',
    example: 'Approved by A. Rao and S. Mehta',
    category: 'escrow',
  },

  // ── Testing ──────────────────────────────────────────────────────────────
  {
    key: 'testScope',
    term: 'Test scope',
    whatItIs: 'Whether the lab tests a sample from the batch, or every single piece.',
    whyItMatters:
      'Full testing is far more thorough but slower and more expensive. Sampling is a calculated risk.',
    example: 'Lot sample — 50 pieces',
    category: 'testing',
  },
  {
    key: 'aql',
    term: 'AQL',
    plainTerm: 'Acceptable quality level',
    whatItIs: 'The agreed maximum share of faulty pieces that still counts as a pass.',
    whyItMatters:
      'Without it, "passed" means nothing. It is the line between accepting and rejecting a batch.',
    example: 'AQL 1.0',
    category: 'testing',
  },
  {
    key: 'testVerdict',
    term: 'Verdict',
    whatItIs: 'The result of testing: pass, fail, or partial where only some sub-lots passed.',
    whyItMatters:
      'A pass releases the shipment. A fail blocks the order until someone decides what to do.',
    example: 'Pass',
    category: 'testing',
  },

  // ── Logistics ────────────────────────────────────────────────────────────
  {
    key: 'awb',
    term: 'AWB',
    plainTerm: 'Tracking number',
    whatItIs: 'The air waybill number — the courier\'s tracking number for this shipment.',
    whyItMatters: 'It is how we and the customer follow where the goods are.',
    example: '1234567890',
    category: 'logistics',
  },
  {
    key: 'shipmentLeg',
    term: 'Leg',
    whatItIs: 'Which of the four separate journeys this shipment is.',
    whyItMatters:
      'Each leg has its own courier, cost and paperwork. Mixing them up loses track of the goods.',
    example: 'Leg 3 — Supplier to us (import)',
    category: 'logistics',
  },
  {
    key: 'chargeableWeight',
    term: 'Chargeable weight',
    whatItIs:
      'The weight the courier actually bills for — the greater of real weight and volume-based weight.',
    whyItMatters: 'Light but bulky boxes cost far more than their real weight suggests.',
    example: '18.5 kg',
    category: 'logistics',
  },
  {
    key: 'pod',
    term: 'POD',
    plainTerm: 'Delivery proof',
    whatItIs: 'The signed or stamped confirmation that the customer received the goods.',
    whyItMatters:
      'It closes the delivery obligation and is our evidence in any later dispute about whether goods arrived.',
    example: 'POD-2026-0184, signed by R. Nair',
    category: 'logistics',
  },

  // ── Customs ──────────────────────────────────────────────────────────────
  {
    key: 'boe',
    term: 'Bill of Entry',
    plainTerm: 'Customs entry form',
    whatItIs: 'The formal declaration filed with Indian customs to import a consignment.',
    whyItMatters: 'Nothing clears customs without it. Its number tracks the whole clearance.',
    example: '7654321',
    whoFillsItIn: 'The customs agent (WHA) files it on our behalf.',
    category: 'customs',
  },
  {
    key: 'bcd',
    term: 'BCD',
    plainTerm: 'Basic import duty',
    whatItIs: 'Basic Customs Duty — the main import tax on the goods.',
    whyItMatters:
      'We cannot claim this back, so it is a real cost that must be included in landed cost.',
    example: 'INR 1,00,000.00',
    category: 'customs',
  },
  {
    key: 'sws',
    term: 'SWS',
    plainTerm: 'Extra import charge',
    whatItIs: 'Social Welfare Surcharge — an additional charge calculated on the basic duty.',
    whyItMatters: 'Also not recoverable, so it is part of our real cost.',
    example: 'INR 10,000.00',
    category: 'customs',
  },
  {
    key: 'importIgst',
    term: 'IGST paid at import',
    plainTerm: 'Import GST (recoverable)',
    whatItIs: 'The GST charged on the import at the border.',
    whyItMatters:
      'We claim this back as input credit, so it must NOT be counted as cost. Counting it wrongly makes every import look unprofitable.',
    example: 'INR 1,99,800.00',
    category: 'tax',
  },
  {
    key: 'customsExchangeRate',
    term: 'Customs exchange rate',
    whatItIs: 'The rate customs used to value the goods, which is set by them, not by us.',
    whyItMatters:
      'It will differ from our locked rate, which changes the duty we pay. We show the difference.',
    example: '1 USD = 83.85 INR',
    category: 'customs',
  },
  {
    key: 'outOfCharge',
    term: 'Out of charge',
    plainTerm: 'Released by customs',
    whatItIs: 'The final customs clearance that permits the goods to leave the port.',
    whyItMatters: 'Until this happens the goods cannot move, and storage charges keep accruing.',
    example: '18 Jul 2026',
    category: 'customs',
  },

  // ── Tax ──────────────────────────────────────────────────────────────────
  {
    key: 'gstin',
    term: 'GSTIN',
    plainTerm: 'GST number',
    whatItIs: "A business's 15-character GST registration number.",
    whyItMatters:
      "Without a valid one we cannot raise a proper tax invoice, and the customer cannot claim their credit. The last character is a check digit, so typos are caught.",
    example: '29AABCU9603R1ZJ',
    category: 'tax',
  },
  {
    key: 'placeOfSupply',
    term: 'Place of supply',
    whatItIs: 'The state the goods are being delivered to.',
    whyItMatters:
      'It decides whether we charge IGST, or split the tax into CGST and SGST. Getting it wrong means an incorrect invoice.',
    example: 'Karnataka (29)',
    category: 'tax',
  },
  {
    key: 'taxTreatment',
    term: 'Tax treatment',
    whatItIs: 'Which GST rule applies to this sale.',
    whyItMatters:
      'Same state splits into CGST plus SGST; different state uses a single IGST; exports and special zones are zero-rated.',
    example: 'Inter-state (IGST)',
    category: 'tax',
  },
  {
    key: 'cgst',
    term: 'CGST',
    plainTerm: 'Central GST',
    whatItIs: 'The central government half of the tax on a sale inside our own state.',
    whyItMatters: 'Always paired with SGST at the same rate, and always equal to it.',
    example: '9% — INR 9,000.00',
    category: 'tax',
  },
  {
    key: 'sgst',
    term: 'SGST',
    plainTerm: 'State GST',
    whatItIs: 'The state government half of the tax on a sale inside our own state.',
    whyItMatters: 'Always equal to CGST. If the two differ, something is wrong.',
    example: '9% — INR 9,000.00',
    category: 'tax',
  },
  {
    key: 'igst',
    term: 'IGST',
    plainTerm: 'Inter-state GST',
    whatItIs: 'The single tax charged when goods go to a different state, or are imported.',
    whyItMatters: 'It replaces the CGST plus SGST split. The total rate is the same.',
    example: '18% — INR 18,000.00',
    category: 'tax',
  },
  {
    key: 'taxableValue',
    term: 'Taxable value',
    whatItIs: 'The amount the tax is calculated on, before the tax is added.',
    whyItMatters: 'Tax is worked out line by line on this figure, then added up.',
    example: 'INR 1,00,000.00',
    category: 'tax',
  },
  {
    key: 'irn',
    term: 'IRN',
    plainTerm: 'E-invoice reference',
    whatItIs:
      'The unique reference the government portal returns when an invoice is registered electronically.',
    whyItMatters:
      'For invoices above the threshold, an invoice without an IRN and its signed QR code is not a valid tax invoice.',
    example: '35f1b2c4d5e6…',
    category: 'tax',
  },
  {
    key: 'ewayBill',
    term: 'E-way bill',
    plainTerm: 'Goods movement permit',
    whatItIs: 'The electronic permit required to move goods above a set value.',
    whyItMatters:
      'Moving goods without a valid one risks the vehicle being detained and a penalty. It also expires.',
    example: 'EWB 3210 9876 5432',
    category: 'tax',
  },
  {
    key: 'itc',
    term: 'Input Tax Credit',
    plainTerm: 'GST we can claim back',
    whatItIs: 'GST we have already paid on purchases, which we set against the GST we collect.',
    whyItMatters:
      'It is real money back. It is also why recoverable taxes must never be treated as cost.',
    example: 'INR 2,08,800.00 available',
    category: 'tax',
  },
  {
    key: 'reverseCharge',
    term: 'Reverse charge',
    whatItIs:
      'Where the buyer, not the seller, accounts for the GST — used when we buy services from abroad.',
    whyItMatters:
      'We raise a self-invoice, book the tax as owed, and claim the same amount back. Net cash effect is nil, but it must be recorded.',
    example: 'Foreign lab testing — IGST 18% self-invoiced',
    category: 'tax',
  },
  {
    key: 'gstr2b',
    term: 'GSTR-2B match',
    whatItIs:
      'Whether the credit we are claiming also appears in the government statement of what our suppliers reported.',
    whyItMatters:
      'Credit that does not appear there is likely to be challenged. Unmatched items need chasing.',
    example: 'Matched',
    category: 'tax',
  },

  // ── Inspection & warehouse ───────────────────────────────────────────────
  {
    key: 'grn',
    term: 'GRN',
    plainTerm: 'Goods received note',
    whatItIs: 'The record raised when a consignment physically arrives with us.',
    whyItMatters:
      'It is where we first find out if anything is short or damaged, which is far easier to claim early.',
    example: 'GRN-2026-0221',
    category: 'inspection',
  },
  {
    key: 'inspectionVerdict',
    term: 'Inspection result',
    whatItIs: 'Whether what arrived passed our own detailed check.',
    whyItMatters:
      'A pass is the gate that unlocks the final payment to the supplier. Nothing is released before it.',
    example: 'Passed',
    category: 'inspection',
  },
  {
    key: 'ncr',
    term: 'NCR',
    plainTerm: 'Problem report',
    whatItIs: 'A non-conformance report — the formal record that something was not as it should be.',
    whyItMatters: 'It is the basis for any claim against the supplier or insurer.',
    example: 'NCR-2026-0007',
    category: 'inspection',
  },
  {
    key: 'repackJob',
    term: 'Repack job',
    whatItIs: 'The work of relabelling the goods under our own brand and packing them for the customer.',
    whyItMatters:
      'This is the value we add as Merchant of Record. It is also a cost, and it is where serial numbers get captured.',
    example: 'RPK-2026-0119',
    category: 'inspection',
  },

  // ── General / platform ───────────────────────────────────────────────────
  {
    key: 'provenance',
    term: 'Where this came from',
    whatItIs:
      'Whether this value was typed in by a person, fetched automatically from an external system, or produced by the built-in simulator.',
    whyItMatters:
      'You should never have to guess whether a customs status was typed by a colleague or came from the customs system itself.',
    example: 'API — fetched 18 Jul 2026, 14:02',
    category: 'general',
  },
  {
    key: 'connectorMode',
    term: 'Connector mode',
    whatItIs:
      'How an external system is currently wired up: live, sandbox, simulated (mock), or fully manual.',
    whyItMatters:
      'In manual mode nothing is automated and a person must enter everything. The platform works either way.',
    example: 'Mock',
    category: 'general',
  },
  {
    key: 'avlStatus',
    term: 'AVL status',
    plainTerm: 'Approval status',
    whatItIs: 'Whether this supplier is currently approved for us to buy from.',
    whyItMatters:
      'We are only allowed to raise purchase orders on approved, unexpired vendors. The system enforces it.',
    example: 'Approved until 31 Mar 2027',
    category: 'general',
  },
  {
    key: 'exceptionType',
    term: 'Problem type',
    whatItIs: 'What kind of thing has gone wrong and knocked the order off its normal path.',
    whyItMatters: 'It determines the options available to get the order moving again.',
    example: 'Test failed',
    category: 'general',
  },
];

export const GLOSSARY_BY_KEY: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((g) => [g.key, g]),
);

export function glossary(key: string): GlossaryEntry | undefined {
  return GLOSSARY_BY_KEY[key];
}
