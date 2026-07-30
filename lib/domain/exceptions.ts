/**
 * EXCEPTION ROUTES — master prompt §4.
 *
 * Each exception type declares the ways back to the main line, and each route
 * says what it actually DOES: which stage the order moves to, and whether it
 * ends the order instead. Choosing a route is therefore a real operation, not a
 * label — the same way the stage ladder drives everything else.
 *
 * Routes live next to the exception, not in the component, so the button list
 * and the behaviour behind it can never disagree.
 */

import type { ExceptionType } from './enums';

export interface ExceptionRoute {
  id: string;
  label: string;
  /** What the operator is actually choosing, in plain English. */
  consequence: string;
  /**
   * Stage the order moves to when this route is taken. Omitted when the route
   * ends the order rather than continuing it.
   */
  targetStage?: string;
  /** Terminal routes stop the order instead of advancing it. */
  terminal?: 'CANCELLED' | 'RESOURCE';
  /** Draws the eye to the destructive options. */
  tone?: 'neutral' | 'danger';
}

export interface ExceptionDef {
  type: ExceptionType;
  label: string;
  /** Which order tab owns the decision, so the buttons live where the evidence is. */
  ownerTab: 'testing' | 'customs' | 'inspection' | 'escrow' | 'logistics' | 'overview';
  /** True when the exception should be tied to the specific failed part. */
  mapsToLineItems: boolean;
  routes: ExceptionRoute[];
}

export const EXCEPTION_DEFS: Record<ExceptionType, ExceptionDef> = {
  TEST_FAIL: {
    type: 'TEST_FAIL',
    label: 'Test failed',
    ownerTab: 'testing',
    mapsToLineItems: true,
    routes: [
      {
        id: 'REJECT_REPLACE',
        label: 'Reject and replace the lot',
        consequence:
          'The failed lot is rejected outright. The supplier must send a different lot, which goes back through testing from the dispatch step.',
        targetStage: 'TEST_DISPATCH_BOOKED',
      },
      {
        id: 'SUPPLIER_RESUBMIT',
        label: 'Supplier re-submits a new lot',
        consequence:
          'The supplier picks fresh stock and books it to the laboratory again. Testing restarts at the dispatch step.',
        targetStage: 'TEST_DISPATCH_BOOKED',
      },
      {
        id: 'PARTIAL_ACCEPT',
        label: 'Accept only the passing sub-lots',
        consequence:
          'We take the quantity that passed and drop the rest. The parts return to the supplier and the shipment proceeds short.',
        targetStage: 'PARTS_RETURNED_TO_SUPPLIER',
      },
      {
        id: 'RETEST_EXPANDED',
        label: 'Retest with expanded scope',
        consequence:
          'The laboratory tests again with a larger sample or more parameters. The order returns to the scope-confirmation step.',
        targetStage: 'TEST_SCOPE_CONFIRMED',
      },
      {
        id: 'CANCEL_REFUND',
        label: 'Cancel and refund from escrow',
        consequence:
          'The order is cancelled and the money held in escrow is refunded. The customer order is left unsourced.',
        terminal: 'CANCELLED',
        tone: 'danger',
      },
      {
        id: 'ALTERNATE_VENDOR',
        label: 'Source from an alternate approved vendor',
        consequence:
          'This work order is closed off and the customer order goes back to sourcing, so a different approved supplier can be used.',
        terminal: 'RESOURCE',
        tone: 'danger',
      },
    ],
  },

  CUSTOMS_HOLD: {
    type: 'CUSTOMS_HOLD',
    label: 'Customs query or hold',
    ownerTab: 'customs',
    mapsToLineItems: true,
    routes: [
      {
        id: 'RESPOND_QUERY',
        label: 'Respond to the query through the customs agent',
        consequence: 'Our answer is filed and the entry goes back for assessment.',
        targetStage: 'CUSTOMS_ENTRY_FILED_ICEGATE',
      },
      {
        id: 'SUBMIT_DOCS',
        label: 'Submit additional documents',
        consequence: 'Supporting paperwork is lodged and the entry is re-examined.',
        targetStage: 'CUSTOMS_ENTRY_FILED_ICEGATE',
      },
      {
        id: 'REASSESS',
        label: 'Request re-assessment',
        consequence: 'The declared value or classification is re-examined by customs.',
        targetStage: 'DUTY_ASSESSED_AND_PAID',
      },
      {
        id: 'RECORD_DEMURRAGE',
        label: 'Accept the delay and record demurrage cost',
        consequence:
          'Storage and detention charges are added to the landed cost, and clearance continues.',
        targetStage: 'DUTY_ASSESSED_AND_PAID',
      },
    ],
  },

  SHORT_SHIPMENT: {
    type: 'SHORT_SHIPMENT',
    label: 'Short shipment or quantity variance',
    ownerTab: 'inspection',
    mapsToLineItems: true,
    routes: [
      {
        id: 'ACCEPT_SHORT',
        label: 'Accept the short quantity and amend the order',
        consequence: 'We proceed with what arrived and reduce the order value accordingly.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
      {
        id: 'CLAIM_SUPPLIER',
        label: 'Raise a claim on the supplier',
        consequence: 'The shortfall is charged back to the supplier before the balance is released.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
      {
        id: 'BALANCE_SHIPMENT',
        label: 'Ask for a balance shipment',
        consequence: 'The supplier ships the missing quantity separately.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
    ],
  },

  DAMAGED_INBOUND: {
    type: 'DAMAGED_INBOUND',
    label: 'Damaged or non-conforming goods',
    ownerTab: 'inspection',
    mapsToLineItems: true,
    routes: [
      {
        id: 'RAISE_NCR',
        label: 'Raise a non-conformance report',
        consequence: 'The problem is formally recorded as the basis for any claim.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
      {
        id: 'CLAIM_SUPPLIER',
        label: 'Claim on the supplier',
        consequence: 'The cost is charged back before the escrow balance is released.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
      {
        id: 'CLAIM_INSURANCE',
        label: 'Claim on the insurer',
        consequence: 'Transit insurance is claimed for the damaged portion.',
        targetStage: 'INBOUND_INSPECTION_IN_PROGRESS',
      },
      {
        id: 'PARTIAL_RELEASE_ONLY',
        label: 'Release only part of the escrow balance',
        consequence: 'The supplier is paid for the conforming goods only.',
        targetStage: 'INSPECTION_PASSED',
      },
    ],
  },

  ESCROW_DISPUTE: {
    type: 'ESCROW_DISPUTE',
    label: 'Escrow dispute',
    ownerTab: 'escrow',
    mapsToLineItems: false,
    routes: [
      {
        id: 'ASSEMBLE_EVIDENCE',
        label: 'Assemble the evidence pack',
        consequence: 'Inspection reports, test reports and photographs are bundled for the provider.',
      },
      {
        id: 'ARBITRATION',
        label: 'Refer to escrow arbitration',
        consequence: 'The provider decides the outcome under the escrow agreement.',
      },
      {
        id: 'PARTIAL_SETTLEMENT',
        label: 'Agree a partial settlement',
        consequence: 'Both sides accept a reduced release and the order continues.',
        targetStage: 'SUPPLIER_PAID_IN_FULL',
      },
    ],
  },

  SUPPLIER_DELAY: {
    type: 'SUPPLIER_DELAY',
    label: 'Supplier delay',
    ownerTab: 'overview',
    mapsToLineItems: false,
    routes: [
      {
        id: 'EXPEDITE',
        label: 'Expedite with the supplier',
        consequence: 'The supplier commits to a recovery date and we hold the order.',
      },
      {
        id: 'NOTIFY_CUSTOMER',
        label: 'Notify the customer with a revised date',
        consequence: 'The customer is told early rather than discovering it at the due date.',
      },
      {
        id: 'LIQUIDATED_DAMAGES',
        label: 'Apply liquidated damages',
        consequence: 'The agreed penalty is charged against the supplier balance.',
      },
      {
        id: 'RESOURCE',
        label: 'Re-source from another approved vendor',
        consequence: 'This work order is closed and the customer order returns to sourcing.',
        terminal: 'RESOURCE',
        tone: 'danger',
      },
    ],
  },

  CHANGE_ORDER: {
    type: 'CHANGE_ORDER',
    label: 'Customer change or cancellation',
    ownerTab: 'overview',
    mapsToLineItems: true,
    routes: [
      {
        id: 'AMEND',
        label: 'Issue an amendment',
        consequence: 'A new version of the order and quote is raised, and the job continues.',
      },
      {
        id: 'CANCEL_RECOVER',
        label: 'Cancel and recover our costs',
        consequence:
          'The order is cancelled and costs already incurred are recovered in agreed order.',
        terminal: 'CANCELLED',
        tone: 'danger',
      },
    ],
  },

  DELIVERY_FAILURE: {
    type: 'DELIVERY_FAILURE',
    label: 'Delivery failed or refused',
    ownerTab: 'logistics',
    mapsToLineItems: false,
    routes: [
      {
        id: 'REDELIVER',
        label: 'Arrange re-delivery',
        consequence: 'A second delivery attempt is booked with the courier.',
        targetStage: 'OUT_FOR_DELIVERY',
      },
      {
        id: 'RETURN_CREDIT',
        label: 'Accept the return and raise a credit note',
        consequence: 'Goods come back to us and the customer invoice is credited.',
        targetStage: 'CUSTOMER_INVOICED_AND_SETTLED',
        tone: 'danger',
      },
    ],
  },
};

export function exceptionDef(type: string): ExceptionDef | null {
  return EXCEPTION_DEFS[type as ExceptionType] ?? null;
}

export function exceptionRoute(type: string, routeId: string): ExceptionRoute | null {
  return exceptionDef(type)?.routes.find((r) => r.id === routeId) ?? null;
}
