'use server';

/**
 * THE STAGE-ADVANCE LAYER.
 *
 * One action advances any order to any legal next stage, driven entirely by the
 * stage config in lib/domain/stages. For each stage it also creates the
 * artifacts that stage is defined to produce — through the integration adapters
 * where one applies, and by hand where the connector is in Manual mode.
 *
 * This is what makes the lifecycle drivable rather than merely displayable, and
 * it is why the same code path proves both the automated and the fully-manual
 * journeys (AC#7 and AC#19).
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { escrowFunderMeta } from '@/lib/domain/enums';
import { assessEvidence } from '@/lib/domain/stage-evidence';
import { OVERRIDE_REASON_MIN, isUsableOverrideReason } from '@/lib/domain/advance-gate';
import { STAGE_CONTEXT_INCLUDE, stageContextFrom } from '@/lib/domain/stage-context';
import {
  STAGE_BY_ID,
  canTransition,
  getStage,
  nextStageFor,
} from '@/lib/domain/stages';
import { computeGstInvoice, makeRateLookup, type HsnRateRow } from '@/lib/tax/gst-engine';
import { amountInWords, pctOf, toMinor } from '@/lib/domain/money';
import type { Provenance, TestScope } from '@/lib/domain/enums';
import {
  dhlCreateShipment,
  dhlGetProofOfDelivery,
  dhlTrack,
  escrowInstructRelease,
  escrowOpenAccount,
  gspGenerateEWayBill,
  gspGenerateIrn,
  type SupplyCategory,
  icegateFileBillOfEntry,
  icegateGetDutyAssessment,
  whlGetTestResult,
  whlSubmitTestRequest,
} from '@/lib/integrations/adapters';
import type { AdapterOutcome } from '@/lib/integrations/core';
import { exceptionDef, exceptionRoute } from '@/lib/domain/exceptions';

export interface AdvanceResult {
  ok: boolean
  message: string;
  detail?: string;
  /** Which stage the order is now at. */
  stage?: string;
  /** How the artifacts for this step arrived. */
  provenance?: Provenance;
  blockedBy?: string;
  /**
   * The order moved on since the page was rendered, so the refusal is about a
   * transition the operator never actually asked for. The client refreshes on
   * this rather than showing a transition error that names two stages neither of
   * which the operator was looking at.
   */
  staleView?: boolean;
}

/** Narrow an adapter outcome to data, noting how it arrived. */
function unwrap<T>(outcome: AdapterOutcome<T>): { data: T | null; provenance: Provenance; note: string } {
  if (outcome.ok) {
    return { data: outcome.data, provenance: outcome.provenance, note: `Fetched via ${outcome.mode.toLowerCase()}.` };
  }
  if (outcome.manual) {
    return { data: null, provenance: 'MANUAL', note: outcome.reason };
  }
  return { data: null, provenance: 'MANUAL', note: outcome.error };
}

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

/**
 * Cache revalidation is only available inside a request. Wrapping it means this
 * action can also be driven from a script or a test — which is how the full
 * lifecycle walk is exercised — without the action itself pretending the cache
 * was refreshed when it was not.
 */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside a request context there is no cache to revalidate.
  }
}


async function nextNumber(docType: string, fallback: string): Promise<string> {
  const s = await db.numberingSeries.findUnique({ where: { docType } });
  if (!s) return `${fallback}-0001`;
  await db.numberingSeries.update({ where: { docType }, data: { nextNumber: s.nextNumber + 1 } });
  return `${s.prefix}-${pad(s.nextNumber, s.padding)}`;
}

/**
 * How much escrow holds, per the terms negotiated on THIS order.
 *
 * Deliberately not a constant: who funds escrow and against which value is
 * agreed between 1BUY and the supplier order by order, so the platform reads it
 * from the order rather than assuming. Defaults to the buy value, which is the
 * common case where we fund the supplier leg ourselves.
 */
function escrowAmountFor(wo: {
  escrowBasis: string | null;
  escrowAgreedAmount: number | null;
  sellValue: number;
  buyValue: number;
}): number {
  switch (wo.escrowBasis) {
    case 'SELL_VALUE':
      return wo.sellValue;
    case 'CUSTOM':
      return wo.escrowAgreedAmount ?? wo.buyValue;
    case 'BUY_VALUE':
    default:
      return wo.buyValue;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

export async function advanceStage(
  workOrderId: string,
  targetStageId: string,
  options?: {
    approverIds?: string[];
    note?: string;
    /**
     * Proceeds despite incomplete evidence for the stage being left. Requires a
     * written reason, which is logged — the gate is real, but an operator with a
     * legitimate reason must not be trapped by it.
     */
    evidenceOverrideReason?: string;
    /**
     * The stage the CLIENT believed the order was on when it rendered the button.
     *
     * Several people work one order, and a page can sit open for a long time. If
     * the order has moved since, the target computed from that stale view is
     * meaningless, and refusing it as an illegal transition tells the operator
     * nothing — the message names two stages they were never looking at.
     */
    expectedFromStage?: string;
  },
): Promise<AdvanceResult> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      customerPo: { include: { customer: true, lines: true } },
      supplierPo: { include: { supplier: true, lines: true } },
      escrowAccount: { include: { transactions: true } },
      testRequests: { include: { result: true } },
      shipments: true,
      customsEntry: true,
      inspections: true,
      repackJobs: true,
      grns: true,
      stageEvidence: { include: { documents: { select: { docType: true } } } },
      ...STAGE_CONTEXT_INCLUDE,
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const ctx = stageContextFrom(wo);

  // Checked before the transition rules, because a stale view is a different
  // problem with a different remedy: the operator has not made a mistake, their
  // page is simply out of date and needs to catch up.
  if (options?.expectedFromStage && options.expectedFromStage !== wo.stage) {
    const actual = getStage(wo.stage);
    const believed = STAGE_BY_ID[options.expectedFromStage];
    return {
      ok: false,
      staleView: true,
      message: 'This order has moved on since you opened it.',
      detail: `Your page was showing ${believed ? `${believed.code} ${believed.label}` : options.expectedFromStage}, but the order is now at ${actual.code} ${actual.label}. Nothing was changed — reloading so you can see where it actually is.`,
    };
  }

  const check = canTransition(wo.stage, targetStageId, ctx);
  if (!check.ok) {
    // Say what CAN happen from here. "X cannot advance directly to Y" on its own
    // leaves the operator to work out what the right move was.
    const should = nextStageFor(wo.stage, ctx);
    return {
      ok: false,
      message: check.reason,
      detail: should
        ? `From ${getStage(wo.stage).code} ${getStage(wo.stage).label}, the next step on this order's flow is ${should.code} ${should.label}.`
        : undefined,
    };
  }

  // ── The evidence gate ────────────────────────────────────────────────────
  // A stage is not finished because someone clicked a button; it is finished
  // when there is something on file showing it happened. This checks the stage
  // being LEFT, not the one being entered.
  const leavingEvidence = wo.stageEvidence.find((e) => e.stageId === wo.stage);
  const leaving = assessEvidence(
    wo.stage,
    leavingEvidence ? (JSON.parse(leavingEvidence.values) as Record<string, unknown>) : {},
    (leavingEvidence?.documents ?? []).map((d) => d.docType),
  );
  // Judged against the same minimum the form enforces, so the two cannot drift.
  // Previously the server took any non-empty string, which meant a waiver of "x"
  // was accepted by the one layer that is not the operator's own browser.
  const waived = isUsableOverrideReason(options?.evidenceOverrideReason);
  if (!leaving.complete && !waived) {
    const missing = [
      ...leaving.missingFields.map((f) => f.label),
      ...leaving.missingDocs.map((d) => `${d.label} (document)`),
    ];
    const tooShort = Boolean(options?.evidenceOverrideReason?.trim());
    return {
      ok: false,
      message: tooShort
        ? 'That reason is too short to record.'
        : `Record the evidence for "${getStage(wo.stage)?.label ?? wo.stage}" first.`,
      detail: tooShort
        ? `Advancing without evidence is allowed, but the reason has to say something — at least ${OVERRIDE_REASON_MIN} characters. Still missing: ${missing.join(', ')}.`
        : `Still needed: ${missing.join(', ')}. Fill it in under Stage evidence — or, if there is a good reason to proceed without it, say so there and it will be recorded against the order.`,
    };
  }

  const overridden = !leaving.complete && waived;

  const target = getStage(targetStageId);
  let provenance: Provenance = 'MANUAL';
  let detail = '';

  // ── Per-stage artifact creation ──────────────────────────────────────────
  switch (targetStageId) {
    case 'TERMS_LOCKED': {
      await db.workOrder.update({ where: { id: wo.id }, data: { termsLockedAt: new Date() } });
      detail = 'Payment method, testing terms, Incoterms, currency and exchange rate are now frozen.';
      break;
    }

    case 'ESCROW_ACCOUNT_OPENED': {
      if (wo.escrowAccount) {
        detail = 'Escrow account already exists.';
        break;
      }
      const escrowAmount = escrowAmountFor(wo);
      const out = await escrowOpenAccount({
        workOrderId: wo.id,
        currency: 'INR',
        amountMinor: escrowAmount,
        parties: [
          { role: 'BUYER', name: '1BUY' },
          { role: 'SELLER', name: wo.supplierPo.supplier.name },
        ],
        milestones: ['TEST_ENABLEMENT', 'FINAL_SETTLEMENT'],
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const seed = wo.alias.replace(/\D/g, '');
      await db.escrowAccount.create({
        data: {
          workOrderId: wo.id,
          escrowRef: data?.escrowRef ?? `ESC-2026-${pad(Number(seed) % 99999, 5)}`,
          provider: 'TBD — provider not yet finalised',
          currency: 'INR',
          virtualAccount: data?.virtualAccount ?? null,
          agreedAmount: escrowAmount,
          status: 'OPENED',
          provenance,
          provenanceActor: data ? 'Escrow simulator' : 'Ankit Sharma',
          provenanceAt: new Date(),
          provenanceRef: data?.escrowRef ?? null,
        },
      });
      detail = `${
        data ? `Escrow ${data.escrowRef} opened` : 'Escrow reference generated locally'
      } for ₹${(escrowAmount / 100).toLocaleString('en-IN')}, funded by ${
        escrowFunderMeta(wo.escrowFundedBy).partyLabel
      } on a ${(wo.escrowBasis ?? 'BUY_VALUE') === 'SELL_VALUE' ? 'sell-value' : (wo.escrowBasis ?? 'BUY_VALUE') === 'CUSTOM' ? 'negotiated' : 'buy-value'} basis per the agreed terms. ${note}`;
      break;
    }

    case 'ESCROW_FUNDED': {
      if (!wo.escrowAccount) return { ok: false, message: 'Open the escrow account first.' };
      const funded = wo.escrowAccount.agreedAmount;
      const funder = wo.escrowFundedBy ?? 'ONE_BUY';
      const fee = pctOf(funded, 0.4);
      await db.escrowTransaction.create({
        data: {
          escrowId: wo.escrowAccount.id,
          type: 'FUND',
          amount: funded,
          currency: 'INR',
          reference: `FUND/${wo.alias}`,
          status: 'SETTLED',
          valueDate: new Date(),
          reason:
            funder === 'SUPPLIER'
              ? 'The supplier deposited the agreed amount into escrow.'
              : funder === 'BOTH'
                ? 'The supplier and 1BUY jointly funded the agreed amount.'
                : '1BUY deposited the agreed amount into escrow.',
          provenance: 'MANUAL',
          provenanceActor: 'Ankit Sharma',
          provenanceAt: new Date(),
        },
      });
      await db.escrowTransaction.create({
        data: {
          escrowId: wo.escrowAccount.id,
          type: 'FEE',
          amount: fee,
          currency: 'INR',
          reference: `FEE/${wo.alias}`,
          status: 'SETTLED',
          valueDate: new Date(),
          reason: 'Escrow provider fee.',
        },
      });
      await db.escrowAccount.update({
        where: { id: wo.escrowAccount.id },
        data: { fundedAmount: funded, feeAmount: fee, status: 'FUNDED' },
      });
      await db.workOrder.update({ where: { id: wo.id }, data: { escrowFee: fee } });
      detail = `₹${(funded / 100).toLocaleString('en-IN')} is now held by the escrow provider, funded by ${
        funder === 'CUSTOMER' ? 'the customer' : funder === 'BOTH' ? 'both parties' : 'us'
      }.`;
      break;
    }

    case 'ESCROW_PARTIAL_RELEASE_FOR_TESTING': {
      if (!wo.escrowAccount) return { ok: false, message: 'Open and fund the escrow account first.' };
      if (wo.escrowAccount.fundedAmount <= 0)
        return { ok: false, message: 'Escrow must be funded before anything can be released.' };
      const tranche = Math.round(wo.buyValue * 0.15);
      const out = await escrowInstructRelease({
        workOrderId: wo.id,
        escrowRef: wo.escrowAccount.escrowRef,
        amountMinor: tranche,
        beneficiary: wo.supplierPo.supplier.name,
        milestone: 'TEST_ENABLEMENT',
        authorisedBy: ['Ankit Sharma'],
        reason: 'Test-enablement tranche so the supplier can ship parts to the lab.',
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      await db.escrowTransaction.create({
        data: {
          escrowId: wo.escrowAccount.id,
          type: 'PARTIAL_RELEASE',
          milestone: 'TEST_ENABLEMENT',
          amount: tranche,
          currency: 'INR',
          beneficiary: wo.supplierPo.supplier.name,
          reference: data?.instructionRef ?? `REL/TEST/${wo.alias}`,
          status: 'SETTLED',
          valueDate: new Date(),
          reason: 'Test-enablement tranche so the supplier can ship parts to the lab.',
          provenance,
          provenanceActor: data ? 'Escrow simulator' : 'Ankit Sharma',
          provenanceAt: new Date(),
        },
      });
      await db.escrowAccount.update({
        where: { id: wo.escrowAccount.id },
        data: {
          releasedAmount: wo.escrowAccount.releasedAmount + tranche,
          status: 'PARTIALLY_RELEASED',
        },
      });
      detail = `Released ₹${(tranche / 100).toLocaleString('en-IN')} against the test-enablement milestone. ${note}`;
      break;
    }

    case 'TEST_DISPATCH_BOOKED': {
      const requestNo = await nextNumber('TEST_REQUEST', 'TR');
      const testedLines = wo.supplierPo.lines.filter((l) => l.testingRequired);
      const scope = (wo.testScope as TestScope) ?? 'LOT_SAMPLE';
      const params = await db.testParameterMaster.findMany({ where: { isDefault: true } });
      const out = await whlSubmitTestRequest({
        workOrderId: wo.id,
        requestNo,
        scope,
        sampleSize: scope === 'LOT_SAMPLE' ? 50 : null,
        aql: scope === 'LOT_SAMPLE' ? 'AQL 1.0' : null,
        parameters: params.map((p) => p.code),
        lines: testedLines.map((l) => ({ mpn: l.mpn, quantity: l.quantity })),
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const lab = await db.testingLab.findFirst({ where: { isForeign: false } });
      await db.testRequest.create({
        data: {
          workOrderId: wo.id,
          requestNo,
          labId: lab?.id ?? null,
          labRequestRef: data?.labRequestRef ?? null,
          scope,
          sampleSize: scope === 'LOT_SAMPLE' ? 50 : null,
          aql: scope === 'LOT_SAMPLE' ? 'AQL 1.0' : null,
          parameters: JSON.stringify(params.map((p) => p.code)),
          status: 'SUBMITTED',
          submittedAt: new Date(),
          labIsForeign: false,
          provenance,
          provenanceActor: data ? 'Testing Laboratory simulator' : 'Akash Dwivedi',
          provenanceAt: new Date(),
          provenanceRef: data?.labRequestRef ?? null,
        },
      });
      await db.shipment.create({
        data: {
          workOrderId: wo.id,
          legType: 'TEST_OUT',
          carrierCode: 'SFEXP',
          originName: wo.supplierPo.supplier.city,
          originCountry: wo.supplierPo.supplier.country,
          destName: 'Testing Laboratory, Bengaluru',
          destCountry: 'India',
          declaredValue: toMinor(45_000),
          status: 'BOOKED',
          dispatchedAt: new Date(),
          provenance: 'MANUAL',
          provenanceActor: 'Supplier logistics partner',
          provenanceAt: new Date(),
        },
      });
      detail = `Test request ${requestNo} raised. ${note}`;
      break;
    }

    case 'PARTS_RECEIVED_AT_WHL': {
      const tr = wo.testRequests[0];
      if (!tr) return { ok: false, message: 'Raise the test request first.' };
      const testedLines = wo.supplierPo.lines.filter((l) => l.testingRequired);
      const qty =
        tr.scope === 'LOT_SAMPLE' ? 50 * Math.max(1, testedLines.length) : testedLines.reduce((a, l) => a + l.quantity, 0);
      await db.testRequest.update({
        where: { id: tr.id },
        data: { status: 'RECEIVED', receivedAt: new Date(), receivedQty: qty },
      });
      await db.shipment.updateMany({
        where: { workOrderId: wo.id, legType: 'TEST_OUT' },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      detail = `Lab logged ${qty.toLocaleString('en-IN')} pieces in and reconciled them against what was dispatched.`;
      break;
    }

    case 'TEST_SCOPE_CONFIRMED': {
      const tr = wo.testRequests[0];
      if (!tr) return { ok: false, message: 'Raise the test request first.' };
      await db.testRequest.update({ where: { id: tr.id }, data: { status: 'SCOPE_CONFIRMED' } });
      detail = 'Scope, sample size, AQL and test parameters are agreed with the lab.';
      break;
    }

    case 'TESTING_IN_PROGRESS': {
      const tr = wo.testRequests[0];
      if (!tr) return { ok: false, message: 'Raise the test request first.' };
      await db.testRequest.update({ where: { id: tr.id }, data: { status: 'IN_PROGRESS' } });
      const cost = toMinor(24_500);
      await db.testRequest.update({ where: { id: tr.id }, data: { testCost: cost } });
      await db.workOrder.update({ where: { id: wo.id }, data: { testingCost: cost } });
      detail = 'Lab has started the agreed checks.';
      break;
    }

    case 'TEST_PASSED':
    case 'TEST_FAILED': {
      const tr = wo.testRequests[0];
      if (!tr) return { ok: false, message: 'Raise the test request first.' };
      if (tr.result) return { ok: false, message: 'A result is already recorded for this test.' };
      const testedLines = wo.supplierPo.lines.filter((l) => l.testingRequired);
      const out = await whlGetTestResult({
        workOrderId: wo.id,
        labRequestRef: tr.labRequestRef ?? tr.requestNo,
        lines: testedLines.map((l) => ({ mpn: l.mpn, quantity: l.quantity })),
        sampleSize: tr.sampleSize ?? 0,
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;

      // The operator's chosen stage is authoritative — the adapter only supplies
      // the detail. A lab report that disagrees would be a data problem, not a
      // reason to silently override what the human recorded.
      const verdict = targetStageId === 'TEST_PASSED' ? 'PASS' : 'FAIL';
      const seed = Number(wo.alias.replace(/\D/g, '')) || 1;
      const result = await db.testResult.create({
        data: {
          testRequestId: tr.id,
          verdict,
          reportNo: data?.reportNo ?? `LAB-RPT-2026-${pad(seed % 9999)}`,
          signedBy: data?.signedBy ?? 'Dr S. Raghavan, Technical Manager',
          testedAt: new Date(),
          summary:
            verdict === 'PASS'
              ? 'All sampled units conform to datasheet limits and show no evidence of re-marking.'
              : 'Sampled units failed X-ray die verification and marking permanency. Batch not fit for supply.',
          provenance,
          provenanceActor: data ? 'Testing Laboratory simulator' : 'Akash Dwivedi',
          provenanceAt: new Date(),
        },
      });
      for (const [i, l] of testedLines.entries()) {
        const tested = tr.sampleSize ?? l.quantity;
        const failed = verdict === 'FAIL' && i === 0 ? Math.max(1, Math.round(tested * 0.24)) : 0;
        await db.testLineResult.create({
          data: {
            testResultId: result.id,
            mpn: l.mpn,
            lotRef: l.dateCodeLot,
            testedQty: tested,
            passedQty: tested - failed,
            failedQty: failed,
            verdict: failed > 0 ? 'FAIL' : 'PASS',
            failureMode: failed
              ? 'Re-marked package — die markings inconsistent with the declared date code'
              : null,
          },
        });
      }
      await db.testRequest.update({ where: { id: tr.id }, data: { status: 'COMPLETED' } });

      if (verdict === 'FAIL') {
        await openException(
          wo.id,
          'TEST_FAIL',
          `Lot ${testedLines[0]?.dateCodeLot ?? 'under test'} failed X-ray and marking-permanency checks. Batch is not fit for supply.`,
          targetStageId,
        );
      }
      detail = `${verdict === 'PASS' ? 'Pass' : 'Fail'} recorded. ${note}`;
      break;
    }

    case 'PARTS_RETURNED_TO_SUPPLIER': {
      await db.shipment.create({
        data: {
          workOrderId: wo.id,
          legType: 'TEST_RETURN',
          carrierCode: 'SFEXP',
          originName: 'Testing Laboratory, Bengaluru',
          originCountry: 'India',
          destName: wo.supplierPo.supplier.city,
          destCountry: wo.supplierPo.supplier.country,
          declaredValue: toMinor(45_000),
          status: 'DELIVERED',
          dispatchedAt: new Date(),
          deliveredAt: new Date(),
          provenance: 'MANUAL',
        },
      });
      detail = 'Tested parts are back with the supplier and confirmed received.';
      break;
    }

    case 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER': {
      const spec = {
        workOrderId: wo.id,
        legType: 'IMPORT' as const,
        origin: { name: wo.supplierPo.supplier.city, country: wo.supplierPo.supplier.country },
        dest: { name: 'New Delhi', country: 'India' },
        pieces: 4,
        grossWeightKg: 18.4,
        declaredValueMinor: wo.buyValue,
        currency: 'INR',
        incoterms: wo.incoterms,
        customsLines: wo.supplierPo.lines.map((l) => ({
          mpn: l.mpn,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          valueMinor: l.lineTotal,
        })),
      };
      const out = await dhlCreateShipment({ ...spec, service: 'EXPRESS WORLDWIDE' });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const freight = toMinor(Math.round((wo.buyValue / 100) * 0.035));
      const insurance = toMinor(Math.round((wo.buyValue / 100) * 0.004));
      await db.shipment.create({
        data: {
          workOrderId: wo.id,
          legType: 'IMPORT',
          carrierCode: 'DHL',
          serviceName: 'EXPRESS WORLDWIDE',
          awb: data?.awb ?? null,
          originName: spec.origin.name,
          originCountry: spec.origin.country,
          destName: spec.dest.name,
          destCountry: spec.dest.country,
          pieces: 4,
          grossWeightKg: 18.4,
          chargeableWeightKg: 22.5,
          declaredValue: wo.buyValue,
          freightAmount: freight,
          freightGst: pctOf(freight, 18),
          incoterms: wo.incoterms,
          status: 'IN_TRANSIT',
          dispatchedAt: new Date(),
          estimatedDelivery: data ? new Date(data.estimatedDelivery) : null,
          provenance,
          provenanceActor: data ? 'DHL simulator' : 'Akash Dwivedi',
          provenanceAt: new Date(),
          provenanceRef: data?.awb ?? null,
        },
      });
      await db.workOrder.update({
        where: { id: wo.id },
        data: { freightCost: freight, insuranceCost: insurance, creditableGstOther: pctOf(freight, 18) },
      });
      detail = data ? `AWB ${data.awb} created. ${note}` : `Shipment recorded by hand — ${note}`;
      break;
    }

    case 'IN_TRANSIT_INTERNATIONAL': {
      const ship = wo.shipments.find((s) => s.legType === 'IMPORT');
      if (!ship) return { ok: false, message: 'The import shipment has not been created yet.' };
      const out = await dhlTrack({ workOrderId: wo.id, awb: ship.awb ?? ship.id });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      if (data) {
        for (const e of data.events) {
          await db.trackingEvent.create({
            data: {
              shipmentId: ship.id,
              occurredAt: new Date(e.timestamp),
              code: e.code,
              description: e.description,
              location: e.location,
              provenance,
            },
          });
        }
      } else {
        await db.trackingEvent.create({
          data: {
            shipmentId: ship.id,
            occurredAt: new Date(),
            code: 'DF',
            description: 'Departed origin facility',
            location: ship.originName,
            provenance: 'MANUAL',
          },
        });
      }
      detail = `Tracking updated. ${note}`;
      break;
    }

    case 'BORDER_ARRIVAL_WHA_ENGAGED': {
      await db.customsEntry.upsert({
        where: { workOrderId: wo.id },
        create: {
          workOrderId: wo.id,
          whaAgentName: 'WHA Customs & Compliance — Delhi Air Cargo',
          portCode: 'INDEL4',
          status: 'NOT_FILED',
          provenance: 'MANUAL',
          provenanceActor: 'Ankit Sharma',
          provenanceAt: new Date(),
        },
        update: { whaAgentName: 'WHA Customs & Compliance — Delhi Air Cargo', portCode: 'INDEL4' },
      });
      await db.shipment.updateMany({
        where: { workOrderId: wo.id, legType: 'IMPORT' },
        data: { status: 'CUSTOMS' },
      });
      detail = 'Customs agent engaged and documents handed over.';
      break;
    }

    case 'CUSTOMS_ENTRY_FILED_ICEGATE': {
      const out = await icegateFileBillOfEntry({
        workOrderId: wo.id,
        portCode: wo.customsEntry?.portCode ?? 'INDEL4',
        invoiceValueMinor: wo.buyValue,
        currency: 'INR',
        lines: wo.supplierPo.lines.map((l) => ({
          hsnCode: l.hsnCode,
          description: l.description,
          quantity: l.quantity,
          valueMinor: l.lineTotal,
        })),
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const clearance = toMinor(11_500);
      await db.customsEntry.upsert({
        where: { workOrderId: wo.id },
        create: {
          workOrderId: wo.id,
          boeNumber: data?.boeNo ?? null,
          filingAckNo: data?.filingAckNo ?? null,
          filedAt: new Date(),
          portCode: 'INDEL4',
          whaAgentName: 'WHA Customs & Compliance — Delhi Air Cargo',
          status: 'FILED',
          provenance,
          provenanceActor: data ? 'ICEGATE simulator' : 'Ankit Sharma',
          provenanceAt: new Date(),
          provenanceRef: data?.boeNo ?? null,
        },
        update: {
          boeNumber: data?.boeNo ?? undefined,
          filingAckNo: data?.filingAckNo ?? undefined,
          filedAt: new Date(),
          status: 'FILED',
          provenance,
          provenanceRef: data?.boeNo ?? undefined,
        },
      });
      const entry = await db.customsEntry.findUnique({ where: { workOrderId: wo.id } });
      if (entry) {
        await db.customsStatusEvent.create({
          data: {
            customsEntryId: entry.id,
            status: 'FILED',
            occurredAt: new Date(),
            note: 'Bill of Entry lodged; supporting documents uploaded via eSanchit.',
            provenance,
          },
        });
      }
      await db.workOrder.update({ where: { id: wo.id }, data: { clearanceCost: clearance } });
      detail = data ? `Bill of Entry ${data.boeNo} filed. ${note}` : `Filed and recorded by hand — ${note}`;
      break;
    }

    case 'DUTY_ASSESSED_AND_PAID': {
      const entry = await db.customsEntry.findUnique({ where: { workOrderId: wo.id } });
      if (!entry) return { ok: false, message: 'File the Bill of Entry first.' };
      const assessable = wo.buyValue + wo.freightCost + wo.insuranceCost;
      const out = await icegateGetDutyAssessment({
        workOrderId: wo.id,
        boeNo: entry.boeNumber ?? entry.id,
        assessableValueMinor: assessable,
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const bcd = data?.heads.bcdMinor ?? pctOf(assessable, 10);
      const sws = data?.heads.swsMinor ?? pctOf(bcd, 10);
      const igst = data?.heads.igstMinor ?? pctOf(assessable + bcd + sws, 18);
      await db.customsEntry.update({
        where: { id: entry.id },
        data: {
          assessableValue: assessable,
          exchangeRateUsed: data?.exchangeRateUsed ?? null,
          dutyBcd: bcd,
          dutySws: sws,
          dutyIgst: igst,
          totalDuty: bcd + sws + igst,
          challanRef: data?.challanRef ?? `CHLN/${wo.alias}`,
          dutyPaidAt: new Date(),
          status: 'DUTY_PAID',
          provenance,
        },
      });
      await db.customsStatusEvent.createMany({
        data: [
          { customsEntryId: entry.id, status: 'ASSESSED', occurredAt: new Date(), note: 'Assessment complete. Duty payable generated.', provenance },
          { customsEntryId: entry.id, status: 'DUTY_PAID', occurredAt: new Date(), note: 'Duty paid via ICEGATE e-payment.', provenance },
        ],
      });
      // Import IGST is creditable and must NOT land in landed cost (§9).
      await db.workOrder.update({
        where: { id: wo.id },
        data: { dutyBcd: bcd, dutySws: sws, dutyIgst: igst },
      });
      await db.inputTaxCredit.create({
        data: {
          workOrderId: wo.id,
          source: 'IMPORT_IGST',
          documentRef: `BOE ${entry.boeNumber ?? entry.id}`,
          documentDate: new Date(),
          supplierName: 'Customs — Bill of Entry',
          taxableValue: assessable,
          igstAmount: igst,
          totalCredit: igst,
          eligible: true,
          gstr2bStatus: 'MATCHED',
          taxPeriod: new Date().toISOString().slice(0, 7),
        },
      });
      detail = `Duty of ₹${((bcd + sws + igst) / 100).toLocaleString('en-IN')} assessed and paid. Of that, ₹${(igst / 100).toLocaleString('en-IN')} is recoverable IGST and is excluded from landed cost. ${note}`;
      break;
    }

    case 'CUSTOMS_CLEARED': {
      const entry = await db.customsEntry.findUnique({ where: { workOrderId: wo.id } });
      if (!entry) return { ok: false, message: 'File the Bill of Entry first.' };
      await db.customsEntry.update({
        where: { id: entry.id },
        data: { status: 'OUT_OF_CHARGE', outOfChargeAt: new Date() },
      });
      await db.customsStatusEvent.create({
        data: {
          customsEntryId: entry.id,
          status: 'OUT_OF_CHARGE',
          occurredAt: new Date(),
          note: 'Out of charge granted. Goods may be removed.',
          provenance: 'MOCK',
        },
      });
      detail = 'Customs has released the goods.';
      break;
    }

    case 'GOODS_RECEIVED_INBOUND_AT_1BUY': {
      const grnNumber = await nextNumber('GRN', 'GRN');
      await db.grn.create({
        data: {
          workOrderId: wo.id,
          grnNumber,
          receivedAt: new Date(),
          cartons: 4,
          receivedBy: 'Akash Dwivedi',
          hasShortfall: false,
          remarks: 'All cartons intact. Seals matched the packing list.',
          lines: {
            create: wo.supplierPo.lines.map((l) => ({
              mpn: l.mpn,
              expectedQty: l.quantity,
              receivedQty: l.quantity,
              dateCodeLot: l.dateCodeLot,
              condition: 'OK',
            })),
          },
        },
      });
      await db.shipment.updateMany({
        where: { workOrderId: wo.id, legType: 'IMPORT' },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      detail = `Goods receipt ${grnNumber} raised; quantities reconciled.`;
      break;
    }

    case 'INBOUND_INSPECTION_IN_PROGRESS': {
      const reportNo = `INS-2026-${pad(Number(wo.alias.replace(/\D/g, '')) % 9999)}`;
      const checks: { category: string; label: string; plainLabel: string; expected: string }[] = [
        { category: 'COUNT', label: 'Piece count against packing list', plainLabel: 'Count everything', expected: `${wo.supplierPo.lines.reduce((a, l) => a + l.quantity, 0)} pcs` },
        { category: 'CONDITION', label: 'Physical condition of packaging', plainLabel: 'Check for damage', expected: 'No damage, seals intact' },
        { category: 'MPN_VERIFY', label: 'Part number verification against PO', plainLabel: 'Right parts?', expected: wo.supplierPo.lines.map((l) => l.mpn).join(', ') },
        { category: 'DATE_CODE_LOT', label: 'Date code and lot traceability', plainLabel: 'Batch markings', expected: 'Within 24 months' },
        { category: 'PACKAGING', label: 'ESD packaging integrity', plainLabel: 'Anti-static packing', expected: 'MBB sealed, ESD bags intact' },
        { category: 'MSL', label: 'Moisture barrier bag and humidity indicator', plainLabel: 'Moisture check', expected: 'HIC below 10%' },
        { category: 'DOCUMENTATION', label: 'Certificate of origin and test report match', plainLabel: 'Paperwork matches', expected: 'COO on file' },
      ];
      await db.inspectionReport.create({
        data: {
          workOrderId: wo.id,
          reportNo,
          startedAt: new Date(),
          inspectorId: 'u-priya',
          verdict: 'IN_PROGRESS',
          checklist: {
            create: checks.map((c, i) => ({
              sequence: i + 1,
              category: c.category,
              label: c.label,
              plainLabel: c.plainLabel,
              expected: c.expected,
              result: 'PENDING',
            })),
          },
        },
      });
      detail = `Inspection ${reportNo} opened with ${checks.length} checks.`;
      break;
    }

    case 'INSPECTION_PASSED': {
      const ins = wo.inspections[0];
      if (!ins) return { ok: false, message: 'Start the inbound inspection first.' };
      await db.inspectionChecklistItem.updateMany({
        where: { reportId: ins.id },
        data: { result: 'PASS', observed: 'As expected', evidenceCount: 3 },
      });
      await db.inspectionReport.update({
        where: { id: ins.id },
        data: {
          verdict: 'PASSED',
          completedAt: new Date(),
          signedOffAt: new Date(),
          remarks: 'All checks passed. Cleared for rebranding and repacking.',
        },
      });
      detail = 'Inspection signed off. This is the gate that unlocks the final supplier payment.';
      break;
    }

    case 'ESCROW_FINAL_RELEASE_AUTHORISED': {
      if (!wo.escrowAccount) return { ok: false, message: 'There is no escrow account on this order.' };

      // ── HARD GATE (§11A.4, AC#23) ──────────────────────────────────────
      const passed = await db.inspectionReport.findFirst({
        where: { workOrderId: wo.id, verdict: 'PASSED' },
      });
      if (!passed) {
        return {
          ok: false,
          message: 'The final escrow release is blocked until the inbound inspection has passed.',
          blockedBy: 'INSPECTION_PASSED',
          detail:
            'This is deliberate: releasing the balance before we have verified what arrived would remove the only leverage we have if the goods are wrong.',
        };
      }

      const approverIds = [...new Set(options?.approverIds ?? [])];
      if (approverIds.length < 2) {
        return {
          ok: false,
          message: 'The final release needs two different Finance approvers.',
          detail: `You supplied ${approverIds.length}. One person can never release the full payment alone.`,
        };
      }
      const approvers = await db.user.findMany({
        where: { id: { in: approverIds }, role: 'Finance' },
      });
      if (approvers.length < 2) {
        return {
          ok: false,
          message: 'Both approvers must hold the Finance role.',
          detail: `Only ${approvers.length} of the ${approverIds.length} selected are Finance users.`,
        };
      }

      const released = wo.escrowAccount.releasedAmount;
      const balance = Math.max(0, wo.escrowAccount.fundedAmount - released);
      const out = await escrowInstructRelease({
        workOrderId: wo.id,
        escrowRef: wo.escrowAccount.escrowRef,
        amountMinor: balance,
        beneficiary: wo.supplierPo.supplier.name,
        milestone: 'FINAL_SETTLEMENT',
        authorisedBy: approvers.map((a) => a.name),
        reason: 'Inbound inspection passed — releasing the remaining balance.',
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const tx = await db.escrowTransaction.create({
        data: {
          escrowId: wo.escrowAccount.id,
          type: 'FINAL_RELEASE',
          milestone: 'FINAL_SETTLEMENT',
          amount: balance,
          currency: 'INR',
          beneficiary: wo.supplierPo.supplier.name,
          reference: data?.instructionRef ?? `REL/FINAL/${wo.alias}`,
          status: 'INSTRUCTED',
          valueDate: new Date(),
          reason: 'Inbound inspection passed — releasing the remaining balance.',
          provenance,
          provenanceActor: approvers.map((a) => a.name).join(' + '),
          provenanceAt: new Date(),
        },
      });
      await db.escrowApproval.createMany({
        data: approvers.map((a) => ({
          transactionId: tx.id,
          approverId: a.id,
          approvedAt: new Date(),
          note: 'Inspection report signed off; landed cost and margin reviewed.',
        })),
      });
      detail = `₹${(balance / 100).toLocaleString('en-IN')} authorised by ${approvers.map((a) => a.name).join(' and ')}. ${note}`;
      break;
    }

    case 'SUPPLIER_PAID_IN_FULL': {
      if (wo.escrowAccount) {
        await db.escrowTransaction.updateMany({
          where: { escrowId: wo.escrowAccount.id, type: 'FINAL_RELEASE' },
          data: { status: 'SETTLED' },
        });
        const finalTx = await db.escrowTransaction.findFirst({
          where: { escrowId: wo.escrowAccount.id, type: 'FINAL_RELEASE' },
        });
        await db.escrowAccount.update({
          where: { id: wo.escrowAccount.id },
          data: {
            releasedAmount: wo.escrowAccount.releasedAmount + (finalTx?.amount ?? 0),
            status: 'SETTLED',
            settledAt: new Date(),
          },
        });
      }
      detail = 'Supplier has received the full amount owed.';
      break;
    }

    case 'REBRAND_AND_REPACK_IN_PROGRESS': {
      const jobNo = `RPK-2026-${pad(Number(wo.alias.replace(/\D/g, '')) % 9999)}`;
      const cost = toMinor(7_800);
      await db.repackJob.create({
        data: {
          workOrderId: wo.id,
          jobNo,
          startedAt: new Date(),
          status: 'IN_PROGRESS',
          cartonCount: 5,
          repackCost: cost,
          repackGst: pctOf(cost, 18),
          serialsCaptured: wo.supplierPo.lines.reduce((a, l) => a + l.quantity, 0),
          beforePhotos: 6,
          afterPhotos: 0,
          // Outer carton and paperwork only. The manufacturer's own reels, trays
          // and part markings are left untouched, so traceability and MSL
          // handling are unaffected.
          remarks:
            '1BUY labelling applied to the outer carton, with our packing list and invoice enclosed. Manufacturer reels, trays and part markings untouched.',
        },
      });
      await db.workOrder.update({
        where: { id: wo.id },
        data: {
          repackCost: cost,
          creditableGstOther: wo.creditableGstOther + pctOf(cost, 18),
        },
      });
      detail = `Repack job ${jobNo} opened.`;
      break;
    }

    case 'READY_FOR_OUTBOUND': {
      const job = wo.repackJobs[0];
      if (!job) return { ok: false, message: 'Start the repack job first.' };
      await db.repackJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date(), afterPhotos: 8, qcBy: 'Akash Dwivedi' },
      });
      detail = 'Repack QC passed; outbound packing list produced.';
      break;
    }

    case 'OUTBOUND_BOOKED': {
      const out = await dhlCreateShipment({
        workOrderId: wo.id,
        legType: 'OUTBOUND',
        origin: { name: 'New Delhi', country: 'India' },
        dest: { name: wo.customerPo.customer.city, country: wo.customerPo.customer.country },
        pieces: 5,
        grossWeightKg: 19.2,
        declaredValueMinor: wo.sellValue,
        currency: 'INR',
        service: 'EXPRESS WORLDWIDE',
        customsLines: wo.customerPo.lines.map((l) => ({
          mpn: l.mpn,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          valueMinor: l.lineTotal,
        })),
      });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      const freight = toMinor(4_860);
      await db.shipment.create({
        data: {
          workOrderId: wo.id,
          legType: 'OUTBOUND',
          carrierCode: 'DHL',
          serviceName: 'EXPRESS WORLDWIDE',
          awb: data?.awb ?? null,
          originName: 'New Delhi',
          originCountry: 'India',
          destName: wo.customerPo.customer.city,
          destCountry: wo.customerPo.customer.country,
          pieces: 5,
          declaredValue: wo.sellValue,
          freightAmount: freight,
          freightGst: pctOf(freight, 18),
          status: 'BOOKED',
          dispatchedAt: new Date(),
          provenance,
          provenanceActor: data ? 'DHL simulator' : 'Akash Dwivedi',
          provenanceAt: new Date(),
          provenanceRef: data?.awb ?? null,
        },
      });

      // The invoice must exist BEFORE the goods are removed (CGST Act §31(1)(a)),
      // and the e-way bill has to reference it (Rule 138). So it is raised here,
      // at dispatch — not after delivery.
      const invoiced = await raiseTaxInvoice(wo.id);
      detail = `${data ? `Outbound AWB ${data.awb} booked.` : `Booked by hand — ${note}`} ${invoiced.detail}`;
      break;
    }

    case 'OUT_FOR_DELIVERY':
    case 'DELIVERED': {
      const ship = wo.shipments.find((s) => s.legType === 'OUTBOUND');
      if (!ship) return { ok: false, message: 'Book the outbound shipment first.' };
      const delivered = targetStageId === 'DELIVERED';
      await db.shipment.update({
        where: { id: ship.id },
        data: {
          status: delivered ? 'DELIVERED' : 'OUT_FOR_DELIVERY',
          deliveredAt: delivered ? new Date() : null,
        },
      });
      await db.trackingEvent.create({
        data: {
          shipmentId: ship.id,
          occurredAt: new Date(),
          code: delivered ? 'OK' : 'WC',
          description: delivered
            ? `Delivered — signed by ${wo.customerPo.customer.contactName}`
            : 'With delivery courier',
          location: wo.customerPo.customer.city,
          provenance: 'MOCK',
        },
      });
      detail = delivered ? 'Customer has taken delivery.' : 'Out with the delivery courier.';
      break;
    }

    case 'POD_ISSUED_TO_CUSTOMER': {
      const ship = wo.shipments.find((s) => s.legType === 'OUTBOUND');
      if (!ship) return { ok: false, message: 'Book the outbound shipment first.' };
      const out = await dhlGetProofOfDelivery({ workOrderId: wo.id, awb: ship.awb ?? ship.id });
      const { data, provenance: p, note } = unwrap(out);
      provenance = p;
      await db.proofOfDelivery.create({
        data: {
          workOrderId: wo.id,
          shipmentId: ship.id,
          podNumber: data?.podRef ?? `POD-2026-${pad(Number(wo.alias.replace(/\D/g, '')) % 9999)}`,
          signedBy: data?.signedBy ?? wo.customerPo.customer.contactName,
          deliveredAt: data ? new Date(data.deliveredAt) : new Date(),
          remarks: 'Received in good condition.',
          sharedWithCustomerAt: new Date(),
          provenance,
          provenanceActor: data ? 'DHL simulator' : 'Akash Dwivedi',
          provenanceAt: new Date(),
          provenanceRef: data?.podRef ?? null,
        },
      });
      detail = data
        ? `Proof of delivery ${data.podRef} retrieved automatically and shared with the customer. ${note}`
        : `Recorded by hand — ${note}`;
      break;
    }

    case 'CUSTOMER_INVOICED_AND_SETTLED': {
      // The invoice was raised at dispatch. This stage records the money arriving.
      const invoices = await db.taxInvoice.findMany({ where: { workOrderId: wo.id } });
      if (invoices.length === 0) {
        return {
          ok: false,
          message: 'No tax invoice exists on this order, so there is nothing to settle.',
          detail:
            'The invoice is raised when the outbound shipment is booked. Advance through that stage first.',
        };
      }
      await db.taxInvoice.updateMany({
        where: { workOrderId: wo.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      const total = invoices.reduce((a, i) => a + i.totalAmount, 0);
      detail = `Collection reconciled against ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} totalling ₹${(total / 100).toLocaleString('en-IN')}.`;
      break;
    }

    case 'ORDER_CLOSED': {
      await db.workOrder.update({
        where: { id: wo.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await db.taxInvoice.updateMany({
        where: { workOrderId: wo.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      detail = 'Financial, physical and documentary closure complete. Realised margin is locked.';
      break;
    }

    default:
      detail = target.exitCriteria;
  }

  // ── Common bookkeeping for every advance ─────────────────────────────────
  const fromStage = wo.stage;
  const hoursThere = (Date.now() - wo.stageEnteredAt.getTime()) / 36e5;

  await db.workOrder.update({
    where: { id: wo.id },
    data: {
      stage: target.id,
      phase: target.phase,
      stageEnteredAt: new Date(),
      status: target.isTerminal ? 'CLOSED' : targetStageId === 'TEST_FAILED' ? 'BLOCKED' : 'ACTIVE',
    },
  });

  await db.stageTransition.create({
    data: {
      workOrderId: wo.id,
      fromStage,
      toStage: target.id,
      actorLabel: provenance === 'MANUAL' ? 'Akash Dwivedi' : `${target.owner} sync`,
      provenance,
      reason: overridden
        ? `Advanced without complete evidence for ${fromStage}. Reason given: ${options!.evidenceOverrideReason!.trim()}${options?.note ? ` — ${options.note}` : ''}`
        : (options?.note ?? null),
      durationSecondsInPrevious: Math.round(hoursThere * 3600),
    },
  });

  // The stage change itself. It was previously recorded only as a StageTransition,
  // which the Flow tab reads — but the audit log is where someone goes to ask
  // "what happened to this order and when", and a stage change is the biggest
  // thing that happens to it.
  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'Work order stage',
      entityId: wo.id,
      action: 'TRANSITION',
      field: 'Stage',
      beforeValue: getStage(fromStage)?.label ?? fromStage,
      afterValue: target.label,
      reason: options?.note?.trim() || null,
      provenance,
      actorId: 'u-priya',
      actorLabel: provenance === 'MANUAL' ? 'Akash Dwivedi' : `${target.owner} sync`,
    },
  });

  // An override is a decision worth finding later, so it goes on the audit log
  // as its own entry rather than only inside a transition's reason text.
  if (overridden) {
    const missing = [
      ...leaving.missingFields.map((f) => f.label),
      ...leaving.missingDocs.map((d) => d.label),
    ];
    await db.auditLogEntry.create({
      data: {
        workOrderId: wo.id,
        entity: 'StageEvidence',
        entityId: leavingEvidence?.id ?? wo.id,
        action: 'AUTHORISE',
        field: fromStage,
        beforeValue: `Incomplete: ${missing.join(', ')}`,
        afterValue: `Advanced anyway. Reason: ${options!.evidenceOverrideReason!.trim()}`,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
    });
  }

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Stage advanced to ${target.label}`,
      body: `${target.description}${detail ? ` ${detail}` : ''}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Activity',
      contextChips: {
        create: [{ kind: 'STAGE', refId: target.id, label: `${target.code} · ${target.label}` }],
      },
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'WorkOrder',
      entityId: wo.id,
      action: 'TRANSITION',
      field: 'stage',
      beforeValue: fromStage,
      afterValue: target.id,
      actorLabel: provenance === 'MANUAL' ? 'Akash Dwivedi' : `${target.owner} sync`,
      provenance,
    },
  });

  await db.task.updateMany({
    where: { workOrderId: wo.id, linkedStage: fromStage, status: 'OPEN' },
    data: { status: 'DONE', completedAt: new Date() },
  });

  if (!target.isTerminal) {
    await db.task.create({
      data: {
        workOrderId: wo.id,
        title: target.nextAction,
        ownerRole: target.nextActionOwner,
        linkedStage: target.id,
        priority: 'NORMAL',
        dueAt: new Date(Date.now() + target.expectedHours * 3600_000),
        status: 'OPEN',
      },
    });
  }

  safeRevalidate(`/orders/${wo.id}`);
  safeRevalidate('/orders');
  safeRevalidate('/dashboard');

  return {
    ok: true,
    stage: target.id,
    provenance,
    message: `Advanced to ${target.label}.`,
    detail,
  };
}

/** Advance to whatever the ladder says comes next. */
export async function advanceToNext(workOrderId: string): Promise<AdvanceResult> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: STAGE_CONTEXT_INCLUDE,
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };
  const ctx = stageContextFrom(wo);
  const next = nextStageFor(wo.stage, ctx);
  if (!next) return { ok: false, message: 'This order is already at the end of the ladder.' };
  return advanceStage(workOrderId, next.id);
}

// ── Exceptions (§4) ─────────────────────────────────────────────────────────

export async function openException(
  workOrderId: string,
  type: string,
  reason: string,
  offStage: string,
): Promise<{ ok: boolean; message: string }> {
  const exception = await db.exceptionRecord.create({
    data: {
      workOrderId,
      type,
      offStage,
      reason,
      severity: type === 'TEST_FAIL' || type === 'DAMAGED_INBOUND' ? 'CRITICAL' : 'HIGH',
      status: 'OPEN',
    },
  });
  await db.workOrder.update({ where: { id: workOrderId }, data: { status: 'BLOCKED' } });
  await db.task.create({
    data: {
      workOrderId,
      title: `Decide how to resolve: ${type.replace(/_/g, ' ').toLowerCase()}`,
      description: reason,
      ownerRole: 'Procurement',
      linkedStage: offStage,
      exceptionId: exception.id,
      priority: 'URGENT',
      dueAt: new Date(Date.now() + 86400_000),
      status: 'OPEN',
    },
  });
  await db.communication.create({
    data: {
      workOrderId,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Problem raised: ${type.replace(/_/g, ' ').toLowerCase()}`,
      body: reason,
      status: 'ACTION_REQUIRED',
      isUnread: true,
      occurredAt: new Date(),
      systemIcon: 'AlertTriangle',
      contextChips: {
        create: [{ kind: 'EXCEPTION', refId: exception.id, label: type.replace(/_/g, ' ') }],
      },
    },
  });
  revalidatePath(`/orders/${workOrderId}`);
  return { ok: true, message: 'Problem recorded and the order is now blocked.' };
}

/**
 * Resolve an exception by choosing one of its declared routes.
 *
 * The route id is looked up in EXCEPTION_DEFS, so the button the operator saw
 * and the behaviour that follows come from the same definition. Every choice is
 * logged to the order's Communication thread, and the order then either advances
 * to the route's target stage or terminates, as that route specifies.
 */
export async function resolveExceptionRoute(
  exceptionId: string,
  routeId: string,
): Promise<AdvanceResult> {
  const exception = await db.exceptionRecord.findUnique({ where: { id: exceptionId } });
  if (!exception) return { ok: false, message: 'That problem record no longer exists.' };
  if (exception.status === 'RESOLVED') {
    return { ok: false, message: 'That problem has already been resolved.' };
  }

  const route = exceptionRoute(exception.type, routeId);
  if (!route) {
    return { ok: false, message: 'That resolution route is not valid for this problem.' };
  }

  await db.exceptionRecord.update({
    where: { id: exceptionId },
    data: {
      status: 'RESOLVED',
      chosenRoute: route.label,
      resolutionNote: route.consequence,
      resolvedAt: new Date(),
    },
  });
  await db.task.updateMany({
    where: { exceptionId, status: 'OPEN' },
    data: { status: 'DONE', completedAt: new Date() },
  });

  // The decision itself is logged to Communication, with the consequence spelled
  // out, so the thread records not just what was chosen but what it meant.
  await db.communication.create({
    data: {
      workOrderId: exception.workOrderId,
      entryClass: 'HUMAN',
      channel: 'PORTAL',
      direction: 'INTERNAL',
      subject: `Decision taken on ${exceptionDef(exception.type)?.label ?? exception.type}: ${route.label}`,
      body: `${route.consequence}\n\nOriginal problem: ${exception.reason}`,
      visibility: 'INTERNAL',
      status: 'CLOSED',
      occurredAt: new Date(),
      loggedById: 'u-priya',
      participants: {
        create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }],
      },
      contextChips: {
        create: [
          { kind: 'EXCEPTION', refId: exceptionId, label: route.label },
          ...(route.targetStage
            ? [
                {
                  kind: 'STAGE',
                  refId: route.targetStage,
                  label: `${getStage(route.targetStage).code} · ${getStage(route.targetStage).label}`,
                },
              ]
            : []),
        ],
      },
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: exception.workOrderId,
      entity: 'ExceptionRecord',
      entityId: exceptionId,
      action: 'UPDATE',
      field: 'chosenRoute',
      beforeValue: 'OPEN',
      afterValue: route.label,
      actorLabel: 'Akash Dwivedi',
    },
  });

  const stillOpen = await db.exceptionRecord.count({
    where: { workOrderId: exception.workOrderId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  });

  // ── Terminal routes stop the order rather than advancing it ────────────────
  if (route.terminal) {
    await db.workOrder.update({
      where: { id: exception.workOrderId },
      data: { status: 'CANCELLED', closedAt: new Date() },
    });
    if (route.terminal === 'RESOURCE') {
      // Hand the customer order back to sourcing so another vendor can be used.
      const wo = await db.workOrder.findUnique({
        where: { id: exception.workOrderId },
        select: { customerPoId: true },
      });
      if (wo) {
        await db.customerPO.update({
          where: { id: wo.customerPoId },
          data: { status: 'RECEIVED' },
        });
      }
    }
    safeRevalidate(`/orders/${exception.workOrderId}`);
    safeRevalidate('/orders');
    safeRevalidate('/dashboard');
    return {
      ok: true,
      message: `Resolved as “${route.label}”.`,
      detail:
        route.terminal === 'RESOURCE'
          ? `${route.consequence} The customer order is available to link to a new supplier order again.`
          : route.consequence,
    };
  }

  if (stillOpen === 0) {
    await db.workOrder.update({
      where: { id: exception.workOrderId },
      data: { status: 'ACTIVE' },
    });
  }

  safeRevalidate(`/orders/${exception.workOrderId}`);
  safeRevalidate('/dashboard');

  if (route.targetStage) {
    const moved = await advanceStage(exception.workOrderId, route.targetStage, {
      note: `Resolution route: ${route.label}`,
    });
    return moved.ok
      ? {
          ...moved,
          message: `Resolved as “${route.label}”, and the order moved to ${getStage(route.targetStage).label}.`,
          detail: `${route.consequence} ${moved.detail ?? ''}`.trim(),
        }
      : {
          ok: true,
          message: `Resolved as “${route.label}”, but the order could not advance yet.`,
          detail: moved.message,
        };
  }

  return { ok: true, message: `Resolved as “${route.label}”.`, detail: route.consequence };
}

/** Kept for callers that pass an explicit stage rather than a declared route. */
export async function resolveException(
  exceptionId: string,
  route: string,
  targetStageId?: string,
): Promise<AdvanceResult> {
  const exception = await db.exceptionRecord.findUnique({ where: { id: exceptionId } });
  if (!exception) return { ok: false, message: 'That problem record no longer exists.' };

  await db.exceptionRecord.update({
    where: { id: exceptionId },
    data: {
      status: 'RESOLVED',
      chosenRoute: route,
      resolutionNote: route,
      resolvedAt: new Date(),
    },
  });
  await db.task.updateMany({
    where: { exceptionId, status: 'OPEN' },
    data: { status: 'DONE', completedAt: new Date() },
  });
  await db.communication.create({
    data: {
      workOrderId: exception.workOrderId,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Problem resolved: ${exception.type.replace(/_/g, ' ').toLowerCase()}`,
      body: `Route chosen: ${route}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Check',
      contextChips: {
        create: [{ kind: 'EXCEPTION', refId: exceptionId, label: route }],
      },
    },
  });
  await db.auditLogEntry.create({
    data: {
      workOrderId: exception.workOrderId,
      entity: 'ExceptionRecord',
      entityId: exceptionId,
      action: 'UPDATE',
      field: 'status',
      beforeValue: 'OPEN',
      afterValue: `RESOLVED — ${route}`,
      actorLabel: 'Akash Dwivedi',
    },
  });

  const stillOpen = await db.exceptionRecord.count({
    where: { workOrderId: exception.workOrderId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  });
  if (stillOpen === 0) {
    await db.workOrder.update({
      where: { id: exception.workOrderId },
      data: { status: 'ACTIVE' },
    });
  }

  safeRevalidate(`/orders/${exception.workOrderId}`);
  safeRevalidate('/dashboard');

  if (targetStageId) {
    const moved = await advanceStage(exception.workOrderId, targetStageId, {
      note: `Resolution route: ${route}`,
    });
    return moved.ok
      ? { ...moved, message: `Resolved as “${route}”, and ${moved.message.toLowerCase()}` }
      : { ok: true, message: `Resolved as “${route}”.`, detail: moved.message };
  }

  return { ok: true, message: `Resolved as “${route}”. The order is unblocked.` };
}

// ── Raising the customer tax invoice ────────────────────────────────────────
/**
 * Raised at DISPATCH, not after delivery.
 *
 * CGST Act §31(1)(a) requires the invoice for a supply of goods to be issued
 * before or at the time of removal, and Rule 138 requires the e-way bill to be
 * generated before movement and to reference that invoice. Invoicing after POD
 * would leave goods travelling with no invoice.
 */
async function raiseTaxInvoice(workOrderId: string): Promise<{ detail: string }> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: { customerPo: { include: { customer: true, lines: true } } },
  });
  if (!wo) return { detail: 'Order not found — no invoice raised.' };
  const existing = await db.taxInvoice.findFirst({ where: { workOrderId } });
  if (existing) return { detail: `Invoice ${existing.invoiceNumber} already exists.` };
  let provenance: Provenance = 'MANUAL';
      const org = await db.orgSetting.findFirst();
      if (!org) return { detail: 'Tax configuration is missing — no invoice raised.' };
      const rates = await db.hsnRate.findMany();
      const rateLookup = makeRateLookup(
        rates.map((r) => ({
          id: r.id,
          hsnCode: r.hsnCode,
          description: r.description,
          cgstRate: r.cgstRate,
          sgstRate: r.sgstRate,
          igstRate: r.igstRate,
          cessRate: r.cessRate,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
        })) as HsnRateRow[],
      );
      const c = wo.customerPo.customer;
      const invoiceDate = new Date();
      const computation = computeGstInvoice({
        invoiceDate,
        seller: { gstin: org.gstin, stateCode: org.stateCode },
        buyer: { gstin: c.gstin, stateCode: c.stateCode, isSez: c.isSez, isExport: c.isExport },
        shipToStateCode: c.stateCode,
        lutApplied: c.isSez,
        rateLookup,
        lines: wo.customerPo.lines.map((l) => ({
          lineNo: l.lineNo,
          mpn: l.mpn,
          description: l.description,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      });

      const invoiceNumber = await nextNumber('TAX_INVOICE', 'INV-1B');

      // A supply *to* an SEZ unit is e-invoiced like any other — the SEZWP/SEZWOP
      // categories exist for exactly this. Only an SEZ unit's own outward supply is
      // exempt, and we are a regular supplier, so turnover is the only test.
      const eInvoiceApplies = computation.totalAmount >= org.eInvoiceThreshold;
      const zeroRated = computation.treatment.startsWith('ZERO_RATED');
      const supplyCategory: SupplyCategory = c.isSez
        ? zeroRated
          ? 'SEZWOP'
          : 'SEZWP'
        : c.isExport
          ? zeroRated
            ? 'EXPWOP'
            : 'EXPWP'
          : 'B2B';

      let irn: string | null = null;
      let ackNo: string | null = null;
      let qr: string | null = null;
      let eStatus = 'NOT_APPLICABLE';
      if (eInvoiceApplies) {
        const out = await gspGenerateIrn({
          workOrderId: wo.id,
          invoiceNumber,
          invoiceDate: invoiceDate.toISOString(),
          sellerGstin: org.gstin,
          buyerGstin: c.gstin,
          supplyCategory,
          totalMinor: computation.totalAmount,
          lines: computation.lines.map((l) => ({ hsnCode: l.hsnCode, taxableMinor: l.taxableValue })),
        });
        const { data, provenance: p } = unwrap(out);
        provenance = p;
        if (data) {
          irn = data.irn;
          ackNo = data.ackNo;
          qr = data.signedQrCode;
          eStatus = 'GENERATED';
        } else {
          // IRN failure must never block the operator (§11A.5b).
          eStatus = 'PENDING';
        }
      }

      // Rule 138: goods above the threshold may not move without a way bill. Ask
      // for the number BEFORE writing anything, so the invoice and its way bill
      // can go in as one transaction — an invoice that exists while its order is
      // still a stage behind is worse than a failed click.
      const needsWayBill = computation.totalAmount >= org.eWayBillThreshold;
      const distanceKm = c.stateCode === org.stateCode ? 24 : 1180;
      let ewbData: { ewbNo: string; validUntil: string } | null = null;
      let ewbProvenance = 'MANUAL';
      if (needsWayBill) {
        const ewb = await gspGenerateEWayBill({
          workOrderId: wo.id,
          invoiceNumber,
          transportMode: 'ROAD',
          distanceKm,
        });
        const un = unwrap(ewb);
        ewbData = un.data;
        ewbProvenance = un.provenance;
      }
      const ewbPending = needsWayBill && !ewbData;

      const invoice = await db.taxInvoice.create({
        data: {
          invoiceNumber,
          workOrderId: wo.id,
          customerId: c.id,
          invoiceDate,
          dueDate: new Date(Date.now() + 45 * 86400_000),
          placeOfSupply: computation.placeOfSupply,
          placeOfSupplyName: c.stateName,
          taxTreatment: computation.treatment,
          lutApplied: c.isSez,
          taxableValue: computation.taxableValue,
          cgstAmount: computation.cgstAmount,
          sgstAmount: computation.sgstAmount,
          igstAmount: computation.igstAmount,
          cessAmount: computation.cessAmount,
          roundingAdjustment: computation.roundingAdjustment,
          totalAmount: computation.totalAmount,
          amountInWords: amountInWords(computation.totalAmount),
          irn,
          ackNo,
          ackDate: irn ? invoiceDate : null,
          signedQrCode: qr,
          eInvoiceStatus: eStatus,
          status: 'SENT',
          provenance: irn ? provenance : 'MANUAL',
          provenanceActor: irn ? 'GST e-invoice simulator' : 'Ankit Sharma',
          provenanceAt: invoiceDate,
          lines: {
            create: computation.lines.map((l) => ({
              lineNo: l.lineNo,
              mpn: l.mpn,
              description: l.description,
              hsnCode: l.hsnCode,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxableValue: l.taxableValue,
              cgstRate: l.cgstRate,
              cgstAmount: l.cgstAmount,
              sgstRate: l.sgstRate,
              sgstAmount: l.sgstAmount,
              igstRate: l.igstRate,
              igstAmount: l.igstAmount,
              cessRate: l.cessRate,
              cessAmount: l.cessAmount,
              lineTotal: l.lineTotal,
              rateSourceId: l.rateSourceId,
            })),
          },
        },
      });

      // If the portal could not be reached the goods still moved, so the record is
      // raised awaiting its number rather than skipped — silently omitting it
      // would leave a consignment on the road with no paperwork on file and
      // nothing on screen saying so.
      if (needsWayBill) {
        await db.eWayBill.create({
          data: {
            ewbNumber: ewbData?.ewbNo ?? null,
            invoiceId: invoice.id,
            generatedAt: invoiceDate,
            validUntil: ewbData ? new Date(ewbData.validUntil) : null,
            transportMode: 'ROAD',
            transporterName: 'DHL Express India',
            distanceKm,
            status: ewbData ? 'ACTIVE' : 'AWAITING_NUMBER',
            generatedBy: 'Ankit Sharma',
            provenance: ewbData ? ewbProvenance : 'MANUAL',
          },
        });
      }

      const detail = `Invoice ${invoiceNumber} raised — ${computation.treatment.replace(/_/g, ' ').toLowerCase()}, total ₹${(computation.totalAmount / 100).toLocaleString('en-IN')}.${
        eStatus === 'PENDING' ? ' The invoice reference number could not be generated, so the invoice is flagged as awaiting one — enter it by hand once available.' : ''
      }${
        ewbPending
          ? ' This consignment is above the way bill threshold, so a way bill has been raised awaiting its number — generate it on the government portal and enter the number before the goods move.'
          : ''
      }`;
  return { detail };
}
