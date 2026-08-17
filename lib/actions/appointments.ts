'use server';

/**
 * Appointing the parties that actually move goods and hold money.
 *
 * Two appointments, one shape: pick from a registry of partners, write the
 * choice against the order, and record who chose. Both refuse when the order
 * says the appointment is not ours to make — the carrier because the Incoterm
 * puts the leg on somebody else, escrow because the order is not on escrow
 * terms at all.
 *
 * NEITHER IS A BOOKING WITH A REAL PROVIDER. No carrier API is called and no
 * escrow account is opened with HKIN in this build; what is real is the record,
 * the gate, the audit entry and the thread entry, so the rest of the flow can
 * work from a named partner instead of a placeholder. Swapping in a live
 * integration changes none of those contracts.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { slugForTeam, STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { legAppointability, LEG_LABEL, LOGISTICS_PARTNERS, type Leg } from '@/lib/domain/appointments';
import { ESCROW_PARTNERS } from '@/lib/domain/portal-agents';

export interface AppointResult {
  ok: boolean;
  message: string;
  detail?: string;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

function revalidateFor(orderId: string, team: Stakeholder) {
  safeRevalidate(`/orders/${orderId}`);
  const slug = slugForTeam(team);
  if (slug) {
    safeRevalidate(`/teams/${slug}`);
    safeRevalidate(`/teams/${slug}/orders/${orderId}`);
  }
}

/**
 * Books a leg with a carrier.
 *
 * Creates the shipment where none exists and re-assigns it where one does —
 * re-appointing before dispatch is legitimate (a quote came back better), but
 * once the consignment has left, changing the carrier on the record would make
 * the tracking events belong to a carrier that never carried it.
 */
export async function appointCarrier(
  orderId: string,
  leg: Leg,
  partnerCode: string,
  service: string,
): Promise<AppointResult> {
  const partner = LOGISTICS_PARTNERS.find((p) => p.code === partnerCode && p.status === 'ACTIVE');
  if (!partner) return { ok: false, message: 'That carrier is not in the network.' };

  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: {
      customerPo: { include: { customer: true } },
      supplierPo: { include: { supplier: true } },
      shipments: true,
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  // The Incoterm gate, re-checked server-side. The UI hides the control where
  // the leg is not ours; this is what makes that a rule rather than a hint.
  const gate = legAppointability(leg, wo.incoterms, wo.customerPo.incoterms);
  if (!gate.ours) {
    return {
      ok: false,
      message: `The ${LEG_LABEL[leg].toLowerCase()} is not ours to book.`,
      detail: gate.reason,
    };
  }

  const existing = wo.shipments.find((s) => s.legType === leg);
  if (existing?.dispatchedAt) {
    return {
      ok: false,
      message: 'This consignment has already been dispatched.',
      detail: `It left on ${existing.dispatchedAt.toISOString().slice(0, 10)} with ${existing.carrierCode}. Changing the carrier now would attach its tracking history to a carrier that never carried it.`,
    };
  }

  const outbound = leg === 'OUTBOUND';
  const route = outbound
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
      : {
          originName: leg === 'TEST_OUT' ? wo.supplierPo.supplier.name : 'Testing Laboratory, Bengaluru',
          originCountry: leg === 'TEST_OUT' ? (wo.supplierPo.supplier.country ?? '—') : 'India',
          destName: leg === 'TEST_OUT' ? 'Testing Laboratory, Bengaluru' : '1BUY Warehouse, Bengaluru',
          destCountry: 'India',
        };

  if (existing) {
    await db.shipment.update({
      where: { id: existing.id },
      data: { carrierCode: partner.code, serviceName: service, status: 'BOOKED' },
    });
  } else {
    await db.shipment.create({
      data: {
        workOrderId: wo.id,
        legType: leg,
        carrierCode: partner.code,
        serviceName: service,
        status: 'BOOKED',
        currency: 'INR',
        provenance: 'MANUAL',
        ...route,
      },
    });
  }

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'Shipment',
      entityId: existing?.id ?? wo.id,
      action: existing ? 'UPDATE' : 'CREATE',
      field: `CARRIER_${leg}`,
      beforeValue: existing ? existing.carrierCode : null,
      afterValue: `${partner.name} — ${service}`,
      actorId: 'u-priya',
      actorLabel: STAKEHOLDER_META[gate.desk].label,
    },
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `${LEG_LABEL[leg]} booked with ${partner.name}`,
      body: `${STAKEHOLDER_META[gate.desk].label} appointed ${partner.name} (${service}) for the ${LEG_LABEL[leg].toLowerCase()}. ${gate.reason}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Truck',
    },
  });

  revalidateFor(orderId, gate.desk);
  return {
    ok: true,
    message: `${LEG_LABEL[leg]} booked with ${partner.name}.`,
    detail: `${service}. Tracking appears against this leg as the carrier reports it.`,
  };
}

/**
 * Appoints the escrow provider and opens the account.
 *
 * Finance's alone, and only on an escrow order. The agreed amount comes from
 * the order's own basis rather than being typed: an escrow held for a figure
 * nobody can trace back to the order is the first thing a dispute attacks.
 */
export async function appointEscrowProvider(
  orderId: string,
  partnerCode: string,
): Promise<AppointResult> {
  const partner = ESCROW_PARTNERS.find((p) => p.code === partnerCode && p.status === 'ACTIVE');
  if (!partner) return { ok: false, message: 'That escrow provider is not in the network.' };

  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { escrowAccount: true },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  if (wo.paymentMethod !== 'ESCROW') {
    return {
      ok: false,
      message: 'This order is not on escrow terms.',
      detail: `It settles by ${wo.paymentMethod.toLowerCase()}. Opening an escrow account would hold money the contract does not ask anyone to hold.`,
    };
  }

  if (wo.escrowAccount && wo.escrowAccount.fundedAmount > 0) {
    return {
      ok: false,
      message: 'This escrow account is already funded.',
      detail: `Held with ${wo.escrowAccount.provider}. Changing provider after funding would mean moving money between providers, which is a transfer, not an appointment.`,
    };
  }

  /*
   * The held amount follows the agreed basis rather than being typed in.
   * BUY_VALUE protects what we owe the supplier; SELL_VALUE covers the whole
   * customer exposure. Defaulting to the buy value is the conservative reading
   * — it is the obligation the escrow actually secures.
   */
  const agreed =
    wo.escrowBasis === 'SELL_VALUE'
      ? wo.sellValue
      : wo.escrowBasis === 'CUSTOM'
        ? (wo.escrowAgreedAmount ?? wo.buyValue)
        : wo.buyValue;

  const ref = `${partner.code}-${wo.alias.replace(/[^A-Z0-9]/gi, '').slice(-6)}`;

  if (wo.escrowAccount) {
    await db.escrowAccount.update({
      where: { id: wo.escrowAccount.id },
      data: { provider: partner.code, agreedAmount: agreed },
    });
  } else {
    await db.escrowAccount.create({
      data: {
        workOrderId: wo.id,
        escrowRef: ref,
        provider: partner.code,
        currency: 'INR',
        agreedAmount: agreed,
        status: 'OPENED',
      },
    });
  }

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'EscrowAccount',
      entityId: wo.escrowAccount?.id ?? wo.id,
      action: wo.escrowAccount ? 'UPDATE' : 'CREATE',
      field: 'ESCROW_PROVIDER',
      beforeValue: wo.escrowAccount?.provider ?? null,
      afterValue: `${partner.name} — ${ref}`,
      actorId: 'u-priya',
      actorLabel: STAKEHOLDER_META.ONE_BUY_FINANCE.label,
    },
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Escrow appointed — ${partner.name}`,
      body: `1BUY Finance appointed ${partner.name} (${partner.region}) and opened account ${ref}. The provider confirms the hold to the supplier; funds are released only after the goods are received at 1BUY.`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Landmark',
    },
  });

  revalidateFor(orderId, 'ONE_BUY_FINANCE');
  return {
    ok: true,
    message: `${partner.name} appointed.`,
    detail: `Account ${ref} opened against the order's agreed basis. Funding is the next step, and it stays Finance's.`,
  };
}
