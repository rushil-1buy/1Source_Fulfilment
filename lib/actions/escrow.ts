'use server';

/**
 * Moving money in and out of escrow by hand.
 *
 * Two operations, both deliberately hard to do carelessly:
 *   fundEscrow    — a deposit lands in the escrow account
 *   releaseEscrow — money leaves it, towards the supplier
 *
 * Every movement needs a reason and a proof document. That is not ceremony: an
 * escrow release is an irreversible transfer of somebody else's money, and the
 * question asked six months later is always "on what authority". A movement with
 * no proof attached cannot answer it.
 *
 * The final settlement — the movement that empties the account — additionally
 * needs a passed inbound inspection and two different Finance approvers (§11A.4,
 * AC#23). One person can never release the balance alone.
 *
 * Amounts are integer minor units throughout. A percentage is only ever an input
 * convenience: the UI converts it to an amount and the amount is what is stored,
 * because re-deriving money from a rounded percentage loses paise every time.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { escrowInstructRelease } from '@/lib/integrations/adapters';
import { ESCROW_MILESTONES } from '@/lib/domain/enums';

export interface EscrowResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  /** The account after the movement, so the caller can show the new position. */
  balance?: {
    agreedAmount: number;
    fundedAmount: number;
    releasedAmount: number;
    heldAmount: number;
    /** Instructed but not yet settled — committed, so not available. */
    instructedAmount: number;
    availableAmount: number;
    status: string;
  };
}

const inr = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN')}`;

/** Percentage of a base, for the log. Display only — never used to compute money. */
const pctOfBase = (amount: number, base: number) =>
  base > 0 ? `${((amount / base) * 100).toFixed(1)}%` : '—';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

const Common = {
  workOrderId: z.string().min(1),
  /** Integer minor units. */
  amount: z
    .number({ message: 'Enter an amount.' })
    .int('Amounts are whole paise.')
    .positive('The amount has to be more than zero.'),
  reason: z
    .string()
    .trim()
    .min(12, 'Say what this movement is for — a dozen characters is not an explanation.')
    .max(600),
  /** The uploaded proof. Required: see the file header. */
  proofDocumentId: z.string().min(1, 'Attach the proof of this movement.'),
  reference: z.string().trim().max(80).optional().nullable(),
};

const FundInput = z.object({ ...Common });
const ReleaseInput = z.object({
  ...Common,
  milestone: z.enum(ESCROW_MILESTONES),
  /** Finance users signing off. Required for the movement that empties the account. */
  approverIds: z.array(z.string()).optional().default([]),
});

export type FundEscrowInput = z.input<typeof FundInput>;
export type ReleaseEscrowInput = z.input<typeof ReleaseInput>;

function fieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}

/** Shared preamble: the order, its escrow account, and the obvious refusals. */
async function loadAccount(workOrderId: string) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      alias: true,
      status: true,
      paymentMethod: true,
      escrowAccount: true,
      supplierPo: { select: { supplier: { select: { name: true } } } },
    },
  });
  if (!wo) return { error: { ok: false as const, message: 'That order no longer exists.' } };
  if (!wo.escrowAccount) {
    return {
      error: {
        ok: false as const,
        message: 'There is no escrow account on this order.',
        detail:
          wo.paymentMethod === 'ESCROW'
            ? 'The account is opened when the order reaches C1. Advance the order to that stage first.'
            : `This order is on ${wo.paymentMethod.toLowerCase()} terms, so no money is held in escrow.`,
      },
    };
  }
  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    return {
      error: {
        ok: false as const,
        message: `This order is ${wo.status.toLowerCase()}.`,
        detail:
          'A finished order is a record of what happened. Moving money on it now would describe a payment that did not take place.',
      },
    };
  }
  /**
   * Money already instructed to leave but not yet settled.
   *
   * `releasedAmount` only counts settled movements, so held-less-released would
   * count an in-flight release as still available and let the same money be
   * committed twice. It has to come off what can be released.
   */
  const inFlight = await db.escrowTransaction.aggregate({
    where: {
      escrowId: wo.escrowAccount.id,
      type: { in: ['PARTIAL_RELEASE', 'FINAL_RELEASE'] },
      status: 'INSTRUCTED',
    },
    _sum: { amount: true },
  });

  return { wo, esc: wo.escrowAccount, instructedAmount: inFlight._sum.amount ?? 0 };
}

function balanceOf(
  esc: {
    agreedAmount: number;
    fundedAmount: number;
    releasedAmount: number;
    status: string;
  },
  instructedAmount = 0,
) {
  const held = Math.max(0, esc.fundedAmount - esc.releasedAmount);
  return {
    agreedAmount: esc.agreedAmount,
    fundedAmount: esc.fundedAmount,
    releasedAmount: esc.releasedAmount,
    heldAmount: held,
    instructedAmount,
    /** What can actually be released right now. */
    availableAmount: Math.max(0, held - instructedAmount),
    status: esc.status,
  };
}

/** Attaches the uploaded proof to the movement it justifies. */
async function attachProof(documentId: string, txId: string, workOrderId: string) {
  await db.document.update({
    where: { id: documentId },
    data: { escrowTxId: txId, workOrderId },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Money in
// ═══════════════════════════════════════════════════════════════════════════

export async function fundEscrow(raw: FundEscrowInput): Promise<EscrowResult> {
  const parsed = FundInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'That deposit could not be recorded.', errors: fieldErrors(parsed.error) };
  }
  const d = parsed.data;

  const loaded = await loadAccount(d.workOrderId);
  if (loaded.error) return loaded.error;
  const { wo, esc, instructedAmount } = loaded;

  const before = balanceOf(esc, instructedAmount);
  const after = before.fundedAmount + d.amount;

  // Over-funding is allowed — top-ups for freight or a revised quote are normal —
  // but it is called out, because silently exceeding the agreed amount is exactly
  // the sort of thing nobody notices until reconciliation.
  const overshoot = Math.max(0, after - esc.agreedAmount);

  const tx = await db.escrowTransaction.create({
    data: {
      escrowId: esc.id,
      type: 'FUND',
      amount: d.amount,
      currency: esc.currency,
      reference: d.reference?.trim() || `FUND/${wo.alias}/${before.fundedAmount === 0 ? 1 : 2}`,
      status: 'SETTLED',
      valueDate: new Date(),
      reason: d.reason,
      provenance: 'MANUAL',
      provenanceActor: 'Akash Dwivedi',
      provenanceAt: new Date(),
    },
  });

  await attachProof(d.proofDocumentId, tx.id, wo.id);

  const status =
    esc.releasedAmount > 0 && esc.releasedAmount < after
      ? 'PARTIALLY_RELEASED'
      : after > 0
        ? 'FUNDED'
        : esc.status;

  const updated = await db.escrowAccount.update({
    where: { id: esc.id },
    data: { fundedAmount: after, status },
  });

  // One audit row per changed fact, per the append-only rule.
  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: wo.id,
        entity: 'Escrow account',
        entityId: esc.id,
        action: 'UPDATE',
        field: 'Funded amount',
        beforeValue: inr(before.fundedAmount),
        afterValue: inr(after),
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Escrow movement',
        entityId: tx.id,
        action: 'CREATE',
        field: 'Deposit',
        afterValue: `${inr(d.amount)} (${pctOfBase(d.amount, esc.agreedAmount)} of the agreed amount)`,
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      ...(before.status !== status
        ? [
            {
              workOrderId: wo.id,
              entity: 'Escrow account',
              entityId: esc.id,
              action: 'UPDATE',
              field: 'Status',
              beforeValue: before.status,
              afterValue: status,
              actorId: 'u-priya',
              actorLabel: 'Akash Dwivedi',
            },
          ]
        : []),
      ...(overshoot > 0
        ? [
            {
              workOrderId: wo.id,
              entity: 'Escrow account',
              entityId: esc.id,
              action: 'UPDATE',
              field: 'Funded above the agreed amount',
              beforeValue: inr(esc.agreedAmount),
              afterValue: `${inr(after)} — ${inr(overshoot)} more than agreed`,
              reason: d.reason,
              actorId: 'u-priya',
              actorLabel: 'Akash Dwivedi',
            },
          ]
        : []),
    ],
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Escrow funded — ${inr(d.amount)} deposited`,
      body: `${inr(d.amount)} paid into ${esc.escrowRef}, taking the funded total to ${inr(after)} of ${inr(esc.agreedAmount)} agreed.${overshoot > 0 ? ` That is ${inr(overshoot)} above the agreed amount.` : ''} Reason given: ${d.reason}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Landmark',
      loggedById: 'u-priya',
      participants: { create: [{ role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' }] },
      contextChips: { create: [{ kind: 'DOCUMENT', refId: esc.id, label: esc.escrowRef }] },
    },
  });

  safeRevalidate(`/orders/${wo.id}`);
  safeRevalidate('/escrow');
  return {
    ok: true,
    message: `${inr(d.amount)} added to escrow.`,
    detail:
      overshoot > 0
        ? `Held is now ${inr(updated.fundedAmount - updated.releasedAmount)}. This puts the account ${inr(overshoot)} above the agreed amount — flagged on the audit log.`
        : `Held is now ${inr(updated.fundedAmount - updated.releasedAmount)}, ${pctOfBase(updated.fundedAmount, esc.agreedAmount)} of the agreed amount.`,
    balance: balanceOf(updated, instructedAmount),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Money out
// ═══════════════════════════════════════════════════════════════════════════

export async function releaseEscrow(raw: ReleaseEscrowInput): Promise<EscrowResult> {
  const parsed = ReleaseInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'That release could not be made.', errors: fieldErrors(parsed.error) };
  }
  const d = parsed.data;

  const loaded = await loadAccount(d.workOrderId);
  if (loaded.error) return loaded.error;
  const { wo, esc, instructedAmount } = loaded;

  const before = balanceOf(esc, instructedAmount);

  // ── You cannot pay out money that is not there, or money already promised ──
  if (before.availableAmount <= 0) {
    return {
      ok: false,
      message:
        before.instructedAmount > 0
          ? 'Everything held is already committed to a release awaiting settlement.'
          : 'There is nothing held in escrow to release.',
      detail:
        before.instructedAmount > 0
          ? `${inr(before.heldAmount)} is held but ${inr(before.instructedAmount)} of it has already been instructed and is waiting to settle. Releasing against it again would pay the same money out twice.`
          : before.fundedAmount === 0
            ? 'The account has never been funded. Add money to it first.'
            : `All ${inr(before.fundedAmount)} funded has already been released.`,
      errors: { amount: 'Nothing is available.' },
    };
  }
  if (d.amount > before.availableAmount) {
    return {
      ok: false,
      message: 'That is more than the account can release.',
      detail:
        before.instructedAmount > 0
          ? `${inr(before.availableAmount)} is available — ${inr(before.heldAmount)} held less ${inr(before.instructedAmount)} already instructed and waiting to settle. A release cannot spend money that is already on its way out.`
          : `Held right now is ${inr(before.heldAmount)} — ${inr(before.fundedAmount)} funded less ${inr(before.releasedAmount)} already released. A release cannot create money the account does not have.`,
      errors: { amount: `At most ${inr(before.availableAmount)} can be released.` },
    };
  }

  /** The movement that empties the account is the final settlement, whatever it is called. */
  const emptiesAccount = d.amount === before.availableAmount;
  const isFinal = emptiesAccount || d.milestone === 'FINAL_SETTLEMENT';

  if (isFinal) {
    // ── HARD GATE (§11A.4, AC#23) ─────────────────────────────────────────
    const passed = await db.inspectionReport.findFirst({
      where: { workOrderId: wo.id, verdict: 'PASSED' },
      select: { id: true },
    });
    if (!passed) {
      return {
        ok: false,
        message: 'The final release is blocked until the inbound inspection has passed.',
        detail:
          'This is deliberate: releasing the balance before we have verified what arrived would remove the only leverage we have if the goods are wrong. Release a partial amount against an earlier milestone if the supplier needs money now.',
        errors: { amount: 'Blocked by the inspection gate.' },
      };
    }

    const ids = [...new Set(d.approverIds)];
    if (ids.length < 2) {
      return {
        ok: false,
        message: 'The final release needs two different Finance approvers.',
        detail: `You supplied ${ids.length}. One person can never release the balance alone.`,
        errors: { approverIds: 'Pick two different Finance users.' },
      };
    }
    const approvers = await db.user.findMany({ where: { id: { in: ids }, role: 'Finance' } });
    if (approvers.length < 2) {
      return {
        ok: false,
        message: 'Both approvers must hold the Finance role.',
        detail: `Only ${approvers.length} of the ${ids.length} selected are Finance users.`,
        errors: { approverIds: 'Both must be Finance users.' },
      };
    }
  }

  const approvers = isFinal
    ? await db.user.findMany({ where: { id: { in: [...new Set(d.approverIds)] }, role: 'Finance' } })
    : [];

  // Adapter first, write second: an instruction that never left must not leave a
  // release row behind claiming it did.
  const out = await escrowInstructRelease({
    workOrderId: wo.id,
    escrowRef: esc.escrowRef,
    amountMinor: d.amount,
    beneficiary: wo.supplierPo.supplier.name,
    milestone: d.milestone,
    authorisedBy: approvers.length ? approvers.map((a) => a.name) : ['Akash Dwivedi'],
    reason: d.reason,
    // Each manual movement is its own instruction. Without this the stored
    // idempotency key would replay the first release's reference for every
    // later one against the same milestone.
    idempotencySuffix: `${before.releasedAmount}:${d.amount}`,
  });
  /**
   * A connector failure never blocks the movement. The house rule for adapters is
   * degrade-to-manual: the operator is recording something that happened in the
   * real world, and a broken integration is not a reason to refuse the record. It
   * is stamped MANUAL provenance instead, so the log says who vouched for it.
   */
  const provenance = out.ok ? out.provenance : 'MANUAL';
  const instructionRef = out.ok ? out.data?.instructionRef : null;
  const degraded = !out.ok && !out.manual ? out.error : null;

  const afterReleased = before.releasedAmount + d.amount;
  /**
   * Settled means nothing is left to pay out, so a release still waiting on the
   * provider keeps the account open. Marking it settled while money is in flight
   * would say the job is done before it is.
   */
  const status =
    afterReleased >= before.fundedAmount && before.instructedAmount === 0
      ? 'SETTLED'
      : 'PARTIALLY_RELEASED';

  const tx = await db.escrowTransaction.create({
    data: {
      escrowId: esc.id,
      type: emptiesAccount ? 'FINAL_RELEASE' : 'PARTIAL_RELEASE',
      milestone: d.milestone,
      amount: d.amount,
      currency: esc.currency,
      beneficiary: wo.supplierPo.supplier.name,
      reference:
        d.reference?.trim() || instructionRef || `REL/${d.milestone}/${wo.alias}`,
      status: 'SETTLED',
      valueDate: new Date(),
      reason: d.reason,
      provenance,
      provenanceActor: approvers.length
        ? approvers.map((a) => a.name).join(' + ')
        : 'Akash Dwivedi',
      provenanceAt: new Date(),
      provenanceRef: instructionRef ?? null,
    },
  });

  if (degraded) {
    await db.auditLogEntry.create({
      data: {
        workOrderId: wo.id,
        entity: 'Escrow movement',
        entityId: tx.id,
        action: 'UPDATE',
        field: 'Recorded without the provider',
        afterValue: `The escrow connector failed (${degraded}); the movement was entered by hand.`,
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
    });
  }

  if (approvers.length) {
    await db.escrowApproval.createMany({
      data: approvers.map((a) => ({
        transactionId: tx.id,
        approverId: a.id,
        approvedAt: new Date(),
        note: d.reason,
      })),
    });
  }

  await attachProof(d.proofDocumentId, tx.id, wo.id);

  const updated = await db.escrowAccount.update({
    where: { id: esc.id },
    data: {
      releasedAmount: afterReleased,
      status,
      settledAt: status === 'SETTLED' ? new Date() : null,
    },
  });

  await db.auditLogEntry.createMany({
    data: [
      {
        workOrderId: wo.id,
        entity: 'Escrow account',
        entityId: esc.id,
        action: 'UPDATE',
        field: 'Released amount',
        beforeValue: inr(before.releasedAmount),
        afterValue: inr(afterReleased),
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Escrow movement',
        entityId: tx.id,
        action: emptiesAccount ? 'AUTHORISE' : 'CREATE',
        field: emptiesAccount ? 'Final release' : 'Partial release',
        afterValue: `${inr(d.amount)} (${pctOfBase(d.amount, esc.agreedAmount)} of the agreed amount) to ${wo.supplierPo.supplier.name}`,
        reason: d.reason,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      {
        workOrderId: wo.id,
        entity: 'Escrow account',
        entityId: esc.id,
        action: 'UPDATE',
        field: 'Held right now',
        beforeValue: inr(before.heldAmount),
        afterValue: inr(Math.max(0, before.fundedAmount - afterReleased)),
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      },
      ...(before.status !== status
        ? [
            {
              workOrderId: wo.id,
              entity: 'Escrow account',
              entityId: esc.id,
              action: 'UPDATE',
              field: 'Status',
              beforeValue: before.status,
              afterValue: status,
              actorId: 'u-priya',
              actorLabel: 'Akash Dwivedi',
            },
          ]
        : []),
      ...approvers.map((a) => ({
        workOrderId: wo.id,
        entity: 'Escrow movement',
        entityId: tx.id,
        action: 'AUTHORISE',
        field: 'Approved by',
        afterValue: `${a.name} · ${a.role}`,
        reason: d.reason,
        actorId: a.id,
        actorLabel: a.name,
      })),
    ],
  });

  await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'SYSTEM',
      channel: 'SYSTEM',
      direction: 'INTERNAL',
      subject: `Escrow released — ${inr(d.amount)} to ${wo.supplierPo.supplier.name}`,
      body: `${inr(d.amount)} released from ${esc.escrowRef} against ${d.milestone.replace(/_/g, ' ').toLowerCase()}${approvers.length ? `, authorised by ${approvers.map((a) => a.name).join(' and ')}` : ''}. Released to date ${inr(afterReleased)} of ${inr(before.fundedAmount)} funded; ${inr(Math.max(0, before.fundedAmount - afterReleased))} still held. Reason given: ${d.reason}`,
      status: 'CLOSED',
      occurredAt: new Date(),
      systemIcon: 'Landmark',
      loggedById: 'u-priya',
      participants: {
        create: [
          { role: 'FROM', stakeholder: 'ONE_BUY', name: 'Akash Dwivedi' },
          { role: 'TO', stakeholder: 'SUPPLIER', name: wo.supplierPo.supplier.name },
        ],
      },
      contextChips: { create: [{ kind: 'DOCUMENT', refId: esc.id, label: esc.escrowRef }] },
    },
  });

  safeRevalidate(`/orders/${wo.id}`);
  safeRevalidate('/escrow');
  const position =
    status === 'SETTLED'
      ? 'The account is now settled — everything funded has been paid out.'
      : `${inr(updated.fundedAmount - updated.releasedAmount)} is still held, ${pctOfBase(updated.releasedAmount, esc.agreedAmount)} of the agreed amount released so far.`;

  return {
    ok: true,
    message: `${inr(d.amount)} released to ${wo.supplierPo.supplier.name}.`,
    detail: degraded
      ? `${position} The escrow provider could not be reached (${degraded}), so this is recorded by hand — confirm the transfer with them and file the confirmation against the movement.`
      : position,
    balance: balanceOf(updated, instructedAmount),
  };
}
