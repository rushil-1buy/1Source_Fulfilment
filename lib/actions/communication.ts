'use server';

/**
 * Recording correspondence against an order.
 *
 * Two intents, one record. "Log" captures something that already happened
 * elsewhere — a phone call, an email sent from someone's own mail client.
 * "Send" is something going out now.
 *
 * There is no mail connector in this build, and the manual-first rule (§11A)
 * says that must be stated rather than implied: a sent message is recorded as
 * outbound and left AWAITING_REPLY with an explicit instruction to dispatch it
 * by hand. Nothing here silently claims to have delivered an email.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { STAKEHOLDERS, STAKEHOLDER_META, isOneBuy, type Stakeholder } from '@/lib/domain/enums';


const Input = z.object({
  workOrderId: z.string().min(1),
  intent: z.enum(['LOG', 'SEND']),
  /** The party at the other end. 1BUY on both sides means an internal note. */
  counterparty: z.enum(STAKEHOLDERS),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'PHONE', 'PORTAL', 'MEETING', 'COURIER']),
  /** Only meaningful when logging: a call can have come in or gone out. */
  direction: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL']),
  subject: z.string().trim().min(3, 'Give the message a subject.').max(200),
  body: z.string().trim().min(1, 'The message cannot be empty.').max(8000),
  /** Shared entries are visible to the counterparty; internal ones are ours. */
  shared: z.boolean().default(false),
  /** ISO date-time. Defaults to now when logging live. */
  occurredAt: z.string().optional(),
  needsReply: z.boolean().default(false),
});

export type LogCommunicationInput = z.input<typeof Input>;

export interface CommunicationResult {
  ok: boolean;
  message: string;
  detail?: string;
  /** Field-level problems, keyed by field name. */
  errors?: Record<string, string>;
}

/** Outside a request context (a script) there is no cache to revalidate. */
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

export async function logCommunication(
  raw: LogCommunicationInput,
): Promise<CommunicationResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
    return { ok: false, message: 'That message could not be recorded.', errors };
  }
  const input = parsed.data;

  const wo = await db.workOrder.findUnique({
    where: { id: input.workOrderId },
    include: {
      customerPo: { include: { customer: true } },
      supplierPo: { include: { supplier: true } },
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  // 1BUY is always one end of the conversation; the operator picks the other.
  const oneBuy = { stakeholder: 'ONE_BUY_SOURCING' as const, name: 'Akash Dwivedi', email: 'akash@1buy.ai' };
  const other = counterpartyParty(input.counterparty, wo);

  const outbound = input.direction === 'OUTBOUND';
  const internal = input.direction === 'INTERNAL' || isOneBuy(input.counterparty);

  const participants = internal
    ? [{ role: 'FROM', ...oneBuy }, { role: 'TO', ...oneBuy }]
    : outbound
      ? [{ role: 'FROM', ...oneBuy }, { role: 'TO', ...other }]
      : [{ role: 'FROM', ...other }, { role: 'TO', ...oneBuy }];

  const sending = input.intent === 'SEND';

  const comm = await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'HUMAN',
      channel: input.channel,
      direction: internal ? 'INTERNAL' : input.direction,
      subject: input.subject,
      body: input.body,
      visibility: input.shared && !internal ? 'SHARED' : 'INTERNAL',
      sharedWith: input.shared && !internal ? input.counterparty : null,
      status: input.needsReply || sending ? 'AWAITING_REPLY' : 'CLOSED',
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      loggedById: 'u-priya',
      participants: { create: participants },
      contextChips: {
        create: [{ label: `Stage · ${wo.stage.replace(/_/g, ' ').toLowerCase()}`, kind: 'STAGE' }],
      },
    },
  });

  await db.auditLogEntry.create({
    data: {
      workOrderId: wo.id,
      entity: 'Communication',
      entityId: comm.id,
      action: 'CREATE',
      field: sending ? 'sent' : 'logged',
      afterValue: `${input.channel.toLowerCase()} — "${input.subject}"`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate(`/orders/${wo.id}`);

  return {
    ok: true,
    message: sending ? 'Message recorded and marked awaiting reply.' : 'Communication logged.',
    detail: sending
      ? `Filed against ${wo.alias} and shown in the thread. There is no mail connector configured, so send it from your own ${input.channel === 'EMAIL' ? 'mail client' : input.channel.toLowerCase()} — nothing was dispatched automatically.`
      : `Filed against ${wo.alias} and shown in the thread.`,
  };
}

/** Resolves the named human and address for whoever is at the other end. */
function counterpartyParty(
  code: Stakeholder,
  wo: {
    customerPo: { customer: { name: string; contactName: string; contactEmail: string } };
    supplierPo: { supplier: { name: string; contactName: string; contactEmail: string } };
  },
): { stakeholder: Stakeholder; name: string; email: string | null } {
  if (code === 'CUSTOMER')
    return {
      stakeholder: code,
      name: wo.customerPo.customer.contactName,
      email: wo.customerPo.customer.contactEmail,
    };
  if (code === 'SUPPLIER')
    return {
      stakeholder: code,
      name: wo.supplierPo.supplier.contactName,
      email: wo.supplierPo.supplier.contactEmail,
    };
  // Escrow, laboratory, customs agent and carrier are organisations we address
  // by role — there is no named individual on file for them.
  return { stakeholder: code, name: STAKEHOLDER_META[code].label, email: null };
}
