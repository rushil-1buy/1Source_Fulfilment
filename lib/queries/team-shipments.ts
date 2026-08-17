/**
 * The carrier legs a desk owns, judged late or not.
 *
 * A plain module rather than inline in the page, for two reasons. Structurally,
 * leg scoping is policy and belongs beside the other domain rules, not in a
 * route file. Practically, "is it past the carrier's estimate" needs the
 * current time, and reading the clock inside any component — server or client —
 * is an impure render the compiler is right to reject.
 */

import type { TeamShipment } from '@/components/logistics/TeamLogisticsPanel';
import type { Stakeholder } from '@/lib/domain/enums';

/**
 * Which legs belong to which desk.
 *
 * Inbound owns everything up to receipt at 1BUY, including both testing legs —
 * those are consignments they book and chase. Outbound owns the leg to the
 * customer. Every other desk owns none, and gets no logistics tab at all.
 */
const LEGS_FOR: Partial<Record<Stakeholder, string[]>> = {
  ONE_BUY_INBOUND: ['IMPORT', 'TEST_OUT', 'TEST_RETURN'],
  ONE_BUY_OUTBOUND: ['OUTBOUND'],
};

export const deskMovesGoods = (team: Stakeholder): boolean => LEGS_FOR[team] !== undefined;

interface RawShipment {
  id: string;
  legType: string;
  carrierCode: string;
  serviceName: string | null;
  awb: string | null;
  originName: string;
  originCountry: string;
  destName: string;
  destCountry: string;
  pieces: number;
  grossWeightKg: number | null;
  status: string;
  dispatchedAt: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  events: { id: string; occurredAt: string; code: string; description: string; location: string | null }[];
}

export function scopeShipmentsForTeam(
  shipments: RawShipment[],
  team: Stakeholder,
  now: number = Date.now(),
): TeamShipment[] {
  const legs = LEGS_FOR[team];
  if (!legs) return [];
  return shipments
    .filter((sh) => legs.includes(sh.legType))
    .map((sh) => ({
      ...sh,
      // Late against the CARRIER's own promise, not our SLA — a different fact,
      // and the one a customer quotes back at you.
      overdue:
        !sh.deliveredAt &&
        sh.estimatedDelivery !== null &&
        new Date(sh.estimatedDelivery).getTime() < now,
      events: sh.events.map((e) => ({ ...e })),
    }));
}
