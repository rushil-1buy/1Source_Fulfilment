'use server';

/**
 * What happens in the world when a step completes.
 *
 * Advancing the ladder is not the same thing as the trade progressing. An order
 * that reaches "Escrow funded" with no escrow account, or "Delivered" with no
 * shipment and no proof of delivery, has moved a pointer and nothing else — and
 * every tab in the order would be empty behind it. The run is only worth
 * watching if the Escrow tab fills, the Shipments tab fills, tracking events
 * accumulate and a proof of delivery exists at the end.
 *
 * So each stage that changes something outside the ladder gets a handler here,
 * keyed by the stage being COMPLETED. Each is idempotent — re-running a step
 * must not fund an escrow twice or book a second consignment — and each returns
 * a plain sentence for the run log, so what the agent claims to have done and
 * what the database now holds are the same statement.
 */

import { db } from '@/lib/db';
import { legAppointability, type Leg } from '@/lib/domain/appointments';
import { ESCROW_PARTNERS } from '@/lib/domain/portal-agents';

type Order = {
  id: string;
  alias: string;
  incoterms: string;
  buyValue: number;
  sellValue: number;
  paymentMethod: string;
  escrowBasis: string | null;
  escrowAgreedAmount: number | null;
  customerPo: { incoterms: string | null; customer: { name: string; city: string | null } };
  supplierPo: { supplier: { name: string; country: string | null } };
};

/** AWB digits per leg — distinct by construction, not by string length. */
const LEG_DIGIT: Record<Leg, string> = {
  IMPORT: '1',
  TEST_OUT: '2',
  TEST_RETURN: '3',
  OUTBOUND: '4',
};

async function ensureShipment(
  wo: Order,
  leg: Leg,
  patch: Record<string, unknown>,
): Promise<{ id: string; created: boolean; carrier: string }> {
  const existing = await db.shipment.findFirst({ where: { workOrderId: wo.id, legType: leg } });
  if (existing) {
    await db.shipment.update({ where: { id: existing.id }, data: patch });
    return { id: existing.id, created: false, carrier: existing.carrierCode };
  }

  const gate = legAppointability(leg, wo.incoterms, wo.customerPo.incoterms);
  const route =
    leg === 'OUTBOUND'
      ? {
          originName: '1BUY Warehouse, Bengaluru',
          originCountry: 'India',
          destName: wo.customerPo.customer.name,
          destCountry: 'India',
        }
      : leg === 'IMPORT'
        ? {
            originName: wo.supplierPo.supplier.name,
            originCountry: wo.supplierPo.supplier.country ?? '—',
            destName: '1BUY Warehouse, Bengaluru',
            destCountry: 'India',
          }
        : leg === 'TEST_OUT'
          ? {
              originName: wo.supplierPo.supplier.name,
              originCountry: wo.supplierPo.supplier.country ?? '—',
              destName: 'Testing Laboratory, Bengaluru',
              destCountry: 'India',
            }
          : {
              originName: 'Testing Laboratory, Bengaluru',
              originCountry: 'India',
              destName: '1BUY Warehouse, Bengaluru',
              destCountry: 'India',
            };

  const s = await db.shipment.create({
    data: {
      workOrderId: wo.id,
      legType: leg,
      // Booked with the carrier where the leg is ours; carried on the
      // counterparty's own nomination where it is not. Recording DHL on a leg
      // the supplier arranged would be inventing a booking we never made.
      carrierCode: gate.ours ? 'DHL' : 'SUPPLIER-NOMINATED',
      serviceName: gate.ours ? 'Express Worldwide' : null,
      awb: `4${LEG_DIGIT[leg]}${wo.alias.replace(/\D/g, '').padStart(6, '0').slice(-6)}${LEG_DIGIT[leg]}`,
      status: 'BOOKED',
      currency: 'INR',
      declaredValue: leg === 'OUTBOUND' ? wo.sellValue : wo.buyValue,
      incoterms: leg === 'OUTBOUND' ? (wo.customerPo.incoterms ?? null) : wo.incoterms,
      provenance: 'SYSTEM',
      provenanceActor: 'Autonomous agent',
      provenanceAt: new Date(),
      ...route,
      ...patch,
    },
  });
  return { id: s.id, created: true, carrier: s.carrierCode };
}

async function addTracking(shipmentId: string, code: string, description: string, location: string) {
  const already = await db.trackingEvent.findFirst({ where: { shipmentId, code } });
  if (already) return;
  await db.trackingEvent.create({
    data: {
      shipmentId,
      occurredAt: new Date(),
      code,
      description,
      location,
      provenance: 'SYSTEM',
    },
  });
}

/**
 * Runs the world-effects for a completed stage.
 *
 * Returns one sentence per thing that actually changed. An empty array is the
 * honest answer for a step that moves only paperwork, and most steps are that.
 */
export async function applyStageEffects(orderId: string, stageId: string): Promise<string[]> {
  const wo = (await db.workOrder.findUnique({
    where: { id: orderId },
    include: {
      escrowAccount: true,
      customerPo: { include: { customer: true } },
      supplierPo: { include: { supplier: true } },
    },
  })) as (Order & { escrowAccount: {
        id: string;
        escrowRef: string;
        provider: string;
        agreedAmount: number;
        fundedAmount: number;
        releasedAmount: number;
      } | null }) | null;
  if (!wo) return [];

  const done: string[] = [];
  const now = new Date();

  switch (stageId) {
    // ── Escrow ───────────────────────────────────────────────────────────────
    case 'ESCROW_ACCOUNT_OPENED': {
      const partner = ESCROW_PARTNERS.find((p) => p.status === 'ACTIVE');
      if (!partner) break;

      /*
       * The C1 gate opens the account itself, with provider 'TBD'.
       *
       * So arriving here with an account already present is the NORMAL case,
       * not the skip case — and an early return left every simulated order
       * showing "TBD — provider not yet finalised" through to settlement, which
       * is not a state a funded escrow is ever allowed to be in. Appointing the
       * partner onto the existing account is the actual work of this step.
       */
      if (wo.escrowAccount) {
        if (wo.escrowAccount.provider && wo.escrowAccount.provider !== 'TBD') break;
        await db.escrowAccount.update({
          where: { id: wo.escrowAccount.id },
          data: { provider: partner.code },
        });
        done.push(`Appointed ${partner.name} (${partner.region}) as the escrow provider.`);
        break;
      }
      /*
       * The held amount follows the order's agreed basis rather than a typed
       * figure — an escrow held for a number nobody can trace back to the order
       * is the first thing a dispute attacks.
       */
      const agreed =
        wo.escrowBasis === 'SELL_VALUE'
          ? wo.sellValue
          : wo.escrowBasis === 'CUSTOM'
            ? (wo.escrowAgreedAmount ?? wo.buyValue)
            : wo.buyValue;
      const ref = `${partner.code}-${wo.alias.replace(/[^A-Z0-9]/gi, '').slice(-6)}`;
      await db.escrowAccount.create({
        data: {
          workOrderId: wo.id,
          escrowRef: ref,
          provider: partner.code,
          currency: 'INR',
          agreedAmount: agreed,
          status: 'OPENED',
          provenance: 'SYSTEM',
          provenanceActor: 'Autonomous agent',
          provenanceAt: now,
        },
      });
      done.push(`Appointed ${partner.name} and opened escrow account ${ref}.`);
      break;
    }

    case 'ESCROW_FUNDED': {
      const acc = wo.escrowAccount;
      if (!acc || acc.fundedAmount > 0) break;
      await db.escrowAccount.update({
        where: { id: acc.id },
        data: { fundedAmount: acc.agreedAmount, status: 'FUNDED' },
      });
      await db.escrowTransaction.create({
        data: {
          escrowId: acc.id,
          type: 'FUND',
          amount: acc.agreedAmount,
          currency: 'INR',
          reference: `${acc.escrowRef}-FUND`,
          status: 'SETTLED',
          valueDate: now,
          reason:
            'Funded in full. The provider confirms the hold to the supplier; the money itself moves only once the goods are received at 1BUY.',
          provenance: 'SYSTEM',
          provenanceActor: 'Autonomous agent',
        },
      });
      done.push('Funded the escrow in full — the provider can now confirm the hold to the supplier.');
      break;
    }

    case 'ESCROW_FINAL_RELEASE_AUTHORISED': {
      const acc = wo.escrowAccount;
      if (!acc || acc.releasedAmount >= acc.fundedAmount || acc.fundedAmount === 0) break;
      const amount = acc.fundedAmount - acc.releasedAmount;
      await db.escrowTransaction.create({
        data: {
          escrowId: acc.id,
          type: 'FINAL_RELEASE',
          milestone: 'FINAL_SETTLEMENT',
          amount,
          currency: 'INR',
          beneficiary: wo.supplierPo.supplier.name,
          reference: `${acc.escrowRef}-REL`,
          status: 'INSTRUCTED',
          valueDate: now,
          reason: 'Goods received at 1BUY and accepted on inspection — the condition for release is met.',
          provenance: 'SYSTEM',
          provenanceActor: 'Autonomous agent',
        },
      });
      done.push('Instructed the final release against goods received and accepted.');
      break;
    }

    case 'SUPPLIER_PAID_IN_FULL': {
      const acc = wo.escrowAccount;
      if (!acc || acc.releasedAmount >= acc.fundedAmount) break;
      await db.escrowAccount.update({
        where: { id: acc.id },
        data: { releasedAmount: acc.fundedAmount, status: 'SETTLED', settledAt: now },
      });
      await db.escrowTransaction.updateMany({
        where: { escrowId: acc.id, type: 'FINAL_RELEASE', status: 'INSTRUCTED' },
        data: { status: 'SETTLED' },
      });
      done.push(`Escrow settled — ${wo.supplierPo.supplier.name} paid in full.`);
      break;
    }

    // ── Testing legs ─────────────────────────────────────────────────────────
    case 'TEST_DISPATCH_BOOKED': {
      const s = await ensureShipment(wo, 'TEST_OUT', { status: 'IN_TRANSIT', dispatchedAt: now });
      await addTracking(s.id, 'PU', 'Collected from supplier for laboratory testing', 'Origin');
      if (s.created) done.push('Booked the sample consignment to the testing laboratory.');
      break;
    }
    case 'PARTS_RECEIVED_AT_WHL': {
      const s = await ensureShipment(wo, 'TEST_OUT', { status: 'DELIVERED', deliveredAt: now });
      await addTracking(s.id, 'OK', 'Delivered to the testing laboratory', 'Bengaluru');
      done.push('Sample consignment delivered to the laboratory and booked in.');
      break;
    }
    case 'PARTS_RETURNED_TO_SUPPLIER': {
      const s = await ensureShipment(wo, 'TEST_RETURN', {
        status: 'DELIVERED',
        dispatchedAt: now,
        deliveredAt: now,
      });
      await addTracking(s.id, 'OK', 'Tested samples returned', 'Bengaluru');
      if (s.created) done.push('Returned the tested samples.');
      break;
    }

    // ── The import leg ───────────────────────────────────────────────────────
    case 'FULL_SHIPMENT_DISPATCHED_BY_SUPPLIER': {
      const s = await ensureShipment(wo, 'IMPORT', {
        status: 'IN_TRANSIT',
        dispatchedAt: now,
        estimatedDelivery: new Date(now.getTime() + 6 * 86_400_000),
      });
      await addTracking(s.id, 'PU', 'Consignment collected from the supplier', wo.supplierPo.supplier.country ?? 'Origin');
      done.push(`Import consignment dispatched with ${s.carrier}.`);
      break;
    }
    case 'IN_TRANSIT_INTERNATIONAL': {
      const s = await ensureShipment(wo, 'IMPORT', { status: 'IN_TRANSIT' });
      await addTracking(s.id, 'DF', 'Departed origin facility', wo.supplierPo.supplier.country ?? 'Origin');
      await addTracking(s.id, 'AR', 'Arrived at destination airport', 'Bengaluru');
      done.push('Tracking updated — departed origin, arrived at the destination airport.');
      break;
    }
    case 'CUSTOMS_ENTRY_FILED_ICEGATE': {
      const s = await ensureShipment(wo, 'IMPORT', { status: 'CUSTOMS' });
      await addTracking(s.id, 'CC', 'Customs entry filed — awaiting assessment', 'Bengaluru');
      done.push('Consignment held at customs pending assessment.');
      break;
    }
    case 'CUSTOMS_CLEARED': {
      const s = await ensureShipment(wo, 'IMPORT', { status: 'OUT_FOR_DELIVERY' });
      await addTracking(s.id, 'CR', 'Customs cleared — released for delivery', 'Bengaluru');
      done.push('Customs cleared and released for delivery.');
      break;
    }
    case 'GOODS_RECEIVED_INBOUND_AT_1BUY': {
      const s = await ensureShipment(wo, 'IMPORT', { status: 'DELIVERED', deliveredAt: now });
      await addTracking(s.id, 'OK', 'Delivered to the 1BUY warehouse', 'Bengaluru');
      done.push('Import consignment received at the 1BUY warehouse.');
      break;
    }

    // ── Outbound ─────────────────────────────────────────────────────────────
    case 'OUTBOUND_BOOKED': {
      const s = await ensureShipment(wo, 'OUTBOUND', { status: 'BOOKED' });
      if (s.created) done.push(`Outbound consignment booked to ${wo.customerPo.customer.name}.`);
      break;
    }
    case 'OUT_FOR_DELIVERY': {
      const s = await ensureShipment(wo, 'OUTBOUND', { status: 'OUT_FOR_DELIVERY', dispatchedAt: now });
      await addTracking(s.id, 'OD', 'Out for delivery', wo.customerPo.customer.city ?? 'Destination');
      done.push('Outbound consignment out for delivery.');
      break;
    }
    case 'DELIVERED': {
      const s = await ensureShipment(wo, 'OUTBOUND', { status: 'DELIVERED', deliveredAt: now });
      await addTracking(s.id, 'OK', 'Delivered and signed for', wo.customerPo.customer.city ?? 'Destination');
      const pod = await db.proofOfDelivery.findFirst({ where: { workOrderId: wo.id } });
      if (!pod) {
        await db.proofOfDelivery.create({
          data: {
            workOrderId: wo.id,
            shipmentId: s.id,
            podNumber: `POD-${wo.alias}`,
            signedBy: `${wo.customerPo.customer.name} — goods inward`,
            deliveredAt: now,
            remarks: 'Received in full and in good condition.',
            provenance: 'SYSTEM',
            provenanceActor: 'Autonomous agent',
          },
        });
        done.push('Proof of delivery captured against the outbound consignment.');
      }
      break;
    }
  }

  return done;
}
