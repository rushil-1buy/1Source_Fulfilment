'use server';

/**
 * THE FIVE ADAPTERS — §11A.1 to §11A.5.
 *
 * Each is provider-agnostic: WHL and Escrow deliberately model no specific
 * vendor, because those two are not finalised, so choosing one later cannot
 * force a rewrite. Every operation returns an AdapterOutcome, so callers must
 * handle the manual path explicitly rather than assuming automation.
 *
 * `live` is intentionally omitted throughout — with no credentials the runtime
 * raises NotConfiguredError, which degrades to manual entry. Going live is a
 * credential-and-config exercise, not a rebuild.
 */

import { invokeAdapter, pick, seedFrom, type AdapterOutcome } from './core';
import { validateGstin } from '@/lib/tax/gst-engine';

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

// ═══════════════════════════════════════════════════════════════════════════
// 1. Testing Laboratory (vendor NOT finalised)
// ═══════════════════════════════════════════════════════════════════════════

export interface WhlSubmitArgs {
  workOrderId: string;
  requestNo: string;
  scope: 'LOT_SAMPLE' | 'FULL_BATCH';
  sampleSize?: number | null;
  aql?: string | null;
  parameters: string[];
  lines: { mpn: string; quantity: number }[];
}

export async function whlSubmitTestRequest(
  args: WhlSubmitArgs,
): Promise<AdapterOutcome<{ labRequestRef: string; acceptedAt: string }>> {
  return invokeAdapter(
    {
      connectorId: 'WHL',
      operation: 'submitTestRequest',
      workOrderId: args.workOrderId,
      idempotencyKey: args.requestNo,
    },
    {
      mock: async (a) => {
        const seed = seedFrom(a.requestNo);
        return {
          labRequestRef: `LAB/${pad(seed % 9999)}/2026`,
          acceptedAt: new Date().toISOString(),
        };
      },
    },
    args,
  );
}

export async function whlGetTestResult(args: {
  workOrderId: string;
  labRequestRef: string;
  lines: { mpn: string; quantity: number }[];
  sampleSize: number;
}): Promise<
  AdapterOutcome<{
    verdict: 'PASS' | 'FAIL' | 'PARTIAL';
    reportNo: string;
    signedBy: string;
    testedAt: string;
    perLine: { mpn: string; testedQty: number; passedQty: number; failedQty: number; failureMode: string | null }[];
  }>
> {
  return invokeAdapter(
    { connectorId: 'WHL', operation: 'getTestResult', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(a.labRequestRef);
        // Deterministic: roughly one in six lots fails, one in six partially.
        const outcome = pick(seed, ['PASS', 'PASS', 'PASS', 'PASS', 'PARTIAL', 'FAIL'] as const);
        const perLine = a.lines.map((l, i) => {
          const tested = Math.min(a.sampleSize || l.quantity, l.quantity);
          const failed =
            outcome === 'FAIL' ? Math.max(1, Math.round(tested * 0.24)) : outcome === 'PARTIAL' && i === 0 ? Math.max(1, Math.round(tested * 0.08)) : 0;
          return {
            mpn: l.mpn,
            testedQty: tested,
            passedQty: tested - failed,
            failedQty: failed,
            failureMode: failed
              ? 'Re-marked package — die markings inconsistent with the declared date code'
              : null,
          };
        });
        return {
          verdict: outcome,
          reportNo: `LAB-RPT-2026-${pad(seed % 9999)}`,
          signedBy: 'Dr S. Raghavan, Technical Manager',
          testedAt: new Date().toISOString(),
          perLine,
        };
      },
    },
    args,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DHL Express — Logistics (confirmed carrier)
// ═══════════════════════════════════════════════════════════════════════════

export interface DhlShipmentSpec {
  workOrderId: string;
  legType: 'TEST_OUT' | 'TEST_RETURN' | 'IMPORT' | 'OUTBOUND';
  origin: { name: string; country: string };
  dest: { name: string; country: string };
  pieces: number;
  grossWeightKg: number;
  declaredValueMinor: number;
  currency: string;
  incoterms?: string;
  /** HSN codes are required on the customs line items, for DHL and for GST. */
  customsLines: { mpn: string; hsnCode: string; quantity: number; valueMinor: number }[];
}

export async function dhlRate(
  args: DhlShipmentSpec,
): Promise<
  AdapterOutcome<{
    quotes: { service: string; transitDays: number; chargeableWeightKg: number; currency: string; amountMinor: number; surcharges: string[] }[];
  }>
> {
  return invokeAdapter(
    { connectorId: 'DHL', operation: 'rate', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(`${a.legType}${a.origin.country}${a.dest.country}${a.grossWeightKg}`);
        const volumetric = a.grossWeightKg * 1.22;
        const chargeable = Math.max(a.grossWeightKg, volumetric);
        const base = Math.round(chargeable * (a.origin.country === a.dest.country ? 240 : 1150));
        return {
          quotes: [
            {
              service: 'EXPRESS WORLDWIDE',
              transitDays: a.origin.country === a.dest.country ? 1 : 3,
              chargeableWeightKg: Number(chargeable.toFixed(1)),
              currency: 'INR',
              amountMinor: (base + (seed % 400)) * 100,
              surcharges: ['Fuel surcharge', 'Emergency situation surcharge'],
            },
            {
              service: 'ECONOMY SELECT',
              transitDays: a.origin.country === a.dest.country ? 3 : 6,
              chargeableWeightKg: Number(chargeable.toFixed(1)),
              currency: 'INR',
              amountMinor: Math.round((base + (seed % 400)) * 0.64) * 100,
              surcharges: ['Fuel surcharge'],
            },
          ],
        };
      },
    },
    args,
  );
}

export async function dhlCreateShipment(
  args: DhlShipmentSpec & { service: string },
): Promise<AdapterOutcome<{ awb: string; labelRef: string; dispatchConfirmation: string; estimatedDelivery: string }>> {
  return invokeAdapter(
    {
      connectorId: 'DHL',
      operation: 'createShipment',
      workOrderId: args.workOrderId,
      idempotencyKey: `${args.workOrderId}:${args.legType}`,
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`${a.workOrderId}${a.legType}`);
        return {
          awb: `78${pad(seed % 99999999, 8)}`,
          labelRef: `LABEL-${pad(seed % 9999)}.pdf`,
          dispatchConfirmation: `DHL-CONF-${pad(seed % 999999, 6)}`,
          estimatedDelivery: new Date(Date.now() + 3 * 86400_000).toISOString(),
        };
      },
    },
    args,
  );
}

export async function dhlTrack(args: {
  workOrderId: string;
  awb: string;
}): Promise<
  AdapterOutcome<{
    statusCode: string;
    statusText: string;
    events: { timestamp: string; location: string; code: string; description: string }[];
    estimatedDelivery: string | null;
    actualDelivery: string | null;
  }>
> {
  return invokeAdapter(
    { connectorId: 'DHL', operation: 'track', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(a.awb);
        const stage = seed % 4;
        const base = Date.now() - 3 * 86400_000;
        const all = [
          { code: 'PU', description: 'Shipment picked up', location: 'Origin facility' },
          { code: 'DF', description: 'Departed origin facility', location: 'Origin hub' },
          { code: 'AF', description: 'Arrived destination country', location: 'Bengaluru' },
          { code: 'OK', description: 'Delivered', location: 'Consignee address' },
        ];
        const events = all.slice(0, stage + 1).map((e, i) => ({
          ...e,
          timestamp: new Date(base + i * 14 * 3600_000).toISOString(),
        }));
        const delivered = stage === 3;
        return {
          statusCode: delivered ? 'OK' : events[events.length - 1].code,
          statusText: delivered ? 'Delivered' : 'In transit',
          events,
          estimatedDelivery: new Date(base + 4 * 86400_000).toISOString(),
          actualDelivery: delivered ? events[events.length - 1].timestamp : null,
        };
      },
    },
    args,
  );
}

export async function dhlGetProofOfDelivery(args: {
  workOrderId: string;
  awb: string;
}): Promise<AdapterOutcome<{ podRef: string; signedBy: string; deliveredAt: string }>> {
  return invokeAdapter(
    { connectorId: 'DHL', operation: 'getProofOfDelivery', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(`pod${a.awb}`);
        return {
          podRef: `POD-2026-${pad(seed % 9999)}`,
          signedBy: pick(seed, ['R. Nair', 'S. Kulkarni', 'A. Selvam', 'R. Verma']),
          deliveredAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
        };
      },
    },
    args,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ICEGATE — Indian Customs (confirmed)
// ═══════════════════════════════════════════════════════════════════════════

export async function icegateFileBillOfEntry(args: {
  workOrderId: string;
  portCode: string;
  invoiceValueMinor: number;
  currency: string;
  lines: { hsnCode: string; description: string; quantity: number; valueMinor: number }[];
}): Promise<AdapterOutcome<{ boeNo: string; filingAckNo: string; filedAt: string }>> {
  return invokeAdapter(
    {
      connectorId: 'ICEGATE',
      operation: 'fileBillOfEntry',
      workOrderId: args.workOrderId,
      idempotencyKey: `boe:${args.workOrderId}`,
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`boe${a.workOrderId}`);
        return {
          boeNo: String(7600000 + (seed % 99999)),
          filingAckNo: `ACK/${a.portCode}/${pad(seed % 999999, 6)}`,
          filedAt: new Date().toISOString(),
        };
      },
    },
    args,
  );
}

export async function icegateGetDutyAssessment(args: {
  workOrderId: string;
  boeNo: string;
  assessableValueMinor: number;
}): Promise<
  AdapterOutcome<{
    assessableValueMinor: number;
    exchangeRateUsed: number;
    heads: { bcdMinor: number; swsMinor: number; igstMinor: number; cessMinor: number };
    totalDutyMinor: number;
    challanRef: string;
  }>
> {
  return invokeAdapter(
    { connectorId: 'ICEGATE', operation: 'getDutyAssessment', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(`duty${a.boeNo}`);
        // Customs sets its own rate on the day — deliberately not our locked FX.
        const exchangeRateUsed = 83.4 + (seed % 90) / 100;
        const bcdMinor = Math.round(a.assessableValueMinor * 0.1);
        const swsMinor = Math.round(bcdMinor * 0.1);
        const igstMinor = Math.round((a.assessableValueMinor + bcdMinor + swsMinor) * 0.18);
        return {
          assessableValueMinor: a.assessableValueMinor,
          exchangeRateUsed: Number(exchangeRateUsed.toFixed(2)),
          heads: { bcdMinor, swsMinor, igstMinor, cessMinor: 0 },
          totalDutyMinor: bcdMinor + swsMinor + igstMinor,
          challanRef: `CHLN/2026/${pad(seed % 9999999, 7)}`,
        };
      },
    },
    args,
  );
}

export async function icegateGetBoeStatus(args: {
  workOrderId: string;
  boeNo: string;
}): Promise<
  AdapterOutcome<{
    status: string;
    statusHistory: { status: string; occurredAt: string; note: string }[];
    queries: { queryRef: string; queryText: string; raisedAt: string }[];
    assessmentComplete: boolean;
    outOfChargeDate: string | null;
  }>
> {
  return invokeAdapter(
    { connectorId: 'ICEGATE', operation: 'getBoeStatus', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(`status${a.boeNo}`);
        // One in five entries draws a query — the customs-hold exception path.
        const queried = seed % 5 === 0;
        const base = Date.now() - 2 * 86400_000;
        const history = [
          { status: 'FILED', occurredAt: new Date(base).toISOString(), note: 'Bill of Entry lodged; documents uploaded via eSanchit.' },
          { status: 'UNDER_ASSESSMENT', occurredAt: new Date(base + 6 * 3600_000).toISOString(), note: 'Assigned to assessing officer.' },
        ];
        if (queried) {
          history.push({
            status: 'QUERY_RAISED',
            occurredAt: new Date(base + 12 * 3600_000).toISOString(),
            note: 'Officer has raised a query — clearance is on hold until answered.',
          });
        } else {
          history.push({
            status: 'ASSESSED',
            occurredAt: new Date(base + 14 * 3600_000).toISOString(),
            note: 'Assessment complete. Duty payable generated.',
          });
        }
        return {
          status: history[history.length - 1].status,
          statusHistory: history,
          queries: queried
            ? [
                {
                  queryRef: `QRY/${pad(seed % 9999)}`,
                  queryText:
                    'Country-of-origin certificate does not match the declared origin on line 1. Submit the original COO or amend the declaration.',
                  raisedAt: new Date(base + 12 * 3600_000).toISOString(),
                },
              ]
            : [],
          assessmentComplete: !queried,
          outOfChargeDate: null,
        };
      },
    },
    args,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Escrow (vendor NOT finalised)
// ═══════════════════════════════════════════════════════════════════════════

export async function escrowOpenAccount(args: {
  workOrderId: string;
  currency: string;
  amountMinor: number;
  parties: { role: string; name: string }[];
  milestones: ('TEST_ENABLEMENT' | 'FINAL_SETTLEMENT')[];
}): Promise<AdapterOutcome<{ escrowRef: string; virtualAccount: string; agreementRef: string }>> {
  return invokeAdapter(
    {
      connectorId: 'ESCROW',
      operation: 'openEscrowAccount',
      workOrderId: args.workOrderId,
      idempotencyKey: `escrow:${args.workOrderId}`,
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`escrow${a.workOrderId}`);
        return {
          escrowRef: `ESC-2026-${pad(seed % 99999, 5)}`,
          virtualAccount: `VA1BUY${pad(seed % 99999999, 8)}`,
          agreementRef: `ESCAGR-${pad(seed % 9999)}.pdf`,
        };
      },
    },
    args,
  );
}

export async function escrowInstructRelease(args: {
  workOrderId: string;
  escrowRef: string;
  amountMinor: number;
  beneficiary: string;
  milestone: 'TEST_ENABLEMENT' | 'FINAL_SETTLEMENT';
  authorisedBy: string[];
  reason: string;
  /**
   * Distinguishes one release from another against the same milestone.
   *
   * Without it the idempotency key is milestone-wide, so a second partial
   * release replays the first one's stored response and comes back with the
   * wrong instruction reference. Callers that can release more than once against
   * a milestone must pass something that varies — the running released total is
   * enough, and it is stable on a retry of the same movement.
   */
  idempotencySuffix?: string;
}): Promise<AdapterOutcome<{ instructionRef: string; status: string; valueDate: string }>> {
  return invokeAdapter(
    {
      connectorId: 'ESCROW',
      operation: 'instructRelease',
      workOrderId: args.workOrderId,
      idempotencyKey: `release:${args.escrowRef}:${args.milestone}${
        args.idempotencySuffix ? `:${args.idempotencySuffix}` : ''
      }`,
      retryable: false, // never retry a money movement automatically
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`rel${a.escrowRef}${a.milestone}${a.idempotencySuffix ?? ''}`);
        return {
          instructionRef: `REL/${a.milestone === 'TEST_ENABLEMENT' ? 'TEST' : 'FINAL'}/${pad(seed % 9999)}`,
          status: 'SETTLED',
          valueDate: new Date().toISOString(),
        };
      },
    },
    args,
  );
}

export async function escrowGetBalance(args: {
  workOrderId: string;
  escrowRef: string;
}): Promise<AdapterOutcome<{ fundedMinor: number; releasedMinor: number; heldMinor: number; currency: string; lastUpdatedAt: string }>> {
  return invokeAdapter(
    { connectorId: 'ESCROW', operation: 'getBalance', workOrderId: args.workOrderId },
    {
      mock: async (a) => {
        const seed = seedFrom(`bal${a.escrowRef}`);
        const funded = (500000 + (seed % 900000)) * 100;
        const released = Math.round(funded * 0.15);
        return {
          fundedMinor: funded,
          releasedMinor: released,
          heldMinor: funded - released,
          currency: 'INR',
          lastUpdatedAt: new Date().toISOString(),
        };
      },
    },
    args,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. GST — e-invoice / e-way bill via a GSP (§11A.5b)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The e-invoice schema's transaction category. A supply *to* an SEZ unit is very
 * much e-invoiced — that is what SEZWP/SEZWOP exist for — so the only party
 * exempt from generating one is an SEZ unit reporting its own outward supply.
 * WP / WOP = with / without payment of tax (the latter being a LUT supply).
 */
export type SupplyCategory = 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';

export async function gspGenerateIrn(args: {
  workOrderId: string;
  invoiceNumber: string;
  invoiceDate: string;
  sellerGstin: string;
  buyerGstin: string | null;
  supplyCategory: SupplyCategory;
  totalMinor: number;
  lines: { hsnCode: string; taxableMinor: number }[];
}): Promise<AdapterOutcome<{ irn: string; ackNo: string; ackDate: string; signedQrCode: string }>> {
  return invokeAdapter(
    {
      connectorId: 'GST_GSP',
      operation: 'generateIRN',
      workOrderId: args.workOrderId,
      idempotencyKey: `irn:${args.invoiceNumber}`,
      retryable: false, // a duplicate IRN is a compliance problem, not a retry
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`irn${a.invoiceNumber}`);
        const hex = (n: number) => n.toString(16).padStart(8, '0');
        return {
          irn: `${hex(seed)}${hex(seed * 7)}${hex(seed * 13)}${hex(seed * 31)}`.slice(0, 64),
          ackNo: `112026${pad(seed % 99999999, 8)}`,
          ackDate: new Date().toISOString(),
          signedQrCode: `eyJhbGciOiJSUzI1NiJ9.${a.invoiceNumber}.MOCK-SIGNED-QR`,
        };
      },
    },
    args,
  );
}

export async function gspGenerateEWayBill(args: {
  workOrderId: string;
  invoiceNumber: string;
  transportMode: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
  vehicleNumber?: string | null;
  distanceKm: number;
}): Promise<AdapterOutcome<{ ewbNo: string; validUntil: string }>> {
  return invokeAdapter(
    {
      connectorId: 'GST_GSP',
      operation: 'generateEWayBill',
      workOrderId: args.workOrderId,
      idempotencyKey: `ewb:${args.invoiceNumber}`,
    },
    {
      mock: async (a) => {
        const seed = seedFrom(`ewb${a.invoiceNumber}`);
        // Validity: one day per 200km slab, minimum one day.
        const days = Math.max(1, Math.ceil(a.distanceKm / 200));
        return {
          ewbNo: String(321000000000 + (seed % 999999999)),
          validUntil: new Date(Date.now() + days * 86400_000).toISOString(),
        };
      },
    },
    args,
  );
}

export async function gspValidateGstin(args: {
  gstin: string;
}): Promise<AdapterOutcome<{ valid: boolean; legalName: string; status: string; stateCode: string; registrationType: string }>> {
  return invokeAdapter(
    { connectorId: 'GST_GSP', operation: 'validateGSTIN' },
    {
      mock: async (a) => {
        // The local checksum is authoritative even in mock mode — a wrong
        // number must never come back "valid" just because we simulated it.
        const local = validateGstin(a.gstin);
        const seed = seedFrom(a.gstin);
        return {
          valid: local.valid,
          legalName: local.valid
            ? pick(seed, ['ACME ELECTRONICS PRIVATE LIMITED', 'NOVA SYSTEMS LIMITED', 'ZENITH DEVICES (SEZ) PRIVATE LIMITED'])
            : '',
          status: local.valid ? 'Active' : 'Invalid',
          stateCode: local.stateCode ?? '',
          registrationType: local.valid ? 'Regular' : '',
        };
      },
    },
    args,
  );
}
