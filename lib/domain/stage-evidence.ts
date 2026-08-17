/**
 * WHAT PROVES A STAGE WAS ACTUALLY DONE.
 *
 * A stage ladder that advances on a button click records intent, not fact. This
 * declares, per stage, the handful of things the team must have in front of them
 * before the order is allowed to move: the figures to record, and the paperwork
 * to attach.
 *
 * Declared as data for the same reason the ladder is: the form, the gate that
 * blocks advancement, and the record that an auditor reads are all generated
 * from this one list, so they cannot disagree about what "done" meant.
 *
 * Design rules followed throughout:
 *  * Never ask for something the platform already knows. Evidence asks for what
 *    only a human who was there can supply — a reference number from someone
 *    else's system, a physical count, a name on a signature.
 *  * `required: true` is reserved for things whose absence would make the next
 *    stage a guess. Everything else is recorded if known.
 *  * Every field carries `help` written for someone who does not do this daily.
 *  * Documents are `required` only where the paper IS the evidence — a signed
 *    report, a customs release, a proof of delivery.
 */

export type EvidenceFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'longtext';

export interface EvidenceField {
  id: string;
  label: string;
  type: EvidenceFieldType;
  required?: boolean;
  help: string;
  placeholder?: string;
  options?: string[];
  unit?: string;
  half?: boolean;
}

export interface EvidenceDoc {
  id: string;
  label: string;
  required?: boolean;
  help: string;
}

export interface StageEvidenceDef {
  stageId: string;
  /** One line on what the team is attesting to by completing this. */
  attestation: string;
  fields: EvidenceField[];
  documents: EvidenceDoc[];
}

/** Shorthand builders, purely to keep the table below readable. */
const t = (
  id: string,
  label: string,
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'text', help, half: true, ...o });
const n = (
  id: string,
  label: string,
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'number', help, half: true, ...o });
const d = (
  id: string,
  label: string,
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'date', help, half: true, ...o });
const sel = (
  id: string,
  label: string,
  options: string[],
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'select', options, help, half: true, ...o });
const yn = (
  id: string,
  label: string,
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'boolean', help, ...o });
const note = (
  id: string,
  label: string,
  help: string,
  o: Partial<EvidenceField> = {},
): EvidenceField => ({ id, label, type: 'longtext', help, ...o });
const doc = (id: string, label: string, help: string, required = false): EvidenceDoc => ({
  id,
  label,
  help,
  required,
});

export const STAGE_EVIDENCE: StageEvidenceDef[] = [
  // ── Phase A · Demand capture ───────────────────────────────────────────────
  {
    stageId: 'CUSTOMER_PO_RECEIVED',
    attestation: 'The customer’s order is in hand and its terms have been read.',
    fields: [
      t('receivedVia', 'How the order reached us', 'Email, their portal, or a hard copy. Matters if we later have to prove when we received it.', { type: 'select', options: ['Email', 'Customer portal', 'Hard copy', 'WhatsApp'] }),
      d('receivedOn', 'Date received', 'The date on our side, which is what the clock runs from.', { required: true }),
      yn('termsRead', 'Their terms and conditions have been read', 'Confirms someone actually looked for penalty clauses, delivery windows and inspection rights before we committed.'),
      note('discrepancies', 'Anything unclear or unusual', 'Part numbers that do not match the enquiry, dates we cannot meet, terms we would not accept. Write it now, while it is fresh.'),
    ],
    documents: [doc('customerPo', 'The customer’s purchase order', 'Their document as received. This is the instruction we are acting on.', true)],
  },
  {
    stageId: 'PI_ISSUED_TO_CUSTOMER',
    attestation: 'Our quote has gone to the customer.',
    fields: [
      d('sentOn', 'Date sent', 'When it left us.', { required: true }),
      t('sentTo', 'Sent to', 'The person at the customer who has it, so a chase goes to the right inbox.', { required: true }),
      d('validUntil', 'Quote valid until', 'After this date the prices are no longer ours to honour.'),
      yn('marginChecked', 'Margin checked against the floor', 'Confirms the quote was priced above the minimum margin, not just above cost.'),
    ],
    documents: [doc('customerPi', 'The proforma invoice sent', 'The version the customer received, so there is no argument later about what was quoted.', true)],
  },
  {
    stageId: 'PI_ACCEPTED_BY_CUSTOMER',
    attestation: 'The customer has accepted our quote in writing.',
    fields: [
      t('acceptanceRef', 'Their acceptance reference', 'Their email, order confirmation or signed copy reference. This is what makes the terms binding.', { required: true }),
      d('acceptedOn', 'Date accepted', 'The moment the terms became fixed.', { required: true }),
      t('acceptedBy', 'Who accepted', 'The named person, and ideally their authority to commit their company.', { required: true }),
    ],
    documents: [doc('acceptance', 'Written acceptance', 'The email or signed copy. Verbal acceptance is not evidence.', true)],
  },

  // ── Phase B · Sourcing and commitment ──────────────────────────────────────
  {
    stageId: 'SUPPLIER_SELECTED_FROM_AVL',
    attestation: 'The chosen supplier is approved and current, and the choice can be justified.',
    fields: [
      yn('avlCurrent', 'Approval is current on the Approved Vendor List', 'A supplier whose approval has lapsed cannot be used, whatever the price.', { required: true }),
      n('quotesCompared', 'How many quotes were compared', 'One quote is not a comparison. Record the number actually obtained.', { required: true }),
      note('selectionReason', 'Why this supplier', 'Price, stock position, date code, lead time, or the only one who had it. A cheaper option not taken should say why.', { required: true }),
    ],
    documents: [doc('quotes', 'The quotes compared', 'What the alternatives offered, so the choice is defensible.')],
  },
  {
    stageId: 'SUPPLIER_PO_ISSUED',
    attestation: 'Our order has been placed with the supplier.',
    fields: [
      d('issuedOn', 'Date issued', 'When the order went out.', { required: true }),
      t('sentTo', 'Sent to', 'The person at the supplier who has it.', { required: true }),
      yn('ackReceived', 'Supplier has acknowledged', 'An unacknowledged order is not yet a commitment on their side.'),
      t('ackRef', 'Their acknowledgement reference', 'Their order number, which is what they will quote back at us.'),
    ],
    documents: [doc('supplierPo', 'The purchase order sent', 'The voucher as issued.', true), doc('ack', 'Their acknowledgement', 'Confirms they accepted our terms, not just our order.')],
  },
  {
    stageId: 'TERMS_LOCKED',
    attestation: 'The commercial terms are fixed and will not be reopened without a change note.',
    fields: [
      d('lockedOn', 'Date locked', 'From here the exchange rate, prices and delivery terms are fixed.', { required: true }),
      n('fxRate', 'Exchange rate applied', 'The rate the margin is calculated at. Locking it is what stops the margin drifting with the market.', { required: true }),
      t('fxSource', 'Rate source', 'Which published rate, and as at when. Needed to defend the figure.', { required: true }),
      sel('escrowFundedBy', 'Who funds the escrow', ['Supplier', '1BUY', 'Both'], 'A negotiated term, not a platform rule. Take it from the signed terms.'),
      sel('escrowBasis', 'Escrow amount is based on', ['Buy value', 'Sell value', 'A custom figure'], 'What the held amount is calculated from.'),
      yn('escrowPartialRelease', 'Part-payment allowed before goods arrive', 'Normally NO. Escrow confirms to the supplier that the money is held, and nothing leaves until the goods are received at 1BUY — that hold is the leverage. Say yes only where the supplier negotiated an early tranche.'),
      note('escrowPartialReleaseTerms', 'The partial-release clause, if allowed', 'Required when the answer above is yes: what triggers the tranche, how much, and what happens to it if the goods are later rejected. Money leaving early without a written basis is the exposure itself.'),
    ],
    documents: [doc('signedTerms', 'The agreed terms', 'Whatever both sides signed or confirmed in writing.', true)],
  },
  {
    stageId: 'SUPPLIER_PI_RECEIVED',
    attestation:
      'The supplier’s proforma invoice is in hand and matches the terms we locked before they raised it.',
    fields: [
      t('supplierPiRef', 'Their proforma invoice number', 'The number they will reference on the shipment and their bank instruction.', { required: true }),
      d('receivedOn', 'Date received', 'When it arrived.', { required: true }),
      yn('threeWayChecked', 'Checked against our order and the locked terms', 'Part number, quantity, unit price, currency, delivery term. Terms were locked at B3, so anything here that disagrees with them is a variance to resolve — not a new term to accept by paying it.', { required: true }),
      note('variances', 'Any differences found', 'Anything that does not match our order or the locked terms — and what was agreed about it.'),
      yn('bankDetailsVerified', 'Bank details verified independently', 'Confirmed by a channel other than the email carrying them. This is the control against payment redirection fraud.', { required: true }),
    ],
    documents: [doc('supplierPi', 'Their proforma invoice', 'Including the bank details we will pay against.', true)],
  },
  {
    stageId: 'WORK_ORDER_ACTIVE',
    attestation: 'The job is open, owned, and everyone involved knows it is running.',
    fields: [
      t('owner', 'Who owns this order', 'One named person accountable for it end to end.', { required: true }),
      d('targetDelivery', 'Target delivery date to the customer', 'What we are working back from.', { required: true }),
      yn('customerNotified', 'Customer told the order is in progress', 'Silence after acceptance is the commonest cause of a chasing call.'),
    ],
    documents: [],
  },

  // ── Phase C · Financial arming ─────────────────────────────────────────────
  {
    stageId: 'ESCROW_ACCOUNT_OPENED',
    attestation:
      'An order is placed with the escrow provider on the agreed terms, and both sides know its reference.',
    fields: [
      t('escrowRef', 'Escrow order reference', 'The provider’s reference for this order. Everything afterwards is quoted against it.', { required: true }),
      t('provider', 'Escrow provider', 'Who is holding the money.', { required: true }),
      d('openedOn', 'Date the order was placed', 'When the escrow order came into existence.', { required: true }),
      /*
       * The release conditions, captured as a field rather than left inside an
       * attachment. They are what the whole arrangement turns on — a dispute
       * six weeks from now is argued about this sentence, and a term nobody can
       * quote without opening a PDF is a term nobody checks.
       */
      t('releaseConditions', 'Conditions that release the money', 'In the terms’ own words: what has to be true before the provider pays the supplier. Normally receipt and acceptance of the goods at 1BUY.', { required: true }),
      yn('supplierInformed', 'Supplier has the reference and the terms', 'They need both to confirm the arrangement before they ship.'),
    ],
    documents: [doc('escrowAgreement', 'Escrow order and terms schedule', 'The order placed with the provider and the schedule of terms agreed between 1BUY and the supplier, including what releases the funds.', true)],
  },
  {
    stageId: 'ESCROW_FUNDED',
    attestation: 'The money is genuinely with the escrow provider, not merely instructed.',
    fields: [
      n('amountFunded', 'Amount funded', 'The figure actually held. If it differs from the order value, say why below.', { required: true }),
      t('currency', 'Currency', 'The currency it is held in.', { required: true }),
      d('valueDate', 'Value date', 'The date the provider had the money, not the date we instructed the transfer.', { required: true }),
      t('paymentRef', 'Transfer reference', 'The bank reference, so the credit can be traced.', { required: true }),
      yn('providerConfirmed', 'Provider has confirmed receipt', 'An instruction is not a payment. This must be their confirmation.', { required: true }),
    ],
    documents: [doc('fundingProof', 'Proof of funding', 'The provider’s statement or confirmation showing the money held.', true)],
  },
  {
    stageId: 'ESCROW_PARTIAL_RELEASE_FOR_TESTING',
    attestation: 'A part release has been authorised to get the parts into testing.',
    fields: [
      n('amountReleased', 'Amount released', 'The part payment, and nothing beyond it.', { required: true }),
      t('authorisedBy', 'Authorised by', 'The Finance approver who signed it off.', { required: true }),
      note('purpose', 'What this release is for', 'Usually to move the parts to the laboratory. Being specific is what stops it being treated as payment for the goods.', { required: true }),
    ],
    documents: [doc('releaseInstruction', 'Release instruction', 'The signed instruction to the provider.', true)],
  },
  {
    stageId: 'ADVANCE_PAYMENT_TO_SUPPLIER',
    attestation: 'The advance has been paid and the supplier has confirmed it.',
    fields: [
      n('amountPaid', 'Amount paid', 'What actually left our account.', { required: true }),
      d('paidOn', 'Date paid', 'The value date on the transfer.', { required: true }),
      t('paymentRef', 'Transfer reference', 'The bank reference for tracing.', { required: true }),
      yn('supplierConfirmed', 'Supplier confirms receipt', 'Until they confirm, production has not started.', { required: true }),
    ],
    documents: [doc('remittance', 'Remittance advice', 'The transfer confirmation from our bank.', true),
      doc('orm', 'Outward Remittance Message (ORM)', 'The AD bank’s message evidencing the advance leaving India. It stays open in IDPMS until the Bill of Entry is filed against it.', true),
    ],
  },
  {
    stageId: 'CREDIT_TERMS_CONFIRMED',
    attestation: 'The supplier has agreed to ship on credit, and the due date is recorded.',
    fields: [
      n('creditDays', 'Credit days agreed', 'How long we have to pay after the agreed trigger.', { required: true, unit: 'days' }),
      sel('creditFrom', 'Counted from', ['Invoice date', 'Date of dispatch', 'Date of delivery', 'Date of inspection'], 'The trigger the days run from. This is where credit disputes usually start.', { required: true }),
      d('dueDate', 'Payment due date', 'The date the money must be with them.', { required: true }),
    ],
    documents: [doc('creditConfirmation', 'Their written confirmation of credit', 'Confirms the terms are theirs, not our assumption.', true)],
  },

  // ── Phase D · Quality assurance ────────────────────────────────────────────
  {
    stageId: 'TEST_DISPATCH_BOOKED',
    attestation: 'The parts are on their way to the laboratory.',
    fields: [
      t('lab', 'Laboratory', 'Who is testing.', { required: true }),
      t('awb', 'Consignment number', 'The tracking reference for the leg to the laboratory.', { required: true }),
      d('dispatchedOn', 'Date dispatched', 'When it left the supplier or our dock.', { required: true }),
      n('quantitySent', 'Quantity sent for testing', 'The sample or batch size actually sent.', { required: true }),
    ],
    documents: [doc('packingList', 'Packing list', 'What is physically in the box, so the laboratory can reconcile on arrival.', true)],
  },
  {
    stageId: 'PARTS_RECEIVED_AT_WHL',
    attestation: 'The laboratory has the parts and agrees what it received.',
    fields: [
      d('receivedOn', 'Date received by the laboratory', 'Their receipt date, which their turnaround runs from.', { required: true }),
      n('quantityReceived', 'Quantity they received', 'If this differs from what was sent, stop and resolve it before testing starts.', { required: true }),
      t('labReference', 'Their job reference', 'The laboratory’s own reference for the work.', { required: true }),
      yn('conditionOk', 'Received in good condition', 'Damage in transit will otherwise be blamed on the parts.'),
    ],
    documents: [doc('labReceipt', 'Laboratory receipt', 'Their acknowledgement of what arrived.', true)],
  },
  {
    stageId: 'TEST_SCOPE_CONFIRMED',
    attestation: 'Exactly what will be tested, and what counts as a pass, is agreed in writing.',
    fields: [
      note('parameters', 'Parameters to be tested', 'The specific checks. "Full testing" is not a scope.', { required: true }),
      sel('scope', 'Scope', ['Lot sample', 'Full batch'], 'Whether a sample or every piece is tested.', { required: true }),
      n('sampleSize', 'Sample size', 'How many pieces. Required if testing a sample.'),
      t('aql', 'Acceptance quality limit', 'The agreed defect threshold, e.g. AQL 1.0. This is what turns a result into a verdict.'),
      n('quotedDays', 'Quoted turnaround', 'Working days to a signed report.', { unit: 'days' }),
    ],
    documents: [doc('scopeConfirmation', 'Agreed scope', 'The laboratory’s written confirmation of what they will do.', true)],
  },
  {
    stageId: 'TESTING_IN_PROGRESS',
    attestation: 'Testing has started and we know when to expect the verdict.',
    fields: [
      d('startedOn', 'Date testing started', 'Their start date.', { required: true }),
      d('expectedBy', 'Report expected by', 'What we tell the customer, so it needs to be their commitment and not our hope.', { required: true }),
      note('interim', 'Any interim findings', 'Anything the laboratory has flagged before the formal report.'),
    ],
    documents: [],
  },
  {
    stageId: 'TEST_PASSED',
    attestation: 'The laboratory has signed off the parts as good, and we have the report.',
    fields: [
      t('reportNumber', 'Report number', 'The signed report’s own reference.', { required: true }),
      d('reportDate', 'Report date', 'The date on the report.', { required: true }),
      n('quantityTested', 'Quantity tested', 'How many pieces were actually examined.', { required: true }),
      n('quantityPassed', 'Quantity passed', 'If this is not the same as tested, the verdict is not a clean pass.', { required: true }),
      t('signedBy', 'Signed by', 'The named person at the laboratory taking responsibility for the verdict.', { required: true }),
    ],
    documents: [doc('testReport', 'Signed test report', 'The report itself. This is the single most important document in the file — it is what releases payment.', true)],
  },
  {
    stageId: 'TEST_FAILED',
    attestation: 'The parts failed, and the failure is documented well enough to act on.',
    fields: [
      t('reportNumber', 'Report number', 'The signed report’s reference.', { required: true }),
      n('quantityTested', 'Quantity tested', 'How many were examined.', { required: true }),
      n('quantityFailed', 'Quantity failed', 'How many failed.', { required: true }),
      note('failureMode', 'How they failed', 'The specific failure, per part number. Vague wording here weakens any claim against the supplier.', { required: true }),
      yn('supplierNotified', 'Supplier notified', 'They must be told promptly for a claim to hold.', { required: true }),
    ],
    documents: [doc('testReport', 'Signed test report', 'The evidence behind any claim or return.', true), doc('photos', 'Photographs', 'Visual evidence of the failure, where it can be seen.')],
  },
  {
    stageId: 'PARTS_RETURNED_TO_SUPPLIER',
    attestation: 'The failed parts have gone back and the supplier has accepted the return.',
    fields: [
      t('awb', 'Return consignment number', 'The tracking reference for the return leg.', { required: true }),
      d('returnedOn', 'Date returned', 'When they left.', { required: true }),
      n('quantityReturned', 'Quantity returned', 'How many went back.', { required: true }),
      sel('costBorneBy', 'Who bears the cost', ['Supplier', '1BUY', 'Shared'], 'Per the purchase order terms, test failure costs normally sit with the supplier.', { required: true }),
      yn('supplierAccepted', 'Supplier has accepted the return', 'Without their acceptance the parts may simply come back.'),
    ],
    documents: [doc('returnDocs', 'Return paperwork', 'The dispatch note and their acceptance.', true)],
  },

  // ── Phase E · Logistics ────────────────────────────────────────────────────
  {
    stageId: 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER',
    attestation: 'The full order has shipped, and the paperwork travelling with it is correct.',
    fields: [
      t('awb', 'Consignment number', 'Air waybill or bill of lading. Everything downstream is tracked by it.', { required: true }),
      t('carrier', 'Carrier', 'Who is moving it.', { required: true }),
      d('dispatchedOn', 'Date dispatched', 'When it left the supplier.', { required: true }),
      n('cartons', 'Number of cartons', 'Needed to reconcile on arrival and to spot a short shipment early.', { required: true }),
      n('grossWeight', 'Gross weight', 'As declared by the carrier.', { unit: 'kg' }),
      yn('docsComplete', 'Commercial invoice, packing list and origin certificate all present', 'A missing certificate of origin is the commonest cause of a customs hold. Check before it flies, not after.', { required: true }),
    ],
    documents: [
      doc('commercialInvoice', 'Commercial invoice', 'The value customs will assess duty on.', true),
      doc('packingList', 'Packing list', 'What is in each carton.', true),
      doc('coo', 'Certificate of origin', 'Where the goods were made. Determines the duty rate and any preferential treatment.'),
      doc('awbDoc', 'Air waybill or bill of lading', 'The carrier’s own document.', true),
    ],
  },
  {
    stageId: 'IN_TRANSIT_INTERNATIONAL',
    attestation: 'The shipment is moving and we know where it is.',
    fields: [
      t('lastLocation', 'Last known location', 'From the carrier’s tracking.', { required: true }),
      d('lastScanOn', 'Date of last update', 'How current our information is.', { required: true }),
      d('etaDestination', 'Estimated arrival', 'What the customer is being told.', { required: true }),
      note('exceptions', 'Any delays or exceptions', 'Weather, missed connection, carrier hold. Record it when you see it.'),
    ],
    documents: [],
  },
  {
    stageId: 'BORDER_ARRIVAL_WHA_ENGAGED',
    attestation: 'The goods have landed and the customs agent has what they need to file.',
    fields: [
      d('arrivedOn', 'Date of arrival', 'When it landed. Free storage time runs from here.', { required: true }),
      t('agent', 'Customs agent', 'Who is clearing it.', { required: true }),
      d('docsHandedOn', 'Date documents handed over', 'Late documents are the usual cause of demurrage.', { required: true }),
      yn('docSetComplete', 'Agent confirms the document set is complete', 'Their confirmation, not our assumption.', { required: true }),
    ],
    documents: [doc('handover', 'Document handover note', 'What was given to the agent and when.')],
  },
  {
    stageId: 'CUSTOMS_ENTRY_FILED_ICEGATE',
    attestation: 'The entry is filed with customs and we hold its reference.',
    fields: [
      t('beNumber', 'Bill of entry number', 'The customs reference for the import. Needed to claim the import tax back later.', { required: true }),
      d('filedOn', 'Date filed', 'The filing date.', { required: true }),
      n('assessableValue', 'Assessable value', 'The value customs is assessing duty on, in rupees.', { required: true }),
      t('exchangeRate', 'Customs exchange rate applied', 'Customs uses its own notified rate, which will differ from ours. Record theirs.', { required: true }),
    ],
    documents: [doc('billOfEntry', 'Bill of entry', 'The filed entry. Without it the import tax cannot be reclaimed.', true)],
  },
  {
    stageId: 'DUTY_ASSESSED_AND_PAID',
    attestation: 'Duty has been assessed and paid, and the recoverable part is identified.',
    fields: [
      n('bcd', 'Basic customs duty', 'A real cost. It stays in the landed cost.', { required: true }),
      n('sws', 'Social welfare surcharge', 'Also a real cost.', { required: true }),
      n('igst', 'Integrated tax on import', 'Recoverable as input credit, so it is deliberately EXCLUDED from landed cost. Recording it separately is what keeps the margin honest.', { required: true }),
      n('cess', 'Compensation cess', 'Usually zero.'),
      t('challanRef', 'Payment reference', 'The challan number, needed to trace the payment and support the credit claim.', { required: true }),
      d('paidOn', 'Date paid', 'The payment date.', { required: true }),
    ],
    documents: [doc('challan', 'Duty payment challan', 'Proof of payment, and the basis of the input credit claim.', true)],
  },
  {
    stageId: 'CUSTOMS_CLEARED',
    attestation: 'Customs has released the goods.',
    fields: [
      d('clearedOn', 'Date cleared', 'When the release was given.', { required: true }),
      t('outOfChargeRef', 'Release reference', 'The out-of-charge reference confirming the goods may move.', { required: true }),
      yn('examined', 'Goods were physically examined', 'If customs opened the shipment, note it — it explains any repacking and any delay.'),
      n('demurrage', 'Demurrage or storage charged', 'Any charge incurred waiting. Zero is the answer we want.'),
    ],
    documents: [doc('outOfCharge', 'Out-of-charge / release order', 'Customs’ authority for the goods to leave.', true)],
  },
  {
    stageId: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
    attestation: 'The goods are physically with us and counted.',
    fields: [
      d('receivedOn', 'Date received', 'When they arrived at our dock.', { required: true }),
      n('quantityExpected', 'Quantity expected', 'What the paperwork says.', { required: true }),
      n('quantityReceived', 'Quantity actually counted', 'The physical count. A difference here is a shortage claim, and it must be raised now.', { required: true }),
      t('receivedBy', 'Received by', 'Who counted it.', { required: true }),
      yn('packagingIntact', 'Packaging intact', 'Damage must be recorded on receipt or the carrier will not accept a claim.'),
      note('shortfallNote', 'Any shortage or damage', 'Exactly what is missing or damaged, and against which part number.'),
    ],
    documents: [doc('grn', 'Goods receipt note', 'Our own record of what came in.', true), doc('photos', 'Photographs on arrival', 'Especially of any damage, taken before unpacking.')],
  },

  // ── Phase F · Inspection and settlement ────────────────────────────────────
  {
    stageId: 'INBOUND_INSPECTION_IN_PROGRESS',
    attestation: 'Inspection has started against a defined checklist.',
    fields: [
      t('inspector', 'Inspector', 'Who is doing the inspection.', { required: true }),
      d('startedOn', 'Date started', 'When it began.', { required: true }),
      n('checkCount', 'Number of checks', 'How many items are on the checklist.', { required: true }),
      note('checklist', 'What is being checked', 'Marking, date code, quantity, packaging, documentation. Written down so the verdict is repeatable.', { required: true }),
    ],
    documents: [],
  },
  {
    stageId: 'INSPECTION_PASSED',
    attestation:
      'The goods are verified as correct. This is the gate that releases the final payment, so it carries the most weight of any stage.',
    fields: [
      t('reportNumber', 'Inspection report number', 'Our report’s reference.', { required: true }),
      d('passedOn', 'Date passed', 'When it was signed off.', { required: true }),
      n('quantityInspected', 'Quantity inspected', 'How many pieces were examined.', { required: true }),
      n('quantityAccepted', 'Quantity accepted', 'Anything not accepted must be explained below before payment is released.', { required: true }),
      t('signedBy', 'Signed by', 'The named inspector taking responsibility.', { required: true }),
      yn('dateCodeVerified', 'Date code and marking verified against the order', 'The specific check that catches relabelled or older stock.', { required: true }),
      note('observations', 'Observations', 'Anything noted but accepted, so it is on record if the customer raises it later.'),
    ],
    documents: [doc('inspectionReport', 'Signed inspection report', 'The document the final payment is released against. It must be signed.', true), doc('photos', 'Inspection photographs', 'Marking, packaging and date codes as found.')],
  },
  {
    stageId: 'ESCROW_FINAL_RELEASE_AUTHORISED',
    attestation:
      'Two Finance approvers have authorised the balance, with a passed inspection behind them.',
    fields: [
      n('amountReleased', 'Amount released', 'The balance being paid out.', { required: true }),
      t('firstApprover', 'First approver', 'The first Finance signature.', { required: true }),
      t('secondApprover', 'Second approver', 'A different Finance signature. One person can never release alone.', { required: true }),
      yn('inspectionVerified', 'Passed inspection confirmed before authorising', 'Releasing before verifying removes the only leverage we have if the goods are wrong.', { required: true }),
    ],
    documents: [doc('releaseInstruction', 'Signed release instruction', 'The instruction to the provider, carrying both signatures.', true)],
  },
  {
    stageId: 'SUPPLIER_PAID_IN_FULL',
    attestation: 'The supplier has been paid everything owed and confirms it.',
    fields: [
      n('totalPaid', 'Total paid across all payments', 'Advance plus balance. Should reconcile to the purchase order value.', { required: true }),
      d('finalPaymentOn', 'Date of final payment', 'The value date.', { required: true }),
      yn('supplierConfirmed', 'Supplier confirms full settlement', 'Their confirmation closes the buy side and prevents a later claim.', { required: true }),
      note('variance', 'Any difference from the order value', 'Discounts, deductions or claims settled. Explain any gap.'),
      /*
       * The ORM reference, captured as a field and not only as an attachment.
       *
       * Under IDPMS every outward remittance stays open at the AD bank until we
       * produce the Bill of Entry against it, and the reconciliation is quoted
       * by this number. Leaving it inside a PDF means the one identifier the
       * bank will ask for cannot be searched, which is how a remittance goes
       * unreconciled until the bank chases it.
       */
      t('ormRef', 'Outward Remittance Message reference', 'The AD bank’s ORM number for this payment. The Bill of Entry is reconciled against it in IDPMS.', { required: true }),
    ],
    documents: [
      doc('finalRemittance', 'Final remittance advice', 'Proof of the closing payment.', true),
      doc('orm', 'Outward Remittance Message (ORM)', 'The AD bank’s message evidencing the money leaving India. It stays open until the Bill of Entry is filed against it — closing that pair is 1BUY’s obligation.', true),
    ],
  },

  // ── Phase G · Value-add and delivery ───────────────────────────────────────
  {
    stageId: 'REBRAND_AND_REPACK_IN_PROGRESS',
    attestation: 'Repacking has started to the agreed specification.',
    fields: [
      d('startedOn', 'Date started', 'When repacking began.', { required: true }),
      note('spec', 'Repack specification', 'What is being changed — outer carton and paperwork only, unless the order says otherwise. Being explicit protects the original packing.', { required: true }),
      yn('innerPackUntouched', 'Inner packing left untouched', 'Opening sealed inner packing can void the manufacturer’s traceability.', { required: true }),
      t('operator', 'Carried out by', 'Who did the work.', { required: true }),
    ],
    documents: [doc('beforePhotos', 'Photographs before repacking', 'The original packing as received, in case traceability is later questioned.')],
  },
  {
    stageId: 'READY_FOR_OUTBOUND',
    attestation: 'The repacked goods have passed a final check and are ready to go.',
    fields: [
      d('completedOn', 'Date completed', 'When repacking finished.', { required: true }),
      n('cartons', 'Cartons ready', 'What will be handed to the carrier.', { required: true }),
      t('qcBy', 'Final check by', 'Who verified the repacked goods.', { required: true }),
      yn('labelsCorrect', 'Labels and markings verified', 'The last chance to catch a wrong label before it reaches the customer.', { required: true }),
    ],
    documents: [doc('packingList', 'Outbound packing list', 'What is in each carton going out.', true), doc('afterPhotos', 'Photographs after repacking', 'How it left us.')],
  },
  {
    stageId: 'OUTBOUND_BOOKED',
    attestation:
      'The consignment is booked and the tax invoice has been raised. The invoice must exist before the goods move.',
    fields: [
      t('awb', 'Consignment number', 'The outbound tracking reference.', { required: true }),
      t('carrier', 'Carrier', 'Who is delivering.', { required: true }),
      d('bookedOn', 'Date booked', 'When the collection was arranged.', { required: true }),
      t('salesOrderRef', 'Sales Order reference', 'Our SO against the customer’s purchase order. It is what ties this despatch, the invoice and the proof of delivery back to what they actually ordered — the work order number means nothing to them.', { required: true }),
      t('invoiceNumber', 'Tax invoice number', 'The invoice raised for this dispatch. The law requires it to be issued before or at removal of the goods.', { required: true }),
      t('ewayBillNumber', 'Way bill number', 'Required above the threshold. If the portal was unreachable, leave blank and record it here as soon as you have it — but the goods should not move without one.'),
      yn('invoiceBeforeDispatch', 'Invoice raised before the goods left', 'This is a legal requirement, not a preference.', { required: true }),
    ],
    documents: [doc('taxInvoice', 'Tax invoice', 'The invoice as issued to the customer.', true), doc('ewayBill', 'Way bill', 'Required to accompany the goods above the threshold.')],
  },
  {
    stageId: 'OUT_FOR_DELIVERY',
    attestation: 'The consignment is with the delivery courier.',
    fields: [
      d('outForDeliveryOn', 'Date out for delivery', 'From the carrier’s tracking.', { required: true }),
      d('expectedDelivery', 'Expected delivery date', 'What the customer has been told.', { required: true }),
      yn('customerInformed', 'Customer told it is coming', 'A delivery nobody is expecting is a delivery that gets refused.'),
    ],
    documents: [],
  },
  {
    stageId: 'DELIVERED',
    attestation: 'The customer has physically taken delivery.',
    fields: [
      d('deliveredOn', 'Date delivered', 'The carrier’s delivery date.', { required: true }),
      t('receivedBy', 'Received by', 'The named person who signed for it.', { required: true }),
      n('cartonsDelivered', 'Cartons delivered', 'Should match what was dispatched.', { required: true }),
      yn('conditionAccepted', 'Accepted without damage noted', 'If damage was noted on delivery, record it below — it will be the basis of any claim.'),
      note('deliveryNotes', 'Anything noted on delivery', 'Shortages, damage, or a refusal to sign.'),
    ],
    documents: [],
  },
  {
    stageId: 'POD_ISSUED_TO_CUSTOMER',
    attestation: 'We hold documented proof of delivery.',
    fields: [
      t('podRef', 'Proof of delivery reference', 'The carrier’s proof of delivery reference.', { required: true }),
      d('podDate', 'Date of proof', 'The date on the proof.', { required: true }),
      t('signatory', 'Signed by', 'Who signed at the customer.', { required: true }),
      yn('sentToCustomer', 'Copy sent to the customer', 'Sending it with the invoice removes the commonest reason for a delayed payment.'),
    ],
    documents: [doc('pod', 'Proof of delivery', 'The signed proof. This is what supports the collection.', true)],
  },
  {
    stageId: 'CUSTOMER_INVOICED_AND_SETTLED',
    attestation: 'The customer’s payment has been received and reconciled against the invoice.',
    fields: [
      n('amountReceived', 'Amount received', 'What actually reached our account.', { required: true }),
      d('receivedOn', 'Date received', 'The value date of the credit.', { required: true }),
      t('paymentRef', 'Payment reference', 'The customer’s reference, so the receipt can be matched.', { required: true }),
      yn('reconciled', 'Reconciled against the invoice', 'Confirms the amount matches. A short payment is a dispute, not a settlement.', { required: true }),
      note('shortPayment', 'Any deduction or short payment', 'What was withheld and the reason given.'),
    ],
    documents: [doc('bankAdvice', 'Bank credit advice', 'Proof the money arrived.', true)],
  },
  {
    stageId: 'ORDER_CLOSED',
    attestation:
      'Financially, physically and documentarily complete. Nothing is left open on this order.',
    fields: [
      yn('allDocsFiled', 'All documents filed', 'Everything the order produced is on file and findable.', { required: true }),
      yn('supplierSettled', 'Supplier fully settled', 'Nothing owed on the buy side.', { required: true }),
      yn('customerSettled', 'Customer fully settled', 'Nothing owed on the sell side.', { required: true }),
      yn('creditsClaimed', 'Input tax credits claimed', 'The recoverable import and input tax has been taken. Forgetting this quietly destroys the margin.', { required: true }),
      n('realisedMargin', 'Realised margin', 'The final figure, after every actual cost. This is the number the business is judged on.', { required: true }),
      note('lessons', 'Anything to do differently', 'What went wrong, what took too long, what to change next time.'),
    ],
    documents: [],
  },
];

const BY_STAGE = new Map(STAGE_EVIDENCE.map((e) => [e.stageId, e]));

export function evidenceFor(stageId: string): StageEvidenceDef | undefined {
  return BY_STAGE.get(stageId);
}

export interface EvidenceCompleteness {
  /** No evidence is declared for this stage, so nothing is required. */
  notApplicable: boolean;
  requiredFields: string[];
  missingFields: EvidenceField[];
  requiredDocs: EvidenceDoc[];
  missingDocs: EvidenceDoc[];
  complete: boolean;
}

/**
 * Whether a stage's evidence is complete enough to move on. A boolean field
 * counts as answered only when it is TRUE: these are attestations, and "no" is
 * not a completed attestation — it is a reason to stop.
 */
export function assessEvidence(
  stageId: string,
  values: Record<string, unknown>,
  attachedDocIds: string[],
): EvidenceCompleteness {
  const def = BY_STAGE.get(stageId);
  if (!def) {
    return {
      notApplicable: true,
      requiredFields: [],
      missingFields: [],
      requiredDocs: [],
      missingDocs: [],
      complete: true,
    };
  }

  const requiredFields = def.fields.filter((f) => f.required);
  const missingFields = requiredFields.filter((f) => {
    const v = values[f.id];
    if (f.type === 'boolean') return v !== true;
    return v === undefined || v === null || String(v).trim() === '';
  });

  const requiredDocs = def.documents.filter((d) => d.required);
  const attached = new Set(attachedDocIds);
  const missingDocs = requiredDocs.filter((d) => !attached.has(d.id));

  return {
    notApplicable: false,
    requiredFields: requiredFields.map((f) => f.id),
    missingFields,
    requiredDocs,
    missingDocs,
    complete: missingFields.length === 0 && missingDocs.length === 0,
  };
}
