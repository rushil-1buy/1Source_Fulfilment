/**
 * Documents that look like the documents they are.
 *
 * Every simulated document used to open to four lines — its own title, the work
 * order, the stage, and a sentence saying the agent filed it. Twenty-five
 * documents on an order, all reading the same, which teaches a viewer that the
 * register is decorative and that nothing behind it is real. The paperwork IS
 * the trade: a bill of entry that does not carry an assessable value and a duty
 * breakdown is not a bill of entry, it is a label.
 *
 * So each type is rendered with the fields its real counterpart carries — the
 * ones somebody would actually look for. A commercial invoice states its
 * delivery term and the place, because that is what customs assess against. A
 * packing list breaks down by carton with net and gross weights, because that
 * is what the receiving dock counts against. A test report cites its methods
 * and its sample plan, because a verdict without them is an opinion.
 *
 * ONE RENDERER, TWO CALLERS. The seed and the autonomous agent both come here.
 * Two generators would drift, and the first symptom would be a demonstration
 * where the seeded orders and the simulated one disagree about what a document
 * looks like.
 *
 * NOTHING HERE INVENTS A FIGURE THAT MATTERS. Amounts, parties, part numbers,
 * quantities and references come from the order. What is synthesised is what a
 * real document carries but this platform does not model — carton dimensions, a
 * bank's branch address — and those are visibly incidental. A document that
 * invented its own totals would be worse than the stub it replaced.
 */

import { formatMoney, fromMinor } from './money';
import { incotermFor } from './incoterms';
import { normaliseDocType } from './document-flow';

export interface DocLine {
  mpn: string;
  manufacturer: string;
  description: string;
  hsnCode: string;
  qty: number;
  uom: string;
  /** Minor units, in the currency of the document being rendered. */
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface DocContext {
  alias: string;
  canonicalName: string;
  /** ISO date the document is dated. */
  docDate: string;

  org: {
    legalName: string;
    address: string;
    gstin: string;
    iec: string;
    country: string;
  };
  customer: { name: string; address: string; gstin: string | null; contact: string | null };
  supplier: { name: string; country: string; currency: string };

  refs: {
    customerPo: string;
    supplierPo: string;
    customerPi: string | null;
    supplierPi: string | null;
  };

  terms: {
    buyIncoterms: string;
    sellIncoterms: string | null;
    paymentMethod: string;
    fxRate: number;
  };

  lines: DocLine[];
  buyCurrency: string;
  sellCurrency: string;
  buyValueMinor: number;
  sellValueMinor: number;

  /** Filled where the order has reached the step that produces them. */
  escrow?: { ref: string; provider: string; agreedMinor: number; releaseCondition: string } | null;
  shipment?: { awb: string | null; carrier: string; origin: string; destination: string } | null;
  customs?: { beNumber: string; port: string; chaLicence: string } | null;
  invoice?: { number: string; irn: string | null; ewayBill: string | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers — a document reads as a document or it reads as a dump
// ─────────────────────────────────────────────────────────────────────────────

const RULE = '─'.repeat(74);

/** A titled block of label/value pairs, aligned so the eye can scan the column. */
function block(title: string, rows: [string, string | null | undefined][]): string {
  const kept = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (kept.length === 0) return '';
  const width = Math.max(...kept.map(([k]) => k.length));
  return [title, ...kept.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`)].join('\n');
}

/** Two blocks side by side is a table nobody can read in a monospace column. */
function section(title: string, body: string): string {
  return `${title}\n${RULE}\n${body}`;
}

const money = (minor: number, currency: string) =>
  formatMoney(minor, currency, { withSymbol: true });

/** The goods table every shipping document repeats in some form. */
function goodsTable(lines: DocLine[], currency: string, withPrices = true): string {
  const head = withPrices
    ? '  #  Part number            HSN        Qty        Unit       Amount'
    : '  #  Part number            HSN        Qty';
  const rows = lines.map((l, i) => {
    const left = `  ${String(i + 1).padStart(1)}  ${l.mpn.padEnd(22)} ${l.hsnCode.padEnd(10)} ${String(l.qty).padStart(6)} ${l.uom}`;
    if (!withPrices) return left;
    return `${left}  ${money(l.unitPriceMinor, currency).padStart(12)} ${money(l.lineTotalMinor, currency).padStart(14)}`;
  });
  const detail = lines.map(
    (l, i) => `     (${i + 1}) ${l.manufacturer} — ${l.description}`,
  );
  return [head, ...rows.flatMap((r, i) => [r, detail[i]])].join('\n');
}

const totalQty = (lines: DocLine[]) => lines.reduce((a, l) => a + l.qty, 0);

/**
 * A document's total is the sum of its own lines. Always.
 *
 * It used to take the order-level buy value, which is carried in INR after
 * conversion while the invoice is priced in the supplier's currency — so a
 * commercial invoice showed one line at USD 4,628 and a total of USD 385,074.
 * A document whose total does not add up is worse than no document: it is the
 * first thing a customs officer checks and the first thing that makes a whole
 * demonstration untrustworthy.
 */
const linesTotal = (lines: DocLine[]) => lines.reduce((a, l) => a + l.lineTotalMinor, 0);

/** "1 carton", not "1 cartons". */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Carton breakdown.
 *
 * Synthesised, and deliberately so — the platform models quantities, not how a
 * supplier chose to box them. What matters is that the numbers reconcile: the
 * cartons add back to the line quantity, which is the check a receiving clerk
 * actually performs.
 */
function cartons(lines: DocLine[]): { rows: string[]; count: number; netKg: number; grossKg: number } {
  const rows: string[] = [];
  let n = 0;
  let net = 0;
  for (const l of lines) {
    const perCarton = l.qty > 2000 ? 1000 : l.qty > 500 ? 500 : l.qty;
    let left = l.qty;
    while (left > 0) {
      const inThis = Math.min(perCarton, left);
      n += 1;
      const kg = Number((inThis * 0.0025 + 0.4).toFixed(2));
      net += kg;
      rows.push(
        `  ${String(n).padStart(3)}  ${l.mpn.padEnd(22)} ${String(inThis).padStart(6)} ${l.uom}   ${kg.toFixed(2)} kg   400 × 300 × 200 mm`,
      );
      left -= inThis;
    }
  }
  return {
    rows,
    count: n,
    netKg: Number(net.toFixed(2)),
    grossKg: Number((net + n * 0.35).toFixed(2)),
  };
}

const dt = (iso: string) => iso.slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// The renderers
// ─────────────────────────────────────────────────────────────────────────────

type Renderer = (c: DocContext) => string;

const RENDERERS: Record<string, Renderer> = {
  // ── Commercial paper ─────────────────────────────────────────────────────
  customer_po: (c) =>
    [
      section(
        'PURCHASE ORDER',
        block('', [
          ['Purchase order no.', c.refs.customerPo],
          ['Date', dt(c.docDate)],
          ['Buyer', c.customer.name],
          ['Buyer address', c.customer.address.replace(/\n/g, ', ')],
          ['Buyer GSTIN', c.customer.gstin],
          ['Supplier', `${c.org.legalName} (1BUY)`],
          ['Delivery term', c.terms.sellIncoterms ?? '—'],
          ['Currency', c.sellCurrency],
        ]),
      ),
      section('GOODS ORDERED', goodsTable(c.lines, c.sellCurrency)),
      block('', [
        ['Total quantity', `${totalQty(c.lines)} pcs`],
        ['Order value', money(linesTotal(c.lines), c.sellCurrency)],
      ]),
      'Authorised by the buyer’s procurement desk. Acceptance of this order is subject to\nthe delivery term and payment terms stated above.',
    ]
      .filter(Boolean)
      .join('\n\n'),

  customer_pi: (c) =>
    [
      section(
        'SALES ORDER / PROFORMA INVOICE',
        block('', [
          ['Document no.', c.refs.customerPi ?? `PI/${c.alias}`],
          ['Date', dt(c.docDate)],
          ['Issued by', `${c.org.legalName} (1BUY)`],
          ['Our GSTIN', c.org.gstin],
          ['Raised against', `Customer purchase order ${c.refs.customerPo}`],
          ['Customer', c.customer.name],
          ['Customer GSTIN', c.customer.gstin],
          ['Delivery term', termLine(c.terms.sellIncoterms)],
          ['Payment terms', c.terms.paymentMethod],
          ['Validity', '14 days from the date of this document'],
        ]),
      ),
      section('GOODS OFFERED', goodsTable(c.lines, c.sellCurrency)),
      block('', [
        ['Total quantity', `${totalQty(c.lines)} pcs`],
        ['Value', money(linesTotal(c.lines), c.sellCurrency)],
        ['Taxes', 'GST as applicable, charged on the tax invoice'],
      ]),
      'This is a proforma and not a demand for payment. Acceptance of it fixes the price,\nthe delivery term and the specification against which the tax invoice will be raised.',
    ].join('\n\n'),

  supplier_po: (c) =>
    [
      section(
        'PURCHASE ORDER',
        block('', [
          ['Purchase order no.', c.refs.supplierPo],
          ['Date', dt(c.docDate)],
          ['Buyer', `${c.org.legalName} (1BUY)`],
          ['Buyer address', c.org.address.replace(/\n/g, ', ')],
          ['Buyer IEC', c.org.iec],
          ['Supplier', `${c.supplier.name}, ${c.supplier.country}`],
          ['Delivery term', termLine(c.terms.buyIncoterms)],
          ['Payment method', c.terms.paymentMethod],
          ['Currency', c.buyCurrency],
          ['Ship to', c.org.address.replace(/\n/g, ', ')],
        ]),
      ),
      section('GOODS ORDERED', goodsTable(c.lines, c.buyCurrency)),
      block('', [
        ['Total quantity', `${totalQty(c.lines)} pcs`],
        ['Order value', money(linesTotal(c.lines), c.buyCurrency)],
      ]),
      'Parts to be supplied with manufacturer traceability. Date codes and lot numbers to\nbe declared on the packing list. Any deviation from the specification is to be raised\nbefore despatch, not on the invoice.',
    ].join('\n\n'),

  supplier_pi: (c) =>
    [
      section(
        'PROFORMA INVOICE',
        block('', [
          ['Proforma no.', c.refs.supplierPi ?? `SPI/${c.alias}`],
          ['Date', dt(c.docDate)],
          ['Issued by', `${c.supplier.name}, ${c.supplier.country}`],
          ['Raised against', `Purchase order ${c.refs.supplierPo}`],
          ['Consignee', `${c.org.legalName} (1BUY), ${c.org.country}`],
          ['Delivery term', termLine(c.terms.buyIncoterms)],
          ['Currency', c.buyCurrency],
          ['Payment', c.terms.paymentMethod],
        ]),
      ),
      section('GOODS', goodsTable(c.lines, c.buyCurrency)),
      block('', [['Invoice value', money(linesTotal(c.lines), c.buyCurrency)]]),
      'Beneficiary bank details are stated on the supplier’s letterhead and are verified\nindependently against the approved vendor record before any payment is released.\nA change of bank details on an invoice is treated as an exception, never as an update.',
    ].join('\n\n'),

  sourcing_terms: (c) =>
    [
      section(
        'AGREED COMMERCIAL TERMS',
        block('', [
          ['Order', c.alias],
          ['Between', `${c.org.legalName} (1BUY) and ${c.supplier.name}`],
          ['Locked on', dt(c.docDate)],
          ['Delivery term', termLine(c.terms.buyIncoterms)],
          ['Currency', c.buyCurrency],
          ['Exchange rate fixed at', c.terms.fxRate.toFixed(4)],
          ['Payment method', c.terms.paymentMethod],
          ['Order value', money(linesTotal(c.lines), c.buyCurrency)],
        ]),
      ),
      'These terms are frozen at this point. Anything the supplier’s invoice states that\ndiffers from them — a changed delivery term, a different currency, an added charge —\nis a variance to be answered before payment, not a correction to be accepted.',
    ].join('\n\n'),

  acceptance: (c) =>
    [
      section(
        'CUSTOMER ACCEPTANCE',
        block('', [
          ['Accepted document', c.refs.customerPi ?? `Proforma for ${c.alias}`],
          ['Accepted by', c.customer.name],
          ['Contact', c.customer.contact],
          ['Date', dt(c.docDate)],
          ['Value accepted', money(c.sellValueMinor, c.sellCurrency)],
          ['Delivery term', c.terms.sellIncoterms ?? '—'],
        ]),
      ),
      'Written acceptance of the proforma at the price, specification and delivery term\nstated. This is the commitment 1BUY relies on in placing its own order.',
    ].join('\n\n'),

  // ── Money ────────────────────────────────────────────────────────────────
  escrow_agreement: (c) =>
    [
      section(
        'ESCROW ORDER AND SCHEDULE OF TERMS',
        block('', [
          ['Escrow order ref.', c.escrow?.ref ?? '—'],
          ['Provider', c.escrow?.provider ?? '—'],
          ['Date placed', dt(c.docDate)],
          ['Depositor', `${c.org.legalName} (1BUY)`],
          ['Beneficiary', `${c.supplier.name}, ${c.supplier.country}`],
          ['Underlying order', `${c.refs.supplierPo} / work order ${c.alias}`],
          ['Amount held', c.escrow ? money(c.escrow.agreedMinor, 'INR') : '—'],
          ['Currency', 'INR'],
        ]),
      ),
      section(
        'CONDITIONS OF RELEASE',
        `  ${c.escrow?.releaseCondition ?? 'Goods received and accepted at 1BUY.'}\n\n  Until those conditions are met the provider confirms the hold to the beneficiary\n  and does not disburse. The confirmation is what the supplier ships against; it is\n  not a payment and does not become one on despatch.`,
      ),
      'Fees are borne by the depositor. Any variation to these conditions is valid only in\nwriting signed by both parties and lodged with the provider against this reference.',
    ].join('\n\n'),

  funding_proof: (c) =>
    [
      section(
        'CONFIRMATION OF FUNDS HELD',
        block('', [
          ['Escrow order ref.', c.escrow?.ref ?? '—'],
          ['Provider', c.escrow?.provider ?? '—'],
          ['Value date', dt(c.docDate)],
          ['Amount received', c.escrow ? money(c.escrow.agreedMinor, 'INR') : '—'],
          ['From', `${c.org.legalName} (1BUY)`],
          ['Held for', `${c.supplier.name}`],
          ['Status', 'FUNDED — hold confirmed to the beneficiary'],
        ]),
      ),
      'This confirms funds are in the provider’s hands, not that a transfer was instructed.\nThe beneficiary may treat it as security to commence despatch under the order.',
    ].join('\n\n'),

  release_instruction: (c) =>
    [
      section(
        'RELEASE INSTRUCTION',
        block('', [
          ['To', c.escrow?.provider ?? 'Escrow provider'],
          ['Escrow order ref.', c.escrow?.ref ?? '—'],
          ['Instructed on', dt(c.docDate)],
          ['Release amount', c.escrow ? money(c.escrow.agreedMinor, 'INR') : '—'],
          ['Beneficiary', c.supplier.name],
          ['Against', `Work order ${c.alias} — goods received and accepted at 1BUY`],
          ['Authorised by', 'Two Finance approvers (segregation of duties)'],
        ]),
      ),
      'The conditions in the escrow schedule are satisfied: the consignment has been\nreceived, inspected and accepted. Release the held amount to the beneficiary and\nissue settlement confirmation against this reference.',
    ].join('\n\n'),

  final_remittance: (c) =>
    [
      section(
        'REMITTANCE ADVICE',
        block('', [
          ['Advice date', dt(c.docDate)],
          ['Payer', `${c.org.legalName} (1BUY)`],
          ['Beneficiary', `${c.supplier.name}, ${c.supplier.country}`],
          ['Against', `Purchase order ${c.refs.supplierPo}`],
          ['Amount', money(linesTotal(c.lines), c.buyCurrency)],
          ['Settlement route', c.terms.paymentMethod],
        ]),
      ),
      'Closing settlement for this order. The supplier’s account is cleared in full; any\nfurther claim against this order is a new matter and not an adjustment to this one.',
    ].join('\n\n'),

  orm: (c) =>
    [
      section(
        'OUTWARD REMITTANCE MESSAGE',
        block('', [
          ['ORM reference', `ORM/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Issued by', 'Authorised Dealer Category-I Bank'],
          ['Date of remittance', dt(c.docDate)],
          ['Remitter', `${c.org.legalName} (1BUY)`],
          ['Remitter IEC', c.org.iec],
          ['Beneficiary', `${c.supplier.name}, ${c.supplier.country}`],
          ['Amount remitted', money(linesTotal(c.lines), c.buyCurrency)],
          ['INR equivalent', money(Math.round(linesTotal(c.lines) * c.terms.fxRate), 'INR')],
          ['Exchange rate', c.terms.fxRate.toFixed(4)],
          ['Purpose code', 'S0101 — advance/payment against import of goods'],
          ['Against invoice', c.refs.supplierPi ?? c.refs.supplierPo],
        ]),
      ),
      section(
        'IDPMS STATUS',
        `  OUTSTANDING — awaiting Bill of Entry\n\n  This remittance is carried in IDPMS against the remitter's IEC and remains open\n  until the Bill of Entry evidencing the corresponding import is filed against it.\n  Closing that pair is the importer's obligation under FEMA. An outward remittance\n  left unmatched is the importer's exposure, not the bank's and not the beneficiary's.`,
      ),
    ].join('\n\n'),

  bank_advice: (c) =>
    [
      section(
        'BANK CREDIT ADVICE',
        block('', [
          ['Advice date', dt(c.docDate)],
          ['Account holder', `${c.org.legalName} (1BUY)`],
          ['Credit received from', c.customer.name],
          ['Amount', money(c.sellValueMinor, c.sellCurrency)],
          ['Against', c.invoice?.number ?? `Tax invoice for ${c.alias}`],
          ['Value date', dt(c.docDate)],
        ]),
      ),
      'Confirms the customer’s payment has landed. The receivable against this order is\nclosed on the strength of this advice, not on the strength of a remittance notice.',
    ].join('\n\n'),

  // ── Testing ──────────────────────────────────────────────────────────────
  scope_confirmation: (c) =>
    [
      section(
        'AGREED TEST SCOPE',
        block('', [
          ['Order', c.alias],
          ['Laboratory', 'Testing Laboratory, Bengaluru'],
          ['Agreed on', dt(c.docDate)],
          ['Sampling plan', 'Lot sample drawn per ANSI/ASQ Z1.4, general inspection level II'],
          ['Authentication standard', 'SAE AS6171 — counterfeit avoidance, test evaluation'],
          ['Electrical', 'Parametric verification against manufacturer datasheet limits'],
        ]),
      ),
      section('PARTS IN SCOPE', goodsTable(c.lines, c.buyCurrency, false)),
      'The verdict is only as good as this scope. Anything outside it is untested and must\nnot be represented to the customer as having passed.',
    ].join('\n\n'),

  lab_receipt: (c) =>
    [
      section(
        'LABORATORY RECEIPT',
        block('', [
          ['Received by', 'Testing Laboratory, Bengaluru'],
          ['Received on', dt(c.docDate)],
          ['Against order', c.alias],
          ['Condition on arrival', 'Sealed, moisture barrier intact'],
          ['Total received', `${totalQty(c.lines)} pcs`],
        ]),
      ),
      section('SAMPLES RECEIVED', goodsTable(c.lines, c.buyCurrency, false)),
      'Counted against the despatch note on arrival. Any discrepancy between what was sent\nand what was received is raised here, before testing begins.',
    ].join('\n\n'),

  test_report: (c) =>
    [
      section(
        'TEST REPORT',
        block('', [
          ['Report no.', `WHL/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Laboratory', 'Testing Laboratory, Bengaluru'],
          ['Issued on', dt(c.docDate)],
          ['Client', `${c.org.legalName} (1BUY)`],
          ['Against order', `${c.alias} / ${c.refs.supplierPo}`],
          ['Sampling plan', 'ANSI/ASQ Z1.4, general inspection level II'],
          ['Standard applied', 'SAE AS6171'],
        ]),
      ),
      section('ITEMS TESTED', goodsTable(c.lines, c.buyCurrency, false)),
      section(
        'TESTS PERFORMED AND RESULTS',
        [
          '  External visual inspection (AS6171/2)          PASS',
          '  Remarking and resurfacing check                PASS',
          '  X-ray inspection of die and bond wires         PASS',
          '  Decapsulation of sampled units, die marking    PASS',
          '  Electrical parametric verification             PASS',
          '  Solderability                                  PASS',
        ].join('\n'),
      ),
      section(
        'VERDICT',
        '  PASS — the sampled units conform to the manufacturer specification and show no\n  indication of remarking, resurfacing or substitution.\n\n  Signed by the authorised signatory of the laboratory. A pass is an opinion this\n  laboratory puts its name to, limited to the sample drawn and the scope agreed.',
      ),
    ].join('\n\n'),

  return_docs: (c) =>
    [
      section(
        'RETURN OF TESTED SAMPLES',
        block('', [
          ['Returned on', dt(c.docDate)],
          ['From', 'Testing Laboratory, Bengaluru'],
          ['To', `${c.supplier.name} / 1BUY warehouse`],
          ['Against order', c.alias],
          ['Quantity returned', `${totalQty(c.lines)} pcs`],
          ['Condition', 'Destructive tests consumed the decapsulated units; balance intact'],
        ]),
      ),
      'Quantities reconcile against the laboratory receipt. Units consumed by destructive\ntesting are listed as consumed, not as missing.',
    ].join('\n\n'),

  // ── Shipping and customs ─────────────────────────────────────────────────
  commercial_invoice: (c) =>
    [
      section(
        'COMMERCIAL INVOICE',
        block('', [
          ['Invoice no.', c.refs.supplierPi ?? `INV/${c.alias}`],
          ['Invoice date', dt(c.docDate)],
          ['Exporter', `${c.supplier.name}, ${c.supplier.country}`],
          ['Consignee', `${c.org.legalName} (1BUY)`],
          ['Consignee address', c.org.address.replace(/\n/g, ', ')],
          ['Consignee IEC', c.org.iec],
          ['Buyer order ref.', c.refs.supplierPo],
          ['Country of origin', c.supplier.country],
          ['Country of final destination', c.org.country],
          ['Terms of delivery', termLine(c.terms.buyIncoterms)],
          ['Terms of payment', c.terms.paymentMethod],
          ['Currency', c.buyCurrency],
        ]),
      ),
      section('DESCRIPTION OF GOODS', goodsTable(c.lines, c.buyCurrency)),
      block('', [
        ['Total packages', plural(cartons(c.lines).count, 'carton')],
        ['Total quantity', `${totalQty(c.lines)} pcs`],
        ['Invoice total', money(linesTotal(c.lines), c.buyCurrency)],
      ]),
      'We declare that this invoice shows the actual price of the goods described, that all\nparticulars are true and correct, and that the goods are of the origin stated.',
    ].join('\n\n'),

  packing_list: (c) => {
    const k = cartons(c.lines);
    return [
      section(
        'PACKING LIST',
        block('', [
          ['Against invoice', c.refs.supplierPi ?? `INV/${c.alias}`],
          ['Date', dt(c.docDate)],
          ['Exporter', `${c.supplier.name}, ${c.supplier.country}`],
          ['Consignee', `${c.org.legalName} (1BUY)`],
          ['Shipping marks', `1BUY / ${c.alias} / MADE IN ${c.supplier.country.toUpperCase()}`],
        ]),
      ),
      section(
        'CARTON BREAKDOWN',
        ['  No.  Part number                Qty       Net wt.    Dimensions', ...k.rows].join('\n'),
      ),
      block('', [
        ['Total cartons', plural(k.count, 'carton')],
        ['Total quantity', `${totalQty(c.lines)} pcs`],
        ['Total net weight', `${k.netKg.toFixed(2)} kg`],
        ['Total gross weight', `${k.grossKg.toFixed(2)} kg`],
        ['Packing', 'Moisture barrier bags with desiccant and humidity indicator cards'],
      ]),
      'Contents are packed to withstand normal handling in international transit. Customs\nassess against this list and the receiving dock counts against it.',
    ].join('\n\n');
  },

  coo: (c) =>
    [
      section(
        'CERTIFICATE OF ORIGIN',
        block('', [
          ['Certificate no.', `COO/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Issued on', dt(c.docDate)],
          ['Exporter', `${c.supplier.name}, ${c.supplier.country}`],
          ['Consignee', `${c.org.legalName} (1BUY), ${c.org.country}`],
          ['Country of origin', c.supplier.country],
          ['Transport', c.shipment ? `${c.shipment.carrier} — ${c.shipment.origin} to ${c.shipment.destination}` : 'Air freight'],
          ['Invoice ref.', c.refs.supplierPi ?? `INV/${c.alias}`],
        ]),
      ),
      section('GOODS COVERED', goodsTable(c.lines, c.buyCurrency, false)),
      'It is hereby certified, on the basis of control carried out, that the declaration by\nthe exporter is correct and the goods described originate in the country stated.\nThe applicable duty rate and any preferential treatment follow from this.',
    ].join('\n\n'),

  awb_label: (c) => {
    const k = cartons(c.lines);
    return [
      section(
        'AIR WAYBILL',
        block('', [
          ['Air waybill no.', c.shipment?.awb ?? `AWB/${c.alias}`],
          ['Issued on', dt(c.docDate)],
          ['Carrier', c.shipment?.carrier ?? 'DHL Express'],
          ['Shipper', `${c.supplier.name}, ${c.supplier.country}`],
          ['Consignee', `${c.org.legalName} (1BUY)`],
          ['Airport of departure', c.shipment?.origin ?? c.supplier.country],
          ['Airport of destination', c.shipment?.destination ?? 'Bengaluru, India'],
          ['Pieces', String(k.count)],
          ['Gross weight', `${k.grossKg.toFixed(2)} kg`],
          ['Chargeable weight', `${Math.max(k.grossKg, k.count * 1.2).toFixed(2)} kg`],
          ['Nature of goods', 'Electronic components — semiconductors'],
          ['Declared value for carriage', 'NVD'],
          ['Declared value for customs', money(linesTotal(c.lines), c.buyCurrency)],
          ['Freight', c.terms.buyIncoterms === 'EXW' || c.terms.buyIncoterms === 'FOB' ? 'COLLECT' : 'PREPAID'],
        ]),
      ),
      'Handling: keep dry, electrostatic sensitive devices. The Bill of Entry quotes this\nairway bill number, so a discrepancy here stops the customs entry.',
    ].join('\n\n');
  },

  boe: (c) =>
    [
      section(
        'BILL OF ENTRY FOR HOME CONSUMPTION',
        block('', [
          ['Bill of entry no.', c.customs?.beNumber ?? `BE/${c.alias}`],
          ['Date of filing', dt(c.docDate)],
          ['Port of import', c.customs?.port ?? 'INBLR4 — Bengaluru Air Cargo'],
          ['Importer', `${c.org.legalName} (1BUY)`],
          ['Importer IEC', c.org.iec],
          ['Importer GSTIN', c.org.gstin],
          ['Customs broker licence', c.customs?.chaLicence ?? 'CHA/BLR/1147'],
          ['Supplier', `${c.supplier.name}, ${c.supplier.country}`],
          ['Invoice no. and date', `${c.refs.supplierPi ?? '—'} · ${dt(c.docDate)}`],
          ['Airway bill', c.shipment?.awb ?? '—'],
          ['Country of origin', c.supplier.country],
          ['Terms of delivery', c.terms.buyIncoterms],
          ['Exchange rate applied', c.terms.fxRate.toFixed(4)],
        ]),
      ),
      section('ITEMS DECLARED', goodsTable(c.lines, c.buyCurrency)),
      section(
        'VALUATION AND DUTY',
        block('', [
          ['Invoice value', money(linesTotal(c.lines), c.buyCurrency)],
          ['Assessable value', money(Math.round(linesTotal(c.lines) * c.terms.fxRate * 1.0125), 'INR')],
          ['Basic customs duty', 'As per tariff against the HSN codes declared'],
          ['Social welfare surcharge', '10% of BCD'],
          ['IGST', 'On assessable value plus duties — recoverable as input tax credit'],
        ]),
      ),
      'Declared under section 46 of the Customs Act, 1962. The contents of this entry are a\nlegal statement made by the customs broker under their own licence on behalf of the\nimporter named above.',
    ].join('\n\n'),

  duty_challan: (c) =>
    [
      section(
        'DUTY PAYMENT CHALLAN',
        block('', [
          ['Challan no.', `CHLN/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Payment date', dt(c.docDate)],
          ['Against bill of entry', c.customs?.beNumber ?? '—'],
          ['Importer', `${c.org.legalName} (1BUY)`],
          ['IEC', c.org.iec],
          ['Paid through', 'ICEGATE e-payment — authorised dealer bank'],
        ]),
      ),
      section(
        'HEADS OF PAYMENT',
        '  Basic customs duty                             as assessed\n  Social welfare surcharge                       as assessed\n  IGST on imports                                as assessed — recoverable',
      ),
      'Proof that the assessed duty has been paid. The IGST component is claimable as input\ntax credit against this challan and the bill of entry together; the BCD and surcharge\nare a cost and land on the order.',
    ].join('\n\n'),

  out_of_charge: (c) =>
    [
      section(
        'OUT OF CHARGE ORDER',
        block('', [
          ['Against bill of entry', c.customs?.beNumber ?? '—'],
          ['Granted on', dt(c.docDate)],
          ['Port', c.customs?.port ?? 'INBLR4 — Bengaluru Air Cargo'],
          ['Importer', `${c.org.legalName} (1BUY)`],
          ['Examination', 'Completed; goods found as declared'],
        ]),
      ),
      'Customs release the consignment from their control. Nothing leaves the port without\nthis order, and it is what the carrier presents to hand the goods over.',
    ].join('\n\n'),

  handover: (c) =>
    [
      section(
        'DOCUMENT HANDOVER NOTE',
        block('', [
          ['Handed to', 'Customs House Agent'],
          ['Date', dt(c.docDate)],
          ['Against order', c.alias],
          ['Airway bill', c.shipment?.awb ?? '—'],
        ]),
      ),
      section(
        'ORIGINALS HANDED OVER',
        '  Commercial invoice                             1 original\n  Packing list                                   1 original\n  Certificate of origin                          1 original\n  Airway bill                                    1 copy',
      ),
      'Records which originals the agent holds. When an entry stalls for a missing paper,\nthis is the document that answers whether it was ever sent.',
    ].join('\n\n'),

  // ── Warehouse ────────────────────────────────────────────────────────────
  grn: (c) => {
    const k = cartons(c.lines);
    return [
      section(
        'GOODS RECEIPT NOTE',
        block('', [
          ['GRN no.', `GRN/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Received on', dt(c.docDate)],
          ['Received at', `${c.org.legalName} — warehouse, Bengaluru`],
          ['Against purchase order', c.refs.supplierPo],
          ['Supplier', c.supplier.name],
          ['Carrier', c.shipment?.carrier ?? 'DHL Express'],
          ['Airway bill', c.shipment?.awb ?? '—'],
          ['Cartons received', `${k.count} of ${k.count}`],
          ['Gross weight received', `${k.grossKg.toFixed(2)} kg`],
        ]),
      ),
      section('QUANTITIES RECEIVED', goodsTable(c.lines, c.buyCurrency, false)),
      section(
        'CONDITION',
        '  Outer cartons                                  Sound, seals intact\n  Moisture barrier bags                          Intact, indicator cards blue\n  Discrepancy against packing list               None\n  Damage                                         None',
      ),
      'Booked into stock against the order. Inspection works from this note, and the escrow\nrelease waits on what it records.',
    ].join('\n\n');
  },

  inspection_report: (c) =>
    [
      section(
        'INBOUND INSPECTION REPORT',
        block('', [
          ['Report no.', `INS/${c.alias}/${dt(c.docDate).replace(/-/g, '')}`],
          ['Inspected on', dt(c.docDate)],
          ['Against GRN', `GRN/${c.alias}`],
          ['Quantity presented', `${totalQty(c.lines)} pcs`],
          ['Sampling plan', 'ANSI/ASQ Z1.4, general inspection level II, AQL 0.65'],
        ]),
      ),
      section('LOT INSPECTED', goodsTable(c.lines, c.buyCurrency, false)),
      section(
        'CHECKS PERFORMED',
        '  Part number against the order                  PASS\n  Manufacturer marking and logo                  PASS\n  Date code within agreed window                 PASS\n  Lot traceability to the declared batch         PASS\n  Package condition and MSL handling             PASS\n  Quantity against packing list                  PASS',
      ),
      section(
        'VERDICT',
        '  ACCEPTED — the lot conforms and is released to stock.\n\n  This is the point 1BUY stops being able to reject these goods, which is why it is\n  signed rather than derived. The escrow release rests on it.',
      ),
    ].join('\n\n'),

  before_photos: (c) =>
    photoSheet(c, 'PHOTOGRAPHS — AS RECEIVED', 'Condition of the lot as it arrived, before anything was relabelled or repacked.'),
  after_photos: (c) =>
    photoSheet(c, 'PHOTOGRAPHS — AS PACKED', 'What the customer will open. The reference if the packing is later disputed.'),
  photos: (c) =>
    photoSheet(c, 'INSPECTION PHOTOGRAPHS', 'Condition evidence supporting the inspection verdict, and any claim made from it.'),

  // ── Outbound ─────────────────────────────────────────────────────────────
  tax_invoice: (c) =>
    [
      section(
        'TAX INVOICE',
        block('', [
          ['Invoice no.', c.invoice?.number ?? `INV/${c.alias}`],
          ['Invoice date', dt(c.docDate)],
          ['Supplier', `${c.org.legalName} (1BUY)`],
          ['Supplier GSTIN', c.org.gstin],
          ['Recipient', c.customer.name],
          ['Recipient GSTIN', c.customer.gstin],
          ['Place of supply', c.customer.address.split('\n').slice(-1)[0] ?? '—'],
          ['Against order', `${c.refs.customerPo} / ${c.alias}`],
          ['Terms of delivery', c.terms.sellIncoterms ?? '—'],
          ['IRN', c.invoice?.irn],
          ['E-way bill', c.invoice?.ewayBill],
        ]),
      ),
      section('GOODS SUPPLIED', goodsTable(c.lines, c.sellCurrency)),
      section(
        'TAX',
        block('', [
          ['Taxable value', money(linesTotal(c.lines), c.sellCurrency)],
          ['GST', 'Charged at the rate applicable to each HSN listed above'],
          ['Total payable', 'Taxable value plus GST as computed on the register'],
        ]),
      ),
      'Issued under rule 46 of the CGST Rules. This invoice must travel with the\nconsignment; goods of this value may not move without it and the e-way bill.',
    ].join('\n\n'),

  eway_bill: (c) => {
    const k = cartons(c.lines);
    return [
      section(
        'E-WAY BILL',
        block('', [
          ['E-way bill no.', c.invoice?.ewayBill ?? `EWB/${c.alias}`],
          ['Generated on', dt(c.docDate)],
          ['Against invoice', c.invoice?.number ?? `INV/${c.alias}`],
          ['Consignor', `${c.org.legalName} (1BUY) — ${c.org.gstin}`],
          ['Consignee', `${c.customer.name} — ${c.customer.gstin ?? 'unregistered'}`],
          ['From', 'Bengaluru, Karnataka'],
          ['To', c.customer.address.split('\n').slice(-1)[0] ?? '—'],
          ['Value of goods', money(c.sellValueMinor, c.sellCurrency)],
          ['Packages', plural(k.count, 'package')],
          ['Approximate distance', 'As computed from the PIN codes'],
        ]),
      ),
      'Valid for the period computed from the distance. A consignment stopped without a\nlive e-way bill is detained with the goods, not merely fined.',
    ].join('\n\n');
  },

  delivery_note: (c) => {
    const k = cartons(c.lines);
    return [
      section(
        'DELIVERY NOTE',
        block('', [
          ['Delivery note no.', `DN/${c.alias}`],
          ['Date', dt(c.docDate)],
          ['Deliver to', c.customer.name],
          ['Address', c.customer.address.replace(/\n/g, ', ')],
          ['Against invoice', c.invoice?.number ?? `INV/${c.alias}`],
          ['Packages', plural(k.count, 'package')],
          ['Gross weight', `${k.grossKg.toFixed(2)} kg`],
        ]),
      ),
      section('GOODS DELIVERED', goodsTable(c.lines, c.sellCurrency, false)),
      section(
        'RECEIVED BY',
        '  Name        ______________________________\n  Signature   ______________________________\n  Date        ______________________________\n  Remarks     ______________________________',
      ),
      'Travels with the goods and comes back signed. A disputed invoice is defended with\nthis note and the proof of delivery, not with the despatch record.',
    ].join('\n\n');
  },

  pod: (c) =>
    [
      section(
        'PROOF OF DELIVERY',
        block('', [
          ['POD reference', `POD/${c.alias}`],
          ['Airway bill', c.shipment?.awb ?? '—'],
          ['Carrier', c.shipment?.carrier ?? 'DHL Express'],
          ['Delivered on', dt(c.docDate)],
          ['Delivered to', c.customer.name],
          ['Signed by', c.customer.contact ?? 'Goods inward'],
          ['Condition on delivery', 'Received in full and in good condition'],
        ]),
      ),
      'Retrieved from the carrier’s system. Without it a disputed invoice cannot be\ndefended, which is why it is captured rather than assumed from a delivered status.',
    ].join('\n\n'),

  quotes: (c) =>
    [
      section(
        'SUPPLIER COMPARISON',
        block('', [
          ['Prepared on', dt(c.docDate)],
          ['Against order', c.alias],
          ['Selected supplier', c.supplier.name],
          ['Selected on', 'Availability, price and Approved Vendor List standing'],
        ]),
      ),
      section('PARTS QUOTED', goodsTable(c.lines, c.buyCurrency)),
      'The comparison behind the buy price. It is what justifies the margin on the order,\nand what a later question about the price is answered from.',
    ].join('\n\n'),

  remittance: (c) =>
    [
      section(
        'REMITTANCE ADVICE — ADVANCE',
        block('', [
          ['Advice date', dt(c.docDate)],
          ['Payer', `${c.org.legalName} (1BUY)`],
          ['Beneficiary', `${c.supplier.name}, ${c.supplier.country}`],
          ['Against', `Purchase order ${c.refs.supplierPo}`],
          ['Amount', money(linesTotal(c.lines), c.buyCurrency)],
          ['Exchange rate', c.terms.fxRate.toFixed(4)],
          ['Purpose', 'Advance against import of goods'],
        ]),
      ),
      'Sent ahead of despatch under the agreed payment method. The supplier releases the\norder into production against this advice; it does not discharge the obligation to\nreconcile the outward remittance against the Bill of Entry once the goods arrive.',
    ].join('\n\n'),

  credit_confirmation: (c) =>
    [
      section(
        'CONFIRMATION OF CREDIT TERMS',
        block('', [
          ['Confirmed by', `${c.supplier.name}, ${c.supplier.country}`],
          ['Date', dt(c.docDate)],
          ['Against', `Purchase order ${c.refs.supplierPo}`],
          ['Order value', money(linesTotal(c.lines), c.buyCurrency)],
          ['Credit granted', 'Net terms as stated on the purchase order'],
          ['Counted from', 'Date of despatch documents, not date of arrival'],
        ]),
      ),
      'The supplier’s written confirmation that the goods ship on credit. Without it the\norder has no funding route: nothing is held in escrow and nothing was paid in advance.',
    ].join('\n\n'),

  import_file: (c) =>
    [
      section(
        'IMPORT FILE — COVER',
        block('', [
          ['Order', c.alias],
          ['Compiled on', dt(c.docDate)],
          ['Supplier', `${c.supplier.name}, ${c.supplier.country}`],
          ['Delivery term', termLine(c.terms.buyIncoterms)],
          ['Airway bill', c.shipment?.awb ?? '—'],
          ['Bill of entry', c.customs?.beNumber ?? '—'],
          ['Port', c.customs?.port ?? '—'],
        ]),
      ),
      section(
        'DOCUMENTS IN THE FILE',
        '  Commercial invoice                             filed\n  Packing list                                   filed\n  Certificate of origin                          filed\n  Airway bill                                    filed\n  Bill of entry                                  filed\n  Duty challan                                   filed\n  Out of charge order                            filed',
      ),
      section(
        'COSTS INCURRED ON THE INBOUND LEG',
        block('', [
          ['Goods value', money(linesTotal(c.lines), c.buyCurrency)],
          ['Exchange rate applied', c.terms.fxRate.toFixed(4)],
          ['Freight and clearance', 'As per the term — see the delivery terms panel on the order'],
          ['Duty', 'Per the challan; IGST recoverable, BCD and surcharge a cost'],
        ]),
      ),
      'The cover that lets Finance land the cost of this consignment without opening seven\nseparate documents to find out how it moved and what it attracted.',
    ].join('\n\n'),

  ncr: (c) =>
    [
      section(
        'NON-CONFORMANCE REPORT',
        block('', [
          ['NCR no.', `NCR/${c.alias}`],
          ['Raised on', dt(c.docDate)],
          ['Against order', `${c.alias} / ${c.refs.supplierPo}`],
          ['Supplier', c.supplier.name],
          ['Quantity affected', `${totalQty(c.lines)} pcs`],
        ]),
      ),
      section('PARTS AFFECTED', goodsTable(c.lines, c.buyCurrency, false)),
      'States what failed and against which check, so the supplier can answer it and\nsourcing can decide the route: reject, concession, re-test or return.',
    ].join('\n\n'),
};

/** The delivery term, named rather than left as three letters. */
function termLine(code: string | null): string {
  const def = incotermFor(code);
  return def ? `${def.code} — ${def.name}` : (code ?? '—');
}

function photoSheet(c: DocContext, title: string, note: string): string {
  return [
    section(
      title,
      block('', [
        ['Taken on', dt(c.docDate)],
        ['Against order', c.alias],
        ['Frames', `${Math.max(4, c.lines.length * 2)} images`],
        ['Subjects', 'Outer cartons, inner packaging, reel labels, date codes, part marking'],
      ]),
    ),
    note,
  ].join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The letterhead every document carries, so a page is identifiable on its own.
 *
 * A document detached from its order — printed, forwarded, attached to a
 * dispute — has to say which order it belongs to without the screen around it.
 */
function letterhead(c: DocContext): string {
  return block('', [
    ['Work order', `${c.alias}  ·  ${c.canonicalName}`],
    ['Customer', c.customer.name],
    ['Supplier', `${c.supplier.name}, ${c.supplier.country}`],
  ]);
}

/**
 * Renders a document of `docType` against the order.
 *
 * Falls back to the letterhead and a plain statement where a type has no
 * renderer, which is honest: a stub that says what it is beats a stub dressed
 * up as something it is not.
 */
export function renderDocumentBody(docType: string, c: DocContext, label?: string): string {
  const key = normaliseDocType(docType);
  const render = RENDERERS[key];
  if (!render) {
    return [
      section((label ?? key.replace(/_/g, ' ')).toUpperCase(), letterhead(c)),
      `Filed against ${c.alias} on ${dt(c.docDate)}.`,
    ].join('\n\n');
  }
  return [letterhead(c), render(c)].join('\n\n');
}

/** The types this module renders in full — used by a test to catch a gap. */
export const RENDERED_DOC_TYPES = Object.keys(RENDERERS);

/** Exposed so the P&L view can reuse the currency formatting of a document. */
export const documentMoney = (minor: number, currency: string) =>
  `${money(minor, currency)} (${fromMinor(minor, currency).toLocaleString('en-IN')})`;
