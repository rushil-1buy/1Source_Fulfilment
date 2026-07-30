/**
 * Three-way reconciliation of a supplier's proforma against our purchase order
 * (§3.3): price, quantity and lead time.
 *
 * Pure and shared — the form uses it for a live preview while typing, and the
 * server action uses the same function when saving, so the two can never drift.
 */

export interface ReconcilePoLine {
  id: string;
  mpn: string;
  quantity: number;
  unitPrice: number;
  leadTimeDays: number | null;
}

export interface ReconcilePiLine {
  supplierPoLineId: string;
  quantity: number;
  unitPrice: number;
  leadTimeDays?: number | null;
}

export type VarianceField = 'unitPrice' | 'quantity' | 'leadTimeDays';
export type VarianceSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Variance {
  mpn: string;
  field: VarianceField;
  ordered: number;
  quoted: number;
  deltaPct: number;
  severity: VarianceSeverity;
  note: string;
}

export const VARIANCE_FIELD_LABEL: Record<VarianceField, string> = {
  unitPrice: 'Unit price',
  quantity: 'Quantity',
  leadTimeDays: 'Lead time',
};

/** A price rise above this share is treated as needing approval, not just a note. */
const PRICE_RISE_CRITICAL_PCT = 5;

export function reconcile(poLines: ReconcilePoLine[], piLines: ReconcilePiLine[]): Variance[] {
  const out: Variance[] = [];

  for (const pi of piLines) {
    const po = poLines.find((x) => x.id === pi.supplierPoLineId);
    if (!po) continue;

    // ── Price ──
    if (Math.abs(po.unitPrice - pi.unitPrice) > 1e-9) {
      const deltaPct = po.unitPrice > 0 ? ((pi.unitPrice - po.unitPrice) / po.unitPrice) * 100 : 100;
      out.push({
        mpn: po.mpn,
        field: 'unitPrice',
        ordered: po.unitPrice,
        quoted: pi.unitPrice,
        deltaPct,
        severity:
          deltaPct > PRICE_RISE_CRITICAL_PCT ? 'CRITICAL' : deltaPct > 0 ? 'WARNING' : 'INFO',
        note:
          deltaPct > 0
            ? `Quoted ${deltaPct.toFixed(1)}% above our PO price. This comes straight out of margin and needs approval before we accept.`
            : `Quoted ${Math.abs(deltaPct).toFixed(1)}% below our PO price — in our favour.`,
      });
    }

    // ── Quantity ──
    if (po.quantity !== pi.quantity) {
      const deltaPct = po.quantity > 0 ? ((pi.quantity - po.quantity) / po.quantity) * 100 : 0;
      out.push({
        mpn: po.mpn,
        field: 'quantity',
        ordered: po.quantity,
        quoted: pi.quantity,
        deltaPct,
        severity: pi.quantity < po.quantity ? 'CRITICAL' : 'WARNING',
        note:
          pi.quantity < po.quantity
            ? `Supplier can only supply ${pi.quantity.toLocaleString('en-IN')} of the ${po.quantity.toLocaleString('en-IN')} we ordered, so the customer's order will fall short.`
            : `Supplier quoted more than we ordered — check before accepting the extra.`,
      });
    }

    // ── Lead time ──
    const orderedLead = po.leadTimeDays;
    const quotedLead = pi.leadTimeDays ?? null;
    if (orderedLead != null && quotedLead != null && orderedLead !== quotedLead) {
      out.push({
        mpn: po.mpn,
        field: 'leadTimeDays',
        ordered: orderedLead,
        quoted: quotedLead,
        deltaPct: orderedLead > 0 ? ((quotedLead - orderedLead) / orderedLead) * 100 : 0,
        severity: quotedLead > orderedLead ? 'WARNING' : 'INFO',
        note:
          quotedLead > orderedLead
            ? `Lead time slipped from ${orderedLead} to ${quotedLead} days. Check this still meets the date the customer asked for.`
            : `Lead time improved to ${quotedLead} days.`,
      });
    }
  }

  return out;
}

export function worstSeverity(variances: Variance[]): VarianceSeverity | null {
  if (variances.some((v) => v.severity === 'CRITICAL')) return 'CRITICAL';
  if (variances.some((v) => v.severity === 'WARNING')) return 'WARNING';
  if (variances.length > 0) return 'INFO';
  return null;
}
