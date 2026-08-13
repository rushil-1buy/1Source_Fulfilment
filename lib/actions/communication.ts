'use server';

/**
 * Correspondence against an order — sending, receiving and replying.
 *
 * Two intents, one record. "Log" captures something that already happened
 * elsewhere — a phone call, an email sent from someone's own mail client.
 * "Send" is something going out now.
 *
 * WHAT IS ACTUALLY DELIVERED, and what is not, is the important distinction
 * here, and the code keeps it rather than blurring it:
 *
 *   Internal → internal (one 1BUY team to another) is REALLY delivered. Both
 *   ends are inside this system, so the message lands unread in the recipient
 *   team's inbox, they reply, and the reply lands unread back. Nothing manual.
 *
 *   Internal → external has no mail connector in this build, and the
 *   manual-first rule (§11A) says that must be stated rather than implied. It
 *   is recorded as outbound and left AWAITING_REPLY with an explicit
 *   instruction to dispatch it by hand. When the reply arrives, somebody logs
 *   it inbound and it lands unread in the same inbox.
 *
 * Nothing here silently claims to have delivered an external email.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { STAKEHOLDERS, STAKEHOLDER_META, isOneBuy, slugForTeam, type Stakeholder } from '@/lib/domain/enums';


const Input = z.object({
  workOrderId: z.string().min(1),
  intent: z.enum(['LOG', 'SEND']),
  /**
   * Which 1BUY team this is from. Without it every message was attributed to
   * Sourcing, so Finance chasing an escrow release appeared to be Sourcing
   * doing it — and the reply came back to the wrong desk.
   */
  fromTeam: z.enum(STAKEHOLDERS).default('ONE_BUY_SOURCING'),
  /** The message being answered, when this is a reply. Quotes it and closes it out. */
  replyToId: z.string().optional(),
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

  // Our end of the conversation is the team composing it; the operator picks
  // the other. Both ends are named parties — an internal note from Finance to
  // Inspection has a real sender and a real recipient, not "1BUY" twice.
  const us = teamParty(input.fromTeam);
  const other = counterpartyParty(input.counterparty, wo);

  const outbound = input.direction === 'OUTBOUND';
  // Internal means BOTH ends are ours. A message from Finance to Inspection is
  // internal; one from Finance to the supplier is not, whichever team sent it.
  const internal = isOneBuy(input.counterparty) && isOneBuy(input.fromTeam);
  // A team messaging itself is a note to the desk, not correspondence.
  const selfNote = internal && input.counterparty === input.fromTeam;

  const participants = internal
    ? [{ role: 'FROM', ...us }, { role: 'TO', ...other }]
    : outbound
      ? [{ role: 'FROM', ...us }, { role: 'TO', ...other }]
      : [{ role: 'FROM', ...other }, { role: 'TO', ...us }];

  const sending = input.intent === 'SEND';

  // Threading: quote what is being answered, and close that message out so it
  // stops sitting in the recipient's "needs a reply" pile once answered.
  let quotedHistory: string | null = null;
  if (input.replyToId) {
    const parent = await db.communication.findUnique({
      where: { id: input.replyToId },
      select: { id: true, subject: true, body: true, occurredAt: true, workOrderId: true },
    });
    // Silently ignoring a mismatch would file the reply on the wrong order.
    if (parent && parent.workOrderId === wo.id) {
      quotedHistory = `On ${parent.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} — ${parent.subject}\n\n${parent.body}`;
      await db.communication.update({
        where: { id: parent.id },
        data: { status: 'REPLIED', isUnread: false },
      });
    }
  }

  /**
   * Unread is the recipient's problem, not the sender's.
   *
   * Anything genuinely arriving at a 1BUY desk starts unread: an internal
   * message to another team, and an inbound one somebody has just logged. A
   * note a team writes to itself does not — they have just read it by writing
   * it — and neither does an outbound message to an external party, which is
   * sitting in the other organisation's inbox, not ours.
   */
  const arrivesAtOurDesk = (internal && !selfNote) || (!internal && !outbound);

  const comm = await db.communication.create({
    data: {
      workOrderId: wo.id,
      entryClass: 'HUMAN',
      channel: input.channel,
      direction: internal ? 'INTERNAL' : input.direction,
      subject: input.subject,
      body: input.body,
      quotedHistory,
      visibility: input.shared && !internal ? 'SHARED' : 'INTERNAL',
      sharedWith: input.shared && !internal ? input.counterparty : null,
      status: input.needsReply || sending ? 'AWAITING_REPLY' : 'CLOSED',
      isUnread: arrivesAtOurDesk,
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
  // Both desks, not just the sender's: the whole point of an internal message
  // is that it shows up on somebody else's screen without them reloading.
  for (const party of [input.fromTeam, input.counterparty]) {
    const slug = slugForTeam(party);
    if (slug) {
      safeRevalidate(`/teams/${slug}`);
      safeRevalidate(`/teams/${slug}/orders/${wo.id}`);
    }
  }

  const toLabel = STAKEHOLDER_META[input.counterparty].short;
  return {
    ok: true,
    message: internal
      ? `Sent to ${toLabel}.`
      : sending
        ? 'Message recorded and marked awaiting reply.'
        : 'Communication logged.',
    detail: internal
      ? // True of an internal message and only an internal one — both ends are
        // in this system, so it really has been delivered.
        `Filed against ${wo.alias} and now sitting unread in ${toLabel}'s inbox.`
      : sending
        ? `Filed against ${wo.alias} and shown in the thread. There is no mail connector configured, so send it from your own ${input.channel === 'EMAIL' ? 'mail client' : input.channel.toLowerCase()} — nothing was dispatched automatically.`
        : `Filed against ${wo.alias} and shown in the thread.`,
  };
}

/**
 * Marks a message read for the team that opened it.
 *
 * Read state is per-message rather than per-recipient because in this build a
 * message has exactly one 1BUY recipient. If a message ever goes to two teams
 * at once this has to become a join table, and the flag would start lying.
 */
export async function markCommunicationRead(
  id: string,
  team?: Stakeholder,
): Promise<{ ok: boolean }> {
  const existing = await db.communication.findUnique({
    where: { id },
    select: { workOrderId: true, isUnread: true },
  });
  if (!existing) return { ok: false };
  if (existing.isUnread) await db.communication.update({ where: { id }, data: { isUnread: false } });

  safeRevalidate(`/orders/${existing.workOrderId}`);
  const slug = team ? slugForTeam(team) : null;
  if (slug) safeRevalidate(`/teams/${slug}`);
  return { ok: true };
}

/** The shared desk a 1BUY team is reachable at. */
function teamParty(code: Stakeholder): { stakeholder: Stakeholder; name: string; email: string | null } {
  const meta = STAKEHOLDER_META[code];
  return { stakeholder: code, name: meta.label, email: meta.mailbox };
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
  // by role — there is no named individual on file for them. Internal teams
  // come through here too when one team writes to another.
  return { stakeholder: code, name: STAKEHOLDER_META[code].label, email: STAKEHOLDER_META[code].mailbox };
}
