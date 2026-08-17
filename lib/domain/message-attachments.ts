/**
 * Which documents a message carries.
 *
 * A thread scoped to one order is only a mailbox if the paperwork travels with
 * the messages. Read "Consignment departed — airway bill, packing list and
 * certificate of origin attached for your customs filing" with nothing attached
 * and the thread has told you a document exists somewhere else; the desk still
 * has to go and find it, which is the work the sentence promised to save.
 *
 * THE RULE IS THE FLOW, NOT THE PROSE. A message could be scanned for the word
 * "attached", but that would attach whatever the writer happened to mention and
 * miss whatever they did not. What actually decides it is who is writing and
 * what step they are writing about: a party carries the documents THEY are
 * answerable for producing at that step, because those are the ones they would
 * have had to hand. The supplier's proforma travels with the supplier's mail
 * about the proforma; the laboratory's report travels with theirs.
 *
 * The consequence worth stating: a document is attached to the message from the
 * party who OWES it, never to the message chasing it. A chase carries no
 * attachment, which is exactly what makes it a chase.
 */

import { docFlowFor, normaliseDocType } from './document-flow';
import { evidenceFor } from './stage-evidence';
import type { Stakeholder } from './enums';

export interface AttachableDoc {
  id: string;
  /** The stored type or the gate's id — both resolve through the flow map. */
  docType: string;
  /** The stage it was filed against, where one was recorded. */
  stageId: string | null;
}

export interface AttachmentContext {
  /** Who is sending the message. */
  from: Stakeholder;
  /** The step the message is about. */
  stageId: string;
  /** Every document on the order. */
  documents: AttachableDoc[];
}

/**
 * The documents a message from `from` about `stageId` would carry.
 *
 * Matched on the step's own expected documents rather than on everything filed
 * against the stage: a step accumulates paperwork from several parties, and a
 * supplier's mail carrying the customs agent's bill of entry would be a mailbox
 * that invents attachments.
 */
export function attachmentsFor(ctx: AttachmentContext): AttachableDoc[] {
  const expected = evidenceFor(ctx.stageId)?.documents ?? [];
  if (expected.length === 0) return [];

  /*
   * Document ids this sender is answerable for at this step, NORMALISED.
   *
   * The gate names this document `supplierPi` and the stored record calls it
   * `SUPPLIER_PI`. Comparing either one lowercased gives 'supplierpi' against
   * 'supplier_pi', which never matches — so every thread came back with no
   * attachments at all while the rule looked correct in isolation. Both sides
   * go through the same normaliser, which is the one the rest of the document
   * layer already uses.
   */
  const theirs = new Set(
    expected
      .filter((d) => docFlowFor(d.id)?.provider === ctx.from)
      .map((d) => normaliseDocType(d.id)),
  );
  if (theirs.size === 0) return [];

  /*
   * Matched by TYPE and confined to this step.
   *
   * A document type can legitimately appear more than once on an order — two
   * packing lists on a split consignment — and attaching every one of them to
   * a message about a single step would put paperwork from a later shipment
   * into an earlier mail.
   */
  return ctx.documents.filter(
    (d) =>
      theirs.has(normaliseDocType(d.docType)) &&
      (d.stageId === null || d.stageId === ctx.stageId),
  );
}

/**
 * Whether a message's own words claim an attachment.
 *
 * Used only to CHECK the result, never to produce it: a message that says
 * "attached" and carries nothing is the one a reader notices, so it is worth
 * being able to find them. Deliberately narrow — "please attach" is a request,
 * not a claim.
 */
export function claimsAnAttachment(body: string): boolean {
  const t = body.toLowerCase();
  if (/please (find |)attach|kindly attach|please send/.test(t)) return /please find attach/.test(t);
  return /\battached\b|\benclosed\b|\battachment\b/.test(t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Assigning documents to the message that carried them
// ─────────────────────────────────────────────────────────────────────────────

export interface AttachableMessage {
  id: string;
  from: Stakeholder;
  stageId: string | null;
  occurredAt: Date;
}

/**
 * Which message each document arrived on.
 *
 * A document hangs off ONE message, because that is the mail it came in on —
 * the schema says so and so does the trade. So the assignment runs oldest-first
 * and the earliest message that would legitimately carry a document takes it;
 * a later mail mentioning the same paperwork is referring back to it, not
 * delivering it again.
 *
 * Returns a map of document id to message id, leaving out every document no
 * message would have carried. Most documents are in that group — a bill of
 * entry is filed on a portal, not emailed — and inventing a mail for them would
 * make the thread a worse record than the register.
 */
export function assignAttachments(
  messages: AttachableMessage[],
  documents: AttachableDoc[],
): Map<string, string> {
  const assigned = new Map<string, string>();
  const remaining = new Set(documents.map((d) => d.id));

  const oldestFirst = [...messages].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const m of oldestFirst) {
    if (!m.stageId || remaining.size === 0) continue;
    const carried = attachmentsFor({
      from: m.from,
      stageId: m.stageId,
      documents: documents.filter((d) => remaining.has(d.id)),
    });
    for (const d of carried) {
      assigned.set(d.id, m.id);
      remaining.delete(d.id);
    }
  }

  return assigned;
}
