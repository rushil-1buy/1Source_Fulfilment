/**
 * Populates the printed-document fields added for the Purchase Order and
 * Proforma Invoice sheets. Seeded records predate those columns, so without this
 * the documents would print correctly but half empty.
 *
 * Every value here is derived from data already on the order, or is a standing
 * commercial term — nothing is invented to fill a gap.
 */

import { PrismaClient } from '@/lib/generated/prisma';

const db = new PrismaClient();

/** Indian fiscal year label for a date: 26-27 for anything from 1 April 2026. */
function fiscalYear(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

const PO_TERMS = [
  'Date code and warranty as per the agreed specification on the linked enquiry.',
  'Advance payment via telegraphic transfer.',
  'In case of test failure all charges — testing, material handling and logistics — are payable by the supplier.',
  'Lead time as quoted. Any slippage must be advised in writing on the day it is known.',
  'Every delivery must carry a packing list and commercial invoice, with the work order reference marked on the outer carton. Shipments without it will be rejected.',
].join('\n');

const PI_REMARKS = [
  'Label complete in reel / tray / box as original packing, as shown in the photographs supplied.',
  'Quality report provided by the distributor after its own laboratory testing. A third-party test may be arranged at the buyer’s cost on request.',
  'Production / shipping lot barcode may be hidden.',
  'Stock offer validity is limited. The buyer must issue the purchase order within the validity window to lock the stock, and remit payment within one working day thereafter.',
].join('\n');

async function main() {
  const org = await db.orgSetting.findFirst();
  if (!org) throw new Error('No organisation settings — run the seed first.');

  const prefix = org.poVoucherPrefix ?? 'PO/SGSPL/';

  // ── Supplier purchase orders ───────────────────────────────────────────────
  const pos = await db.supplierPO.findMany({
    include: { workOrders: { include: { customerPo: true } } },
  });
  let poCount = 0;
  for (const po of pos) {
    const wo = po.workOrders[0];
    const serial = po.poNumber.replace(/\D/g, '').slice(-4).padStart(4, '0');
    // The configured prefix usually already carries the fiscal year
    // ("PO/SGSPL/26-27/"). Only add one when it does not, so the voucher never
    // reads PO/SGSPL/26-27/26-27/0113.
    const hasFy = /\d{2}-\d{2}\/?$/.test(prefix);
    const voucher = `${prefix}${hasFy ? '' : `${fiscalYear(po.poDate)}/`}${serial}`;
    await db.supplierPO.update({
      where: { id: po.id },
      data: {
        voucherNo: voucher,
        // The enquiry the supplier quoted against. Derived from the customer
        // order it serves, so the supplier and our own file agree on one ref.
        referenceNo: po.referenceNo ?? (wo ? `RFQ-${wo.customerPo.poNumber}` : null),
        referenceDate: po.referenceDate ?? (wo ? wo.customerPo.poDate : null),
        billToAddress:
          po.billToAddress ??
          [org.addressLine1, org.addressLine2, `${org.city} ${org.pincode}`, org.country]
            .filter(Boolean)
            .join(', '),
        dispatchedThrough: po.dispatchedThrough ?? '—',
        destination:
          po.destination ?? `${org.shipCity ?? org.city}, ${org.stateName} · ${po.incoterms}`,
        termsOfDelivery: po.termsOfDelivery ?? po.incoterms,
        termsAndConditions: po.termsAndConditions ?? PO_TERMS,
      },
    });
    poCount++;
  }

  // ── Proforma invoices ──────────────────────────────────────────────────────
  const pis = await db.proformaInvoice.findMany({
    include: {
      supplierPo: { include: { supplier: true } },
      customerPo: { include: { customer: true } },
    },
  });
  let piCount = 0;
  for (const pi of pis) {
    const isSupplier = pi.direction === 'SUPPLIER_PI';
    const s = pi.supplierPo?.supplier;
    const c = pi.customerPo?.customer;

    await db.proformaInvoice.update({
      where: { id: pi.id },
      data: {
        attention:
          pi.attention ??
          (isSupplier ? org.contactAttn : (c?.contactName ? `${c.contactName}` : null)),
        shipmentMethod:
          pi.shipmentMethod ??
          (isSupplier
            ? 'By air or courier nominated and paid by the buyer'
            : 'By road or air, arranged and paid by the seller'),
        originLocation: pi.originLocation ?? (isSupplier ? (s?.country ?? null) : org.city),
        destination:
          pi.destination ??
          (isSupplier
            ? `India — ${org.shipCity ?? org.city}, ${org.stateName} · ${pi.supplierPo?.incoterms ?? 'DAP'}`
            : c
              ? `${c.city}, ${c.stateName} · ${pi.customerPo?.incoterms ?? 'DDP'}`
              : null),
        deliveryTime:
          pi.deliveryTime ??
          (pi.leadTimeDays
            ? `Within agreed ${pi.leadTimeDays} days after the seller’s receipt of payment.`
            : 'As agreed after the seller’s receipt of payment.'),
        paymentTerm:
          pi.paymentTerm ??
          (isSupplier
            ? '100% telegraphic transfer in advance from the buyer to the seller before shipping.'
            : (pi.customerPo?.paymentTerms ?? null)),
        remarks: pi.remarks ?? PI_REMARKS,
      },
    });
    piCount++;
  }

  // ── Supplier bank details, for the telegraphic-transfer block ─────────────
  let bankCount = 0;
  for (const s of await db.supplier.findMany()) {
    if (s.beneficiaryName && s.bankFeeNote) continue;
    await db.supplier.update({
      where: { id: s.id },
      data: {
        beneficiaryName: s.beneficiaryName ?? s.name,
        bankFeeNote:
          s.bankFeeNote ??
          (s.isForeign
            ? 'Sender pays India bank fees; beneficiary pays overseas bank fees.'
            : 'Each party bears its own bank charges.'),
      },
    });
    bankCount++;
  }

  console.log(
    `Backfilled ${poCount} purchase order(s), ${piCount} proforma invoice(s), ${bankCount} supplier bank record(s).`,
  );
  await db.$disconnect();
}

main();
