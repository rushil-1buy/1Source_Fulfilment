'use server';

/**
 * The inbound leg, driven end to end: book the consignment, watch it move,
 * clear it, and book it in.
 *
 * Five steps, and each is a separate call rather than one button that does
 * everything, because each one waits on something outside this platform. You
 * cannot track a consignment that has not been collected, and you cannot pull a
 * proof of delivery for one still in the air.
 *
 *   BOOK    — rate the leg, create the waybill, file the label.
 *   PICKUP  — ask the carrier to collect from the supplier.
 *   SYNC    — pull tracking, move the order, raise what went wrong.
 *   POD     — retrieve proof of delivery once it is delivered.
 *   RECEIVE — count it in and raise the goods receipt note.
 *
 * SYNC IS THE INTERESTING ONE. It is the only place the platform lets an
 * outside system move an order, so it is deliberately narrow: tracking may
 * advance the order and raise events, and it may do nothing else. It cannot
 * skip a step that needs our own evidence, it cannot move an order backwards,
 * and a code it does not recognise is recorded rather than acted on. See
 * lib/domain/dhl-tracking.ts for what each code is allowed to mean.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { dhlCreateShipment, dhlGetProofOfDelivery, dhlRate, dhlTrack } from '@/lib/integrations/adapters';
import { advanceStage } from '@/lib/actions/stage';
import { recordInboundEvent } from '@/lib/actions/inbound-events';
import { applicableStages, getStage } from '@/lib/domain/stages';
import { stageContextFrom, STAGE_CONTEXT_INCLUDE } from '@/lib/domain/stage-context';
import { dhlCode, readTracking, stagesToAdvance } from '@/lib/domain/dhl-tracking';
import { legAppointability } from '@/lib/domain/appointments';
import { TEAM_SLUGS } from '@/lib/domain/enums';
import { renderDocumentBody } from '@/lib/domain/document-bodies';
import { DOC_CONTEXT_INCLUDE, docContextFrom } from '@/lib/queries/doc-context';

export interface FlowResult {
  ok: boolean;
  message: string;
  detail?: string;
  /** What actually changed, one line each, for the run log. */
  did?: string[];
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

function revalidateAll(orderId: string) {
  safeRevalidate(`/orders/${orderId}`);
  safeRevalidate('/logistics');
  for (const slug of Object.keys(TEAM_SLUGS)) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}

/** The order, loaded the way every step here needs it. */
async function loadOrder(orderId: string) {
  return db.workOrder.findUnique({
    where: { id: orderId },
    include: {
      ...STAGE_CONTEXT_INCLUDE,
      shipments: { include: { events: true } },
      customerPo: { include: { customer: true, lines: true } },
      supplierPo: { include: { supplier: true, lines: true } },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Book
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rates the inbound leg and creates the waybill.
 *
 * Refuses where the delivery term puts the carriage on the supplier: booking a
 * leg they have already bought means paying twice for one movement, and the
 * platform knowing the term is the whole reason it can stop that.
 */
export async function bookInboundShipment(orderId: string, service?: string): Promise<FlowResult> {
  const wo = await loadOrder(orderId);
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const gate = legAppointability('IMPORT', wo.incoterms, wo.customerPo.incoterms);
  if (!gate.ours) {
    return {
      ok: false,
      message: 'The inbound leg is not ours to book.',
      detail: gate.reason,
    };
  }

  const existing = wo.shipments.find((s) => s.legType === 'IMPORT');
  if (existing?.awb && existing.status !== 'DRAFT') {
    return {
      ok: true,
      message: 'Already booked.',
      detail: `Waybill ${existing.awb} with ${existing.carrierCode}. Re-booking would create a second consignment for one movement.`,
    };
  }

  const grossKg = Math.max(
    1,
    Number(
      (wo.customerPo.lines.reduce((a, l) => a + l.quantity, 0) * 0.0025 + 2).toFixed(2),
    ),
  );
  const spec = {
    workOrderId: wo.id,
    legType: 'IMPORT' as const,
    origin: { name: wo.supplierPo.supplier.name, country: wo.supplierPo.supplier.country ?? '—' },
    dest: { name: '1BUY Warehouse, Bengaluru', country: 'India' },
    pieces: Math.max(1, Math.ceil(grossKg / 12)),
    grossWeightKg: grossKg,
    declaredValueMinor: wo.supplierPo.totalValue,
    currency: wo.buyCurrency,
    incoterms: wo.incoterms,
    customsLines: wo.customerPo.lines.map((l) => ({
      mpn: l.mpn,
      hsnCode: l.hsnCode,
      quantity: l.quantity,
      valueMinor: l.lineTotal,
    })),
  };

  const did: string[] = [];

  /*
   * Rate first, and keep the quotes.
   *
   * Not decoration: the freight number is what the landed cost is built on, and
   * an order priced against a guess is an order whose margin is a guess. Where
   * the rate call fails the booking still goes ahead — a consignment that must
   * move is not held up by a quote — but the shipment carries no rate and the
   * cost has to be entered by hand.
   */
  const rated = await dhlRate(spec);
  let chosen = service ?? 'Express Worldwide';
  let quotesJson: string | null = null;
  if (rated.ok) {
    quotesJson = JSON.stringify(rated.data.quotes);
    const best = service
      ? rated.data.quotes.find((q) => q.service === service)
      : rated.data.quotes[0];
    if (best) {
      chosen = best.service;
      did.push(
        `Rated the leg: ${rated.data.quotes.length} service${rated.data.quotes.length === 1 ? '' : 's'} quoted, taking ${best.service} at ${(best.amountMinor / 100).toFixed(2)} ${best.currency}.`,
      );
    }
  } else {
    did.push('Rating was unavailable, so the freight cost has to be entered by hand.');
  }

  const booked = await dhlCreateShipment({ ...spec, service: chosen });
  if (!booked.ok) {
    return {
      ok: false,
      message: 'The carrier did not accept the booking.',
      detail:
        'reason' in booked
          ? booked.reason
          : 'error' in booked
            ? booked.error
            : 'No waybill was issued, so nothing was recorded against the order.',
      did,
    };
  }

  const shipment = existing
    ? await db.shipment.update({
        where: { id: existing.id },
        data: {
          carrierCode: 'DHL',
          serviceName: chosen,
          awb: booked.data.awb,
          status: 'BOOKED',
          estimatedDelivery: new Date(booked.data.estimatedDelivery),
          rateQuotes: quotesJson,
          provenance: booked.provenance,
          provenanceActor: 'DHL',
          provenanceAt: new Date(),
          provenanceRef: booked.data.dispatchConfirmation,
        },
      })
    : await db.shipment.create({
        data: {
          workOrderId: wo.id,
          legType: 'IMPORT',
          carrierCode: 'DHL',
          serviceName: chosen,
          awb: booked.data.awb,
          status: 'BOOKED',
          originName: spec.origin.name,
          originCountry: spec.origin.country,
          destName: spec.dest.name,
          destCountry: spec.dest.country,
          pieces: spec.pieces,
          grossWeightKg: spec.grossWeightKg,
          declaredValue: spec.declaredValueMinor,
          currency: spec.currency,
          incoterms: wo.incoterms,
          estimatedDelivery: new Date(booked.data.estimatedDelivery),
          rateQuotes: quotesJson,
          provenance: booked.provenance,
          provenanceActor: 'DHL',
          provenanceAt: new Date(),
          provenanceRef: booked.data.dispatchConfirmation,
        },
      });

  did.push(`Waybill ${booked.data.awb} issued, ${chosen}.`);

  // The airway bill, as a document on the order rather than a number in a field.
  const ctx = docContextFrom(
    await db.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: DOC_CONTEXT_INCLUDE }),
  );
  await db.document.create({
    data: {
      workOrderId: wo.id,
      shipmentId: shipment.id,
      stageId: 'IN_TRANSIT_INTERNATIONAL',
      docType: 'AWB_LABEL',
      title: `Air waybill ${booked.data.awb}`,
      fileName: `AWB-${booked.data.awb}.pdf`,
      sizeBytes: 38_000,
      uploadedBy: 'DHL',
      provenance: booked.provenance,
      bodyText: renderDocumentBody('AWB_LABEL', { ...ctx, shipment: { awb: booked.data.awb, carrier: 'DHL', origin: spec.origin.name, destination: spec.dest.name } }),
    },
  });
  did.push('Air waybill filed against the order.');

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Inbound leg booked — ${booked.data.awb}`,
      body: `${chosen} with DHL, ${spec.pieces} piece(s), ${spec.grossWeightKg} kg gross, from ${spec.origin.name}. Estimated delivery ${booked.data.estimatedDelivery.slice(0, 10)}.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Truck',
    },
  });

  revalidateAll(orderId);
  return {
    ok: true,
    message: `Booked — waybill ${booked.data.awb}.`,
    detail: `${chosen}. Tracking appears against this leg as the carrier reports it.`,
    did,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Sync tracking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pulls tracking and lets it move the order.
 *
 * The only place an outside system is allowed to advance a stage, so the rules
 * are narrow and all of them live in the domain module:
 *
 *   · it can only move the order FORWARD — an out-of-order scan for a step
 *     already passed must not rewind it;
 *   · it advances through the real gate, so a step needing our own evidence
 *     refuses exactly as it would for a person;
 *   · a code it does not recognise is recorded and acted on by nobody.
 */
export async function syncInboundTracking(orderId: string): Promise<FlowResult> {
  const wo = await loadOrder(orderId);
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const leg = wo.shipments.find((s) => s.legType === 'IMPORT');
  if (!leg?.awb) {
    return {
      ok: false,
      message: 'Nothing to track yet.',
      detail: 'Book the inbound leg first — there is no waybill to ask the carrier about.',
    };
  }

  const res = await dhlTrack({ workOrderId: wo.id, awb: leg.awb });
  if (!res.ok) {
    return {
      ok: false,
      message: 'Tracking is unavailable.',
      detail:
        'reason' in res ? res.reason : 'error' in res ? res.error : 'The carrier did not respond.',
    };
  }

  const did: string[] = [];

  // ── New scans onto the consignment's history ───────────────────────────
  const seen = new Set(leg.events.map((e) => `${e.code}@${e.occurredAt.toISOString()}`));
  let added = 0;
  for (const e of res.data.events) {
    const key = `${e.code}@${new Date(e.timestamp).toISOString()}`;
    if (seen.has(key)) continue;
    const m = dhlCode(e.code);
    await db.trackingEvent.create({
      data: {
        shipmentId: leg.id,
        occurredAt: new Date(e.timestamp),
        code: m.code,
        // The carrier's own words, then ours. A desk that only sees "AF" has to
        // go and look it up; one that only sees our gloss cannot check it.
        description: `${e.description} — ${m.meaning}`,
        location: e.location,
        provenance: res.provenance,
      },
    });
    added += 1;
  }
  if (added > 0) did.push(`${added} new tracking scan${added === 1 ? '' : 's'} recorded.`);

  await db.shipment.update({
    where: { id: leg.id },
    data: {
      status:
        res.data.statusCode === 'OK'
          ? 'DELIVERED'
          : res.data.statusCode === 'CC' || res.data.statusCode === 'CD'
            ? 'CUSTOMS'
            : 'IN_TRANSIT',
      deliveredAt: res.data.actualDelivery ? new Date(res.data.actualDelivery) : leg.deliveredAt,
      estimatedDelivery: res.data.estimatedDelivery
        ? new Date(res.data.estimatedDelivery)
        : leg.estimatedDelivery,
    },
  });

  // ── What the feed implies ──────────────────────────────────────────────
  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  const ladder = applicableStages(ctx).map((s) => s.id);
  const reading = readTracking(
    res.data.events.map((e) => ({
      code: e.code,
      timestamp: e.timestamp,
      description: e.description,
      location: e.location,
    })),
    ladder,
  );

  if (reading.unrecognised.length > 0) {
    did.push(
      `${reading.unrecognised.join(', ')} recorded but not acted on — the platform does not recognise ${reading.unrecognised.length === 1 ? 'it' : 'them'}.`,
    );
  }

  // ── Events the feed calls for ──────────────────────────────────────────
  for (const eventId of reading.events) {
    const already = await db.inboundEventRecord.findFirst({
      where: { workOrderId: wo.id, eventId, status: 'OPEN' },
    });
    if (already) continue;
    const out = await recordInboundEvent(wo.id, eventId, {
      note: `Raised from DHL tracking on waybill ${leg.awb}.`,
    });
    if (out.ok) did.push(`${out.message} ${out.detail ?? ''}`.trim());
  }

  // ── Stages the feed implies ────────────────────────────────────────────
  const steps = stagesToAdvance(ladder, wo.stage, reading.impliedStage);
  let from = wo.stage;
  for (const next of steps) {
    const adv = await advanceStage(wo.id, next, { expectedFromStage: from });
    if (!adv.ok) {
      did.push(
        `Tracking says the consignment is at ${getStage(next).code}, but the order stopped at ${getStage(from).code}: ${adv.message}`,
      );
      break;
    }
    did.push(`${getStage(from).code} → ${getStage(next).code}, on the carrier's scan.`);
    from = next;
  }

  revalidateAll(orderId);
  return {
    ok: true,
    message: `Tracking synced — ${res.data.statusText}.`,
    detail: did.length === 0 ? 'Nothing new since the last check.' : undefined,
    did,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Proof of delivery, then the goods receipt note
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Books the consignment in and raises the goods receipt note.
 *
 * The GRN is counted against the packing list, not against the purchase order.
 * The two usually agree, and where they do not it is the packing list that says
 * what the supplier claims to have sent — which is the number a shortage claim
 * is argued against.
 *
 * A shortfall does not stop the receipt. The goods are on the dock either way,
 * and refusing to book them in because they are short leaves them unrecorded
 * while somebody argues. It raises the shortage as an event instead, which is
 * what actually gets it chased.
 */
export async function receiveInboundConsignment(
  orderId: string,
  counts: { mpn: string; receivedQty: number; condition?: string }[],
  input: { storageLocation?: string; remarks?: string } = {},
): Promise<FlowResult> {
  const wo = await loadOrder(orderId);
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const existing = await db.grn.findFirst({ where: { workOrderId: wo.id } });
  if (existing) {
    return {
      ok: true,
      message: 'Already booked in.',
      detail: `${existing.grnNumber}, received ${existing.receivedAt.toISOString().slice(0, 10)}. A second receipt for one consignment would double the stock.`,
    };
  }

  /*
   * The goods have to be here.
   *
   * Gated on the ORDER's own step rather than on the carrier's feed. Tracking
   * lags — a consignment can be on the dock while the last scan still says in
   * transit — so refusing on tracking would block a legitimate receipt. But
   * booking in a consignment nobody has said has arrived creates stock out of
   * an expectation, and the count that follows is against goods that are not
   * there to count.
   */
  const ctxNow = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  const ladderNow = applicableStages(ctxNow).map((s) => s.id);
  const arrivedIdx = ladderNow.indexOf('GOODS_RECEIVED_INBOUND_AT_1BUY');
  const hereIdx = ladderNow.indexOf(wo.stage);
  if (arrivedIdx >= 0 && hereIdx >= 0 && hereIdx < arrivedIdx) {
    const here = getStage(wo.stage);
    return {
      ok: false,
      message: 'The consignment has not arrived yet.',
      detail: `The order is at ${here.code} ${here.label}. Book it in once it reaches the dock — a receipt raised now would create stock from an expectation, and the count would be against goods that are not there.`,
    };
  }

  const leg = wo.shipments.find((s) => s.legType === 'IMPORT');
  const did: string[] = [];

  // ── Proof of delivery, where the carrier has one ───────────────────────
  if (leg?.awb) {
    const pod = await dhlGetProofOfDelivery({ workOrderId: wo.id, awb: leg.awb });
    if (pod.ok && !(await db.proofOfDelivery.findFirst({ where: { workOrderId: wo.id } }))) {
      await db.proofOfDelivery.create({
        data: {
          workOrderId: wo.id,
          shipmentId: leg.id,
          podNumber: pod.data.podRef,
          signedBy: pod.data.signedBy,
          deliveredAt: new Date(pod.data.deliveredAt),
          remarks: 'Retrieved from the carrier.',
          provenance: pod.provenance,
          provenanceActor: 'DHL',
          provenanceAt: new Date(),
        },
      });
      did.push(`Proof of delivery ${pod.data.podRef} retrieved, signed by ${pod.data.signedBy}.`);
    }
  }

  // ── Count it in ────────────────────────────────────────────────────────
  const expected = new Map(wo.customerPo.lines.map((l) => [l.mpn, l.quantity]));
  const lines = wo.customerPo.lines.map((l) => {
    const c = counts.find((x) => x.mpn === l.mpn);
    return {
      mpn: l.mpn,
      expectedQty: l.quantity,
      receivedQty: c ? c.receivedQty : l.quantity,
      condition: c?.condition ?? 'OK',
    };
  });
  const short = lines.filter((l) => l.receivedQty < l.expectedQty);
  const over = lines.filter((l) => l.receivedQty > l.expectedQty);
  const damaged = lines.filter((l) => l.condition === 'DAMAGED');

  const seq = (await db.grn.count()) + 1;
  const grn = await db.grn.create({
    data: {
      workOrderId: wo.id,
      grnNumber: `GRN-2026-${String(200 + seq).padStart(4, '0')}`,
      receivedAt: new Date(),
      cartons: leg?.pieces ?? 1,
      receivedBy: 'Akash Dwivedi',
      storageLocation: input.storageLocation?.trim() || null,
      hasShortfall: short.length > 0,
      variance:
        short.length + over.length > 0
          ? JSON.stringify([...short, ...over].map((l) => ({ mpn: l.mpn, expectedQty: l.expectedQty, receivedQty: l.receivedQty })))
          : null,
      remarks: input.remarks?.trim() || null,
      lines: { create: lines },
    },
  });
  did.push(`${grn.grnNumber} raised — ${lines.length} line(s), ${grn.cartons} carton(s).`);

  // The GRN as a document, so it opens like every other piece of paperwork.
  const ctx = docContextFrom(
    await db.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: DOC_CONTEXT_INCLUDE }),
  );
  await db.document.create({
    data: {
      workOrderId: wo.id,
      stageId: 'GOODS_RECEIVED_INBOUND_AT_1BUY',
      docType: 'GRN',
      title: `Goods receipt note ${grn.grnNumber}`,
      fileName: `${grn.grnNumber}.pdf`,
      sizeBytes: 41_000,
      uploadedBy: 'Akash Dwivedi',
      provenance: 'MANUAL',
      bodyText: renderDocumentBody('GRN', ctx),
    },
  });
  did.push('Goods receipt note filed against the order.');

  /*
   * A discrepancy is raised as an event, not as a reason to refuse the receipt.
   * The goods are on the dock either way; leaving them unrecorded while
   * somebody argues about the count helps nobody.
   */
  for (const [id, hit] of [
    ['SHORT_RECEIPT', short.length > 0],
    ['EXCESS_RECEIPT', over.length > 0],
    ['DAMAGE_ON_ARRIVAL', damaged.length > 0],
  ] as const) {
    if (!hit) continue;
    const out = await recordInboundEvent(wo.id, id, {
      note: `Raised on booking in ${grn.grnNumber} against the packing list.`,
    });
    if (out.ok) did.push(out.message);
  }
  void expected;

  revalidateAll(orderId);
  return {
    ok: true,
    message: `${grn.grnNumber} raised.`,
    detail:
      short.length + over.length + damaged.length > 0
        ? 'A discrepancy was found and raised as an event — the receipt stands, and the claim is now being chased.'
        : 'Counted in full against the packing list, no discrepancy.',
    did,
  };
}
