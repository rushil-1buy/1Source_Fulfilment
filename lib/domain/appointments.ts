/**
 * Who we may appoint, and whether this order is ours to appoint them for.
 *
 * THE GATE IS THE INCOTERM, not a permission. On CIF the supplier has already
 * bought the ocean freight; offering inbound a "book a carrier" button there
 * does not give them a useful option, it invites them to pay twice for a leg
 * somebody else already paid for. So the question this module answers first is
 * not "may this desk book" but "is this leg ours at all" — and the Incoterm
 * already knows.
 *
 * Escrow is the mirror image: it is never decided by a delivery term, only by
 * the payment method, and appointing the provider is Finance's alone. The
 * platform holds a network of partners rather than a hard-coded one, so
 * onboarding the next is a registry entry.
 */

import { incotermFor } from './incoterms';
import type { Stakeholder } from './enums';

// ─────────────────────────────────────────────────────────────────────────────
// Logistics partners
// ─────────────────────────────────────────────────────────────────────────────

export interface LogisticsPartner {
  code: string;
  name: string;
  /** What they are actually good for — shown so a booking is a choice, not a default. */
  strengths: string;
  services: string[];
  status: 'ACTIVE' | 'COMING_SOON';
}

/**
 * The carrier network. DHL only for now, by decision rather than by omission.
 *
 * Written as a registry so the second and third carrier are entries here, not
 * a refactor — and so the UI can say what the network IS from data instead of
 * from marketing copy.
 */
export const LOGISTICS_PARTNERS: LogisticsPartner[] = [
  {
    code: 'DHL',
    name: 'DHL Express',
    strengths: 'Door-to-door express with customs-broker integration on the import leg.',
    services: ['Express Worldwide', 'Economy Select', 'Standard'],
    status: 'ACTIVE',
  },
];

export const activeLogisticsPartners = (): LogisticsPartner[] =>
  LOGISTICS_PARTNERS.filter((p) => p.status === 'ACTIVE');

// ─────────────────────────────────────────────────────────────────────────────
// Whose leg is it
// ─────────────────────────────────────────────────────────────────────────────

export type Leg = 'IMPORT' | 'TEST_OUT' | 'TEST_RETURN' | 'OUTBOUND';

export interface LegAppointability {
  /** Ours to book — so a carrier may be appointed. */
  ours: boolean;
  /** Which desk appoints it. */
  desk: Stakeholder;
  /** Why it is or is not ours, in the term's own words. */
  reason: string;
}

/**
 * Whether a leg is 1BUY's to book, decided from the Incoterms.
 *
 * The import leg reads the BUY term: carriage sitting with the BUYER means us.
 * The outbound leg reads the SELL term, where the roles invert — carriage with
 * the SELLER means us, because on that contract we are the seller. Reading the
 * wrong side is how a desk books a leg the counterparty already paid for.
 *
 * The two testing legs are always ours regardless of term: sending parts to a
 * laboratory and back is our own arrangement, outside the sale contract
 * entirely, and no Incoterm has an opinion about it.
 */
export function legAppointability(
  leg: Leg,
  buyIncoterms: string,
  sellIncoterms: string | null,
): LegAppointability {
  if (leg === 'TEST_OUT' || leg === 'TEST_RETURN') {
    return {
      ours: true,
      desk: 'ONE_BUY_INBOUND',
      reason:
        'Sending parts to a laboratory and back is our own arrangement, outside the sale contract — no delivery term governs it.',
    };
  }

  if (leg === 'IMPORT') {
    const def = incotermFor(buyIncoterms);
    if (!def) {
      return {
        ours: false,
        desk: 'ONE_BUY_INBOUND',
        reason: 'No delivery term is recorded on the purchase, so who books the inbound leg is unknown.',
      };
    }
    const ours = def.carriage.party === 'BUYER';
    return {
      ours,
      desk: 'ONE_BUY_INBOUND',
      reason: ours
        ? `Bought on ${def.code}: ${def.carriage.note} The inbound leg is ours to book.`
        : `Bought on ${def.code}: ${def.carriage.note} Booking a carrier here would pay twice for a leg the supplier has already covered.`,
    };
  }

  // OUTBOUND — read the term we SOLD on, where we are the seller.
  const def = incotermFor(sellIncoterms);
  if (!def) {
    return {
      ours: false,
      desk: 'ONE_BUY_OUTBOUND',
      reason: 'No delivery term is recorded on the customer order, so who books the outbound leg is unknown.',
    };
  }
  const ours = def.carriage.party === 'SELLER';
  return {
    ours,
    desk: 'ONE_BUY_OUTBOUND',
    reason: ours
      ? `Sold on ${def.code}: carriage to the customer is ours, so the outbound leg is ours to book.`
      : `Sold on ${def.code}: the customer collects and arranges their own carriage. Booking one would be billing them for something they did not ask for.`,
  };
}

export const LEG_LABEL: Record<Leg, string> = {
  IMPORT: 'Inbound import leg',
  TEST_OUT: 'Out to the testing laboratory',
  TEST_RETURN: 'Back from the testing laboratory',
  OUTBOUND: 'Outbound to the customer',
};

/** The legs a desk may appoint a carrier for. */
export function appointableLegs(desk: Stakeholder): Leg[] {
  if (desk === 'ONE_BUY_INBOUND') return ['IMPORT', 'TEST_OUT', 'TEST_RETURN'];
  if (desk === 'ONE_BUY_OUTBOUND') return ['OUTBOUND'];
  return [];
}
