import { db } from '@/lib/db';
import type { RecordRow } from '@/components/ui/RecordTable';
import { SHIPMENT_LEG_META, type ShipmentLeg } from '@/lib/domain/enums';
import { getStage } from '@/lib/domain/stages';

/**
 * Cross-order list queries for the operational modules. Each returns rows shaped
 * for RecordTable, with `href` pointing back at the owning order so every list
 * is a way into the work rather than a dead end.
 */

const orderHref = (alias: string, tab?: string) =>
  `/orders/${alias}${tab ? `?tab=${tab}` : ''}`;

export async function listApprovedVendors(): Promise<RecordRow[]> {
  const rows = await db.supplier.findMany({
    include: { avl: true, purchaseOrders: { select: { id: true, totalValue: true } } },
    orderBy: { name: 'asc' },
  });
  const now = new Date();
  return rows.map((s) => {
    const expired = s.avl ? s.avl.approvedUpto < now : false;
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      country: `${s.city}, ${s.country}`,
      status: expired ? 'EXPIRED' : (s.avl?.status ?? 'PENDING'),
      approvedUpto: s.avl?.approvedUpto.toISOString() ?? null,
      categories: s.avl ? (JSON.parse(s.avl.categories) as string[]).join(', ') : null,
      certifications: s.avl ? (JSON.parse(s.avl.certifications) as string[]).join(', ') : null,
      qualityRating: s.avl?.qualityRating ?? null,
      deliveryRating: s.avl?.deliveryRating ?? null,
      riskScore: s.avl?.riskScore ?? null,
      currency: s.currency,
      incoterms: s.incoterms,
      orderCount: s.purchaseOrders.length,
      notes: s.avl?.notes ?? null,
    };
  });
}

export async function listEscrowAccounts(): Promise<RecordRow[]> {
  const rows = await db.escrowAccount.findMany({
    include: {
      workOrder: { select: { alias: true, stage: true, supplierPo: { select: { supplier: { select: { name: true } } } } } },
      transactions: { select: { type: true, amount: true, milestone: true } },
      _count: { select: { transactions: true, disputes: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
  return rows.map((e) => ({
    id: e.id,
    href: orderHref(e.workOrder.alias, 'escrow'),
    order: e.workOrder.alias,
    escrowRef: e.escrowRef,
    supplier: e.workOrder.supplierPo.supplier.name,
    stage: getStage(e.workOrder.stage).label,
    status: e.status,
    agreedAmount: e.agreedAmount,
    fundedAmount: e.fundedAmount,
    releasedAmount: e.releasedAmount,
    heldAmount: Math.max(0, e.fundedAmount - e.releasedAmount),
    feeAmount: e.feeAmount,
    movements: e._count.transactions,
    provenance: e.provenance,
    openedAt: e.openedAt.toISOString(),
  }));
}

export async function listTestRequests(): Promise<RecordRow[]> {
  const rows = await db.testRequest.findMany({
    include: {
      workOrder: { select: { alias: true, testScope: true } },
      result: { include: { lineResults: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((t) => {
    const failed = t.result?.lineResults.reduce((a, l) => a + l.failedQty, 0) ?? 0;
    return {
      id: t.id,
      href: orderHref(t.workOrder.alias, 'testing'),
      order: t.workOrder.alias,
      requestNo: t.requestNo,
      labRef: t.labRequestRef,
      scope: t.scope === 'LOT_SAMPLE' ? 'Lot sample' : 'Full batch',
      sampleSize: t.sampleSize,
      aql: t.aql,
      status: t.status,
      verdict: t.result?.verdict ?? null,
      reportNo: t.result?.reportNo ?? null,
      failedQty: failed || null,
      testCost: t.testCost,
      reverseCharged: t.labIsForeign,
      provenance: t.provenance,
      submittedAt: t.submittedAt?.toISOString() ?? null,
    };
  });
}

export async function listShipments(): Promise<RecordRow[]> {
  const rows = await db.shipment.findMany({
    include: {
      workOrder: { select: { alias: true } },
      _count: { select: { events: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((s) => ({
    id: s.id,
    href: orderHref(s.workOrder.alias, 'logistics'),
    order: s.workOrder.alias,
    leg: SHIPMENT_LEG_META[s.legType as ShipmentLeg].label,
    route: `${s.originName} → ${s.destName}`,
    carrier: s.carrierCode,
    service: s.serviceName,
    awb: s.awb,
    status: s.status,
    pieces: s.pieces,
    chargeableWeightKg: s.chargeableWeightKg,
    freightAmount: s.freightAmount,
    events: s._count.events,
    provenance: s.provenance,
    dispatchedAt: s.dispatchedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
  }));
}

export async function listCustomsEntries(): Promise<RecordRow[]> {
  const rows = await db.customsEntry.findMany({
    include: {
      workOrder: { select: { alias: true, fxRate: true } },
      _count: { select: { queries: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((c) => ({
    id: c.id,
    href: orderHref(c.workOrder.alias, 'customs'),
    order: c.workOrder.alias,
    boeNumber: c.boeNumber,
    portCode: c.portCode,
    agent: c.whaAgentName,
    status: c.status,
    assessableValue: c.assessableValue,
    dutyBcd: c.dutyBcd,
    dutySws: c.dutySws,
    dutyIgst: c.dutyIgst,
    totalDuty: c.totalDuty,
    recoverable: c.dutyIgst,
    realCost: c.dutyBcd + c.dutySws,
    customsRate: c.exchangeRateUsed,
    ourRate: c.workOrder.fxRate,
    openQueries: c._count.queries || null,
    provenance: c.provenance,
    filedAt: c.filedAt?.toISOString() ?? null,
    outOfChargeAt: c.outOfChargeAt?.toISOString() ?? null,
  }));
}

export async function listWarehouseActivity(): Promise<{
  receipts: RecordRow[];
  inspections: RecordRow[];
  repacks: RecordRow[];
  deliveries: RecordRow[];
}> {
  const [grns, inspections, repacks, pods] = await Promise.all([
    db.grn.findMany({
      include: { workOrder: { select: { alias: true } }, lines: true },
      orderBy: { receivedAt: 'desc' },
    }),
    db.inspectionReport.findMany({
      include: {
        workOrder: { select: { alias: true } },
        inspector: { select: { name: true } },
        checklist: { select: { result: true } },
      },
      orderBy: { startedAt: 'desc' },
    }),
    db.repackJob.findMany({
      include: { workOrder: { select: { alias: true } } },
      orderBy: { startedAt: 'desc' },
    }),
    db.proofOfDelivery.findMany({
      include: { workOrder: { select: { alias: true } } },
      orderBy: { deliveredAt: 'desc' },
    }),
  ]);

  return {
    receipts: grns.map((g) => ({
      id: g.id,
      href: orderHref(g.workOrder.alias, 'inspection'),
      order: g.workOrder.alias,
      grnNumber: g.grnNumber,
      receivedAt: g.receivedAt.toISOString(),
      cartons: g.cartons,
      lines: g.lines.length,
      expectedQty: g.lines.reduce((a, l) => a + l.expectedQty, 0),
      receivedQty: g.lines.reduce((a, l) => a + l.receivedQty, 0),
      shortfall: g.hasShortfall,
      receivedBy: g.receivedBy,
    })),
    inspections: inspections.map((i) => ({
      id: i.id,
      href: orderHref(i.workOrder.alias, 'inspection'),
      order: i.workOrder.alias,
      reportNo: i.reportNo,
      status: i.verdict,
      inspector: i.inspector?.name ?? null,
      checksDone: i.checklist.filter((c) => c.result !== 'PENDING').length,
      checksTotal: i.checklist.length,
      startedAt: i.startedAt.toISOString(),
      signedOffAt: i.signedOffAt?.toISOString() ?? null,
    })),
    repacks: repacks.map((r) => ({
      id: r.id,
      href: orderHref(r.workOrder.alias, 'repack'),
      order: r.workOrder.alias,
      jobNo: r.jobNo,
      status: r.status,
      cartonCount: r.cartonCount,
      serialsCaptured: r.serialsCaptured,
      repackCost: r.repackCost,
      qcBy: r.qcBy,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    deliveries: pods.map((p) => ({
      id: p.id,
      href: orderHref(p.workOrder.alias, 'logistics'),
      order: p.workOrder.alias,
      podNumber: p.podNumber,
      signedBy: p.signedBy,
      deliveredAt: p.deliveredAt.toISOString(),
      sharedAt: p.sharedWithCustomerAt?.toISOString() ?? null,
      provenance: p.provenance,
    })),
  };
}

export async function listDocuments(): Promise<RecordRow[]> {
  const rows = await db.document.findMany({
    include: { workOrder: { select: { alias: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return rows.map((d) => ({
    id: d.id,
    href: d.workOrder ? orderHref(d.workOrder.alias, 'documents') : undefined,
    title: d.title,
    docType: d.docType.replace(/_/g, ' ').toLowerCase(),
    order: d.workOrder?.alias ?? null,
    fileName: d.fileName,
    sizeKb: Math.round(d.sizeBytes / 1024),
    version: d.version,
    uploadedBy: d.uploadedBy,
    provenance: d.provenance,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function listMasters() {
  const [customers, suppliers, parts, rates, labs, carriers, params] = await Promise.all([
    db.customer.findMany({ orderBy: { name: 'asc' } }),
    db.supplier.findMany({ orderBy: { name: 'asc' } }),
    db.mpnCatalogueItem.findMany({ orderBy: { mpn: 'asc' } }),
    db.hsnRate.findMany({ orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }] }),
    db.testingLab.findMany({ orderBy: { name: 'asc' } }),
    db.carrier.findMany({ orderBy: { name: 'asc' } }),
    db.testParameterMaster.findMany({ orderBy: { code: 'asc' } }),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      gstin: c.gstin,
      state: `${c.stateName} (${c.stateCode})`,
      city: c.city,
      treatment: c.isExport ? 'Zero-rated export' : c.isSez ? 'Zero-rated special economic zone' : 'Taxable',
      paymentTerms: c.paymentTerms,
      creditLimit: c.creditLimit,
      contact: c.contactName,
    })) as RecordRow[],
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      country: s.country,
      city: s.city,
      origin: s.isForeign ? 'Overseas' : 'Domestic',
      gstin: s.gstin,
      currency: s.currency,
      incoterms: s.incoterms,
      bank: s.bankName,
      swift: s.swiftCode,
      contact: s.contactName,
    })) as RecordRow[],
    parts: parts.map((p) => ({
      id: p.id,
      mpn: p.mpn,
      manufacturer: p.manufacturer,
      description: p.description,
      hsnCode: p.hsnCode,
      gstRate: p.defaultGstRate,
      uom: p.uom,
      msl: p.msl,
      rohs: p.rohs,
      packaging: p.packaging,
      countryOfOrigin: p.countryOfOrigin,
    })) as RecordRow[],
    rates: rates.map((r) => ({
      id: r.id,
      hsnCode: r.hsnCode,
      description: r.description,
      cgstRate: r.cgstRate,
      sgstRate: r.sgstRate,
      igstRate: r.igstRate,
      cessRate: r.cessRate,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      current: r.effectiveTo === null,
    })) as RecordRow[],
    labs: labs.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      country: l.country,
      city: l.city,
      origin: l.isForeign ? 'Overseas — reverse charged' : 'Domestic — input credit',
      gstin: l.gstin,
      accreditations: l.accreditations ? (JSON.parse(l.accreditations) as string[]).join(', ') : null,
      contact: l.contactEmail,
    })) as RecordRow[],
    carriers: carriers.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      integrated: c.isIntegrated,
      supportsPod: c.supportsPod,
    })) as RecordRow[],
    testParameters: params.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category.replace(/_/g, ' ').toLowerCase(),
      method: p.method,
      unit: p.unit,
      isDefault: p.isDefault,
    })) as RecordRow[],
  };
}

export async function taxRegisters() {
  const [invoices, credits, rcm, periods, ewbs] = await Promise.all([
    db.taxInvoice.findMany({
      include: { customer: { select: { name: true } }, workOrder: { select: { alias: true } }, lines: true, eWayBills: true },
      orderBy: { invoiceDate: 'desc' },
    }),
    db.inputTaxCredit.findMany({
      include: { workOrder: { select: { alias: true } } },
      orderBy: { documentDate: 'desc' },
    }),
    db.reverseChargeSelfInvoice.findMany({
      include: { workOrder: { select: { alias: true } } },
      orderBy: { invoiceDate: 'desc' },
    }),
    db.taxPeriodSummary.findMany({ orderBy: { taxPeriod: 'desc' } }),
    db.eWayBill.findMany({
      include: { invoice: { select: { invoiceNumber: true, customer: { select: { name: true } } } } },
      orderBy: { generatedAt: 'desc' },
    }),
  ]);

  const hsnSummary = new Map<
    string,
    { hsnCode: string; taxableValue: number; cgst: number; sgst: number; igst: number; quantity: number; lines: number }
  >();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const cur = hsnSummary.get(l.hsnCode) ?? {
        hsnCode: l.hsnCode,
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        quantity: 0,
        lines: 0,
      };
      cur.taxableValue += l.taxableValue;
      cur.cgst += l.cgstAmount;
      cur.sgst += l.sgstAmount;
      cur.igst += l.igstAmount;
      cur.quantity += l.quantity;
      cur.lines += 1;
      hsnSummary.set(l.hsnCode, cur);
    }
  }

  return {
    outputRegister: invoices.map((i) => ({
      id: i.id,
      href: orderHref(i.workOrder.alias, 'tax'),
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate.toISOString(),
      customer: i.customer.name,
      order: i.workOrder.alias,
      placeOfSupply: `${i.placeOfSupplyName} (${i.placeOfSupply})`,
      treatment: i.taxTreatment.replace(/_/g, ' ').toLowerCase(),
      taxableValue: i.taxableValue,
      cgstAmount: i.cgstAmount,
      sgstAmount: i.sgstAmount,
      igstAmount: i.igstAmount,
      totalAmount: i.totalAmount,
      eInvoice: i.eInvoiceStatus,
      hasEWayBill: i.eWayBills.length > 0,
      status: i.status,
    })) as RecordRow[],
    itcLedger: credits.map((c) => ({
      id: c.id,
      href: c.workOrder ? orderHref(c.workOrder.alias, 'tax') : undefined,
      source: c.source.replace(/_/g, ' ').toLowerCase(),
      documentRef: c.documentRef,
      documentDate: c.documentDate.toISOString(),
      supplier: c.supplierName,
      supplierGstin: c.supplierGstin,
      taxableValue: c.taxableValue,
      cgstAmount: c.cgstAmount,
      sgstAmount: c.sgstAmount,
      igstAmount: c.igstAmount,
      totalCredit: c.totalCredit,
      eligible: c.eligible,
      status: c.gstr2bStatus,
      taxPeriod: c.taxPeriod,
      order: c.workOrder?.alias ?? null,
    })) as RecordRow[],
    reverseCharge: rcm.map((r) => ({
      id: r.id,
      href: r.workOrder ? orderHref(r.workOrder.alias, 'tax') : undefined,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate.toISOString(),
      vendor: r.vendorName,
      vendorCountry: r.vendorCountry,
      serviceType: r.serviceType.toLowerCase(),
      hsnSacCode: r.hsnSacCode,
      taxableValue: r.taxableValue,
      igstRate: r.igstRate,
      igstAmount: r.igstAmount,
      order: r.workOrder?.alias ?? null,
      taxPeriod: r.taxPeriod,
    })) as RecordRow[],
    eWayBills: ewbs.map((e) => ({
      id: e.id,
      // Null while the number is still to be obtained from the portal — the
      // obligation is on record even though the number is not yet.
      ewbNumber: e.ewbNumber ?? 'Awaiting number',
      invoiceNumber: e.invoice.invoiceNumber,
      customer: e.invoice.customer.name,
      transportMode: e.transportMode.toLowerCase(),
      vehicleNumber: e.vehicleNumber,
      distanceKm: e.distanceKm,
      generatedAt: e.generatedAt.toISOString(),
      validUntil: e.validUntil?.toISOString() ?? null,
      status: e.status,
      provenance: e.provenance,
    })) as RecordRow[],
    hsnSummary: [...hsnSummary.values()].map((h) => ({ id: h.hsnCode, ...h })) as RecordRow[],
    periods: periods.map((p) => ({
      id: p.id,
      taxPeriod: p.taxPeriod,
      invoiceCount: p.invoiceCount,
      outputTaxable: p.outputTaxable,
      outputCgst: p.outputCgst,
      outputSgst: p.outputSgst,
      outputIgst: p.outputIgst,
      zeroRatedValue: p.zeroRatedValue,
      inputCredit: p.itcCgst + p.itcSgst + p.itcIgst,
      reverseChargeLiability: p.rcmLiability,
      netPayable: p.netPayable,
      status: p.status,
    })) as RecordRow[],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Created purchase orders — every PO built in the platform, both directions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Two registers rather than one list.
 *
 * A customer's order and our order to a supplier are different documents with
 * different columns and different questions asked of them — "is this fully
 * sourced yet" versus "has the supplier acknowledged". Merging them would need a
 * direction column and half the cells blank on every row.
 */
export async function listPurchaseOrders() {
  const [customerPos, supplierPos] = await Promise.all([
    db.customerPO.findMany({
      orderBy: { poDate: 'desc' },
      include: {
        customer: { select: { name: true, code: true } },
        // Allocations per line: the only honest basis for "is this sourced".
        lines: {
          select: {
            id: true,
            quantity: true,
            testingRequired: true,
            mappings: { select: { allocatedQty: true } },
          },
        },
        workOrders: {
          select: { id: true, alias: true, supplierPo: { select: { supplier: { select: { name: true } } } } },
        },
        proformas: { select: { id: true, direction: true, piNumber: true } },
      },
    }),
    db.supplierPO.findMany({
      orderBy: { poDate: 'desc' },
      include: {
        supplier: { select: { name: true, code: true, country: true, isForeign: true } },
        lines: { select: { id: true, quantity: true, testingRequired: true, leadTimeDays: true } },
        // The customer orders behind the work orders. Plural on purpose: a bulk
        // order raised from a demand aggregation serves several customers at
        // once, and taking only the first would hide the rest.
        workOrders: {
          select: {
            id: true,
            alias: true,
            customerPo: { select: { poNumber: true, customer: { select: { name: true } } } },
            customerPi: { select: { piNumber: true } },
          },
          orderBy: { alias: 'asc' },
        },
        // Set when this order came out of a pool rather than a single demand.
        aggregation: { select: { id: true, reference: true } },
        proformas: { select: { id: true, piNumber: true, externalRef: true } },
      },
    }),
  ]);

  return {
    customerPos: customerPos.map((p) => {
      const wo = p.workOrders[0];
      const ourPi = p.proformas.find((x) => x.direction === 'CUSTOMER_PI');
      // Derived, not read from the status column. A stored label cannot be
      // checked; this arithmetic can.
      const orderedQty = p.lines.reduce((a, l) => a + l.quantity, 0);
      const allocatedQty = p.lines.reduce(
        (a, l) => a + l.mappings.reduce((b, m) => b + m.allocatedQty, 0),
        0,
      );
      const shortfallQty = p.lines.reduce(
        (a, l) => a + Math.max(0, l.quantity - l.mappings.reduce((b, m) => b + m.allocatedQty, 0)),
        0,
      );
      const coveragePct = orderedQty > 0 ? Math.round((allocatedQty / orderedQty) * 100) : 0;
      const sourcing =
        allocatedQty === 0
          ? 'Not sourced'
          : shortfallQty === 0
            ? 'Fully sourced'
            : `Part sourced · ${coveragePct}%`;
      return {
        id: p.id,
        poNumber: p.poNumber,
        customer: p.customer.name,
        poDate: p.poDate.toISOString(),
        wantedBy: p.requestedDeliveryDate?.toISOString() ?? null,
        sourcingRef: p.sourcingRef ?? '—',
        lineCount: p.lines.length,
        totalQuantity: p.lines.reduce((a, l) => a + l.quantity, 0),
        totalValue: p.totalValue,
        currency: p.currency,
        incoterms: p.incoterms,
        paymentTerms: p.paymentTerms,
        testingLines: p.lines.filter((l) => l.testingRequired).length,
        ourQuote: ourPi?.piNumber ?? 'Not issued',
        // Whether it has been turned into work: the question this register exists
        // to answer for a customer order.
        workOrders: p.workOrders.length
          ? p.workOrders.map((w) => w.alias).join(', ')
          : '—',
        suppliers: p.workOrders.length
          ? [...new Set(p.workOrders.map((w) => w.supplierPo.supplier.name))].join(', ')
          : 'None yet',
        orderedQty,
        allocatedQty,
        shortfallQty,
        coveragePct,
        sourcing,
        href: wo ? `/orders/${wo.id}` : undefined,
      } satisfies RecordRow;
    }),
    supplierPos: supplierPos.map((p) => {
      const wo = p.workOrders[0];
      const theirPi = p.proformas[0];
      /** More than one work order means this order is serving pooled demand. */
      const isBulk = p.workOrders.length > 1;
      const customerOrders = p.workOrders.map((w) => w.customerPo.poNumber);
      const customers = [...new Set(p.workOrders.map((w) => w.customerPo.customer.name))];
      const leads = p.lines.map((l) => l.leadTimeDays).filter((x): x is number => x != null);
      return {
        id: p.id,
        poNumber: p.poNumber,
        voucherNo: p.voucherNo ?? '—',
        supplier: p.supplier.name,
        origin: p.supplier.isForeign ? `${p.supplier.country} · import` : 'Domestic',
        poDate: p.poDate.toISOString(),
        requiredBy: p.requiredDeliveryDate?.toISOString() ?? null,
        sourcingRef: p.sourcingRef ?? p.referenceNo ?? '—',
        lineCount: p.lines.length,
        totalQuantity: p.lines.reduce((a, l) => a + l.quantity, 0),
        totalValue: p.totalValue,
        currency: p.currency,
        // The longest lead on the order is what the delivery date hangs on.
        leadTimeDays: leads.length ? Math.max(...leads) : null,
        incoterms: p.incoterms,
        paymentMethod: p.paymentMethod,
        testingLines: p.lines.filter((l) => l.testingRequired).length,
        theirQuote: theirPi?.externalRef ?? theirPi?.piNumber ?? 'Awaited',
        // Whether this order is spoken for, and by whom.
        linked: isBulk ? `Bulk · ${p.workOrders.length} customer orders` : wo ? 'Linked' : 'Not linked',
        customerOrder: customerOrders.length ? customerOrders.join(', ') : '—',
        customer: customers.length ? customers.join(', ') : 'No customer yet',
        customerOrderCount: p.workOrders.length,
        aggregationRef: p.aggregation?.reference ?? '—',
        ourQuote: isBulk
          ? `${p.workOrders.filter((w) => w.customerPi).length} of ${p.workOrders.length} quoted`
          : (wo?.customerPi?.piNumber ?? '—'),
        workOrder: p.workOrders.length ? p.workOrders.map((w) => w.alias).join(', ') : '—',
        status: p.status,
        // A bulk order has no single work order to open, so it opens the pool it
        // came from instead — the only page that shows all of its customers.
        href: isBulk
          ? p.aggregation
            ? `/demand-aggregation?pool=${p.aggregation.id}`
            : undefined
          : wo
            ? `/orders/${wo.id}`
            : undefined,
      } satisfies RecordRow;
    }),
  };
}
