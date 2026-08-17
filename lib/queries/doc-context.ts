/**
 * The order, in the shape a document needs it.
 *
 * Built once and shared by the seed and the autonomous agent, because two
 * builders would drift and the first symptom would be a demonstration where the
 * seeded orders and the simulated one disagree about what a commercial invoice
 * contains.
 */

import type { Prisma } from '@/lib/generated/prisma';
import { ORG } from '@/prisma/seed-masters';
import type { DocContext, DocLine } from '@/lib/domain/document-bodies';

/** Everything a renderer can ask for, read in one query. */
export const DOC_CONTEXT_INCLUDE = {
  customerPo: { include: { customer: true, lines: true } },
  supplierPo: { include: { supplier: true, lines: true } },
  customerPi: true,
  supplierPi: true,
  escrowAccount: true,
  shipments: true,
  taxInvoices: { include: { eWayBills: true } },
} as const;

/*
 * Typed from Prisma's own payload helper rather than from a call signature.
 * The generic form above resolved to the bare model and lost every relation,
 * which typechecks right up until the first property access.
 */
type Loaded = Prisma.WorkOrderGetPayload<{ include: typeof DOC_CONTEXT_INCLUDE }>;

export function docContextFrom(wo: Loaded, docDate: Date = new Date()): DocContext {
  /*
   * Priced on the BUY side, because most documents on this order are the import
   * paperwork. The two customer-facing ones — the sales order and the tax
   * invoice — carry sell prices, and their renderers take the sell currency.
   */
  const lines: DocLine[] = wo.customerPo.lines.map((l) => {
    const sl = wo.supplierPo.lines.find((x) => x.mpn === l.mpn);
    return {
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      description: l.description,
      hsnCode: l.hsnCode,
      qty: l.quantity,
      uom: l.uom,
      unitPriceMinor: Math.round((sl?.unitPrice ?? l.unitPrice) * 100),
      lineTotalMinor: sl?.lineTotal ?? l.lineTotal,
    };
  });

  const imp = wo.shipments.find((s) => s.legType === 'IMPORT');
  const inv = wo.taxInvoices[0];

  return {
    alias: wo.alias,
    canonicalName: wo.canonicalName,
    docDate: docDate.toISOString(),
    org: {
      legalName: ORG.legalName,
      address: `${ORG.addressLine1}\n${ORG.city} ${ORG.pincode}\n${ORG.country}`,
      gstin: ORG.gstin,
      iec: 'AABCS4389M',
      country: ORG.country,
    },
    customer: {
      name: wo.customerPo.customer.name,
      address: wo.customerPo.shipToAddress,
      gstin: wo.customerPo.customer.gstin,
      contact: wo.customerPo.contactName,
    },
    supplier: {
      name: wo.supplierPo.supplier.name,
      country: wo.supplierPo.supplier.country ?? '—',
      currency: wo.supplierPo.currency,
    },
    refs: {
      customerPo: wo.customerPo.poNumber,
      supplierPo: wo.supplierPo.poNumber,
      customerPi: wo.customerPi?.piNumber ?? null,
      supplierPi: wo.supplierPi?.piNumber ?? null,
    },
    terms: {
      buyIncoterms: wo.incoterms,
      sellIncoterms: wo.customerPo.incoterms,
      paymentMethod: wo.paymentMethod,
      fxRate: wo.fxRate,
    },
    lines,
    buyCurrency: wo.buyCurrency,
    sellCurrency: wo.sellCurrency,
    buyValueMinor: wo.buyValue,
    sellValueMinor: wo.sellValue,
    escrow: wo.escrowAccount
      ? {
          ref: wo.escrowAccount.escrowRef,
          provider: wo.escrowAccount.provider,
          agreedMinor: wo.escrowAccount.agreedAmount,
          releaseCondition:
            'Goods received at 1BUY and accepted on inbound inspection. No release before both.',
        }
      : null,
    shipment: imp
      ? {
          awb: imp.awb,
          carrier: imp.carrierCode,
          origin: imp.originName,
          destination: imp.destName,
        }
      : null,
    customs: {
      beNumber: `BE-${7600000 + (Number(wo.alias.replace(/\D/g, '')) || 1)}`,
      port: 'INBLR4 — Bengaluru Air Cargo',
      chaLicence: 'CHA/BLR/1147',
    },
    invoice: inv
      ? {
          number: inv.invoiceNumber,
          irn: inv.irn,
          ewayBill: inv.eWayBills[0]?.ewbNumber ?? null,
        }
      : null,
  };
}
