/**
 * The shape of a simulated order, kept apart from the actions that build it.
 *
 * A `'use server'` module may export nothing but async functions — every
 * export becomes a callable endpoint, so a constant sitting beside them is a
 * build error rather than a style question. These live here so both the client
 * form and the server action can share them.
 */

/** Simulated orders all carry this prefix, so a reset can find them. */
export const SIM_PREFIX = 'SIM-';

export interface SimLine {
  mpn: string;
  qty: number;
  /** Testing is per line — an order may send some parts to a lab and not others. */
  testing: boolean;
}

export interface SimConfig {
  customerId: string;
  supplierId: string;
  /** The term we BUY on — governs the inbound leg and who clears import. */
  buyIncoterms: string;
  /** The term we SELL on — governs the outbound leg. */
  sellIncoterms: string;
  paymentMethod: 'ESCROW' | 'ADVANCE' | 'CREDIT';
  lines: SimLine[];
}

export interface SimResult {
  ok: boolean;
  message: string;
  detail?: string;
  orderId?: string;
  alias?: string;
}
