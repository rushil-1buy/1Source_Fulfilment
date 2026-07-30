'use server';

/**
 * Recording, and correcting, the evidence behind a stage.
 *
 * Two rules shape this file:
 *
 *  1. Evidence is never destroyed. Every save writes a revision holding the
 *     complete set of values at that point, plus a plain-language summary of
 *     what changed. Correcting a mistake is normal and expected; hiding that a
 *     correction happened is not.
 *
 *  2. Correcting an already-complete record requires a reason. Once a stage has
 *     been signed off, someone downstream has relied on it, and "why" is the
 *     part they will need.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { assessEvidence, evidenceFor, type EvidenceField } from '@/lib/domain/stage-evidence';
import { getStage } from '@/lib/domain/stages';

export interface EvidenceResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
  complete?: boolean;
}

type Values = Record<string, string | number | boolean | null>;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* no request context */
  }
}

/** Renders a value the way a person would read it back. */
function display(f: EvidenceField | undefined, v: unknown): string {
  if (v === undefined || v === null || v === '') return 'blank';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (f?.unit) return `${v} ${f.unit}`;
  return String(v);
}

/**
 * What changed between two versions, in words. This is what an auditor reads,
 * so it names the field by its label rather than its key.
 */
function summarise(
  fields: EvidenceField[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const f = byId.get(k);
    const label = f?.label ?? k;
    changes.push(
      Object.keys(before).length === 0
        ? `${label} set to ${display(f, b)}`
        : `${label}: ${display(f, a)} → ${display(f, b)}`,
    );
  }
  return changes.length ? changes.join('; ') : 'No values changed.';
}

export async function saveStageEvidence(
  workOrderId: string,
  stageId: string,
  values: Values,
  opts: { reason?: string } = {},
): Promise<EvidenceResult> {
  const def = evidenceFor(stageId);
  if (!def) {
    return { ok: false, message: 'No evidence is defined for that stage.' };
  }

  const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, alias: true } });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  const existing = await db.stageEvidence.findUnique({
    where: { workOrderId_stageId: { workOrderId, stageId } },
    include: { documents: { select: { stageId: true, docType: true } }, revisions: true },
  });

  // A correction to a signed-off record has to say why.
  const wasComplete = existing?.status === 'SUBMITTED';
  if (wasComplete && !opts.reason?.trim()) {
    return {
      ok: false,
      message: 'This stage has already been signed off.',
      detail:
        'Changing it is allowed — mistakes happen and the record should be right. But say why, so the correction reads as a correction rather than as a discrepancy.',
      errors: { reason: 'Give a reason for the correction.' },
    };
  }

  const before: Record<string, unknown> = existing ? JSON.parse(existing.values) : {};
  // Only fields this stage actually declares are stored, so a renamed field
  // cannot leave orphaned values behind.
  const clean: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (values[f.id] !== undefined) clean[f.id] = values[f.id];
    else if (before[f.id] !== undefined) clean[f.id] = before[f.id];
  }

  const attachedDocIds = (existing?.documents ?? [])
    .map((d) => d.docType)
    .filter((x): x is string => Boolean(x));
  const assessment = assessEvidence(stageId, clean, attachedDocIds);

  const evidence = await db.stageEvidence.upsert({
    where: { workOrderId_stageId: { workOrderId, stageId } },
    create: {
      workOrderId,
      stageId,
      values: JSON.stringify(clean),
      status: assessment.complete ? 'SUBMITTED' : 'DRAFT',
      completedAt: assessment.complete ? new Date() : null,
      completedById: assessment.complete ? 'u-priya' : null,
    },
    update: {
      values: JSON.stringify(clean),
      status: assessment.complete ? 'SUBMITTED' : 'DRAFT',
      // Keep the original sign-off time; a later correction does not re-date it.
      completedAt: assessment.complete ? (existing?.completedAt ?? new Date()) : null,
      completedById: assessment.complete ? (existing?.completedById ?? 'u-priya') : null,
    },
  });

  const revision = (existing?.revisions.length ?? 0) + 1;
  await db.stageEvidenceRevision.create({
    data: {
      evidenceId: evidence.id,
      revision,
      values: JSON.stringify(clean),
      changeSummary: summarise(def.fields, before, clean),
      reason: opts.reason?.trim() || null,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  /**
   * One audit row per field that actually changed. The log is append-only and
   * each row has to stand on its own: "who changed the date received, from what,
   * to what, and why" must be answerable from a single row rather than by parsing
   * a sentence that bundled six changes together.
   */
  const byId = new Map(def.fields.map((f) => [f.id, f]));
  const fieldRows: { field: string; before: string | null; after: string | null }[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(clean)])) {
    const a = before[key];
    const b = clean[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const f = byId.get(key);
    const raw = (v: unknown) =>
      v === undefined || v === null || v === '' ? null : display(f, v);
    fieldRows.push({ field: f?.label ?? key, before: raw(a), after: raw(b) });
  }

  if (fieldRows.length > 0) {
    await db.auditLogEntry.createMany({
      data: fieldRows.map((r) => ({
        workOrderId,
        entity: `Stage evidence · ${getStage(stageId)?.label ?? stageId}`,
        entityId: evidence.id,
        action: revision === 1 ? 'CREATE' : 'UPDATE',
        field: r.field,
        beforeValue: r.before,
        afterValue: r.after,
        reason: opts.reason?.trim() || null,
        actorId: 'u-priya',
        actorLabel: 'Akash Dwivedi',
      })),
    });
  }

  safeRevalidate(`/orders/${workOrderId}`);

  const stageLabel = getStage(stageId)?.label ?? stageId;
  if (assessment.complete) {
    return {
      ok: true,
      complete: true,
      message: wasComplete ? `Correction recorded for ${stageLabel}.` : `${stageLabel} evidence is complete.`,
      detail: wasComplete
        ? `Revision ${revision}. The previous version is kept in the history.`
        : 'Everything required is recorded, so the order can move on.',
    };
  }

  const missing = [
    ...assessment.missingFields.map((f) => f.label),
    ...assessment.missingDocs.map((d) => `${d.label} (document)`),
  ];
  return {
    ok: true,
    complete: false,
    message: 'Saved as a draft.',
    detail: `Still needed before this stage can be signed off: ${missing.join(', ')}.`,
  };
}

/**
 * Attaches a document as evidence for a stage.
 *
 * Files are recorded rather than stored as binaries: this build has no object
 * store, and inventing one silently would be worse than being explicit. What is
 * kept is everything needed to find and identify the file — name, type, size and
 * who attached it — plus any text pasted in its place.
 */
export async function attachStageDocument(
  workOrderId: string,
  stageId: string,
  input: {
    /** The declared document slot from the stage's evidence definition. */
    docId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    /** Text content, when the operator pastes the contents instead of a file. */
    bodyText?: string;
  },
): Promise<EvidenceResult> {
  const def = evidenceFor(stageId);
  const slot = def?.documents.find((d) => d.id === input.docId);
  if (!def || !slot) return { ok: false, message: 'That is not a document this stage expects.' };
  if (!input.fileName.trim()) {
    return { ok: false, message: 'The file needs a name.', errors: { fileName: 'Required.' } };
  }

  const evidence = await db.stageEvidence.upsert({
    where: { workOrderId_stageId: { workOrderId, stageId } },
    create: { workOrderId, stageId, values: '{}', status: 'DRAFT' },
    update: {},
  });

  // Re-attaching the same slot supersedes the previous file rather than adding a
  // second one, so "the signed report" is never ambiguous.
  const prior = await db.document.findFirst({
    where: { evidenceId: evidence.id, docType: input.docId },
    orderBy: { version: 'desc' },
  });

  await db.document.create({
    data: {
      stageId,
      evidenceId: evidence.id,
      docType: input.docId,
      title: slot.label,
      fileName: input.fileName.trim(),
      mimeType: input.mimeType || 'application/pdf',
      sizeBytes: input.sizeBytes ?? 0,
      version: (prior?.version ?? 0) + 1,
      bodyText: input.bodyText?.trim() || null,
      workOrderId,
      uploadedBy: 'Akash Dwivedi',
      provenance: 'MANUAL',
    },
  });

  // Attaching a document can be what completes the stage, so re-assess.
  const fresh = await db.stageEvidence.findUnique({
    where: { id: evidence.id },
    include: { documents: { select: { docType: true } } },
  });
  const assessment = assessEvidence(
    stageId,
    JSON.parse(fresh?.values ?? '{}'),
    (fresh?.documents ?? []).map((d) => d.docType),
  );
  if (assessment.complete && fresh?.status !== 'SUBMITTED') {
    await db.stageEvidence.update({
      where: { id: evidence.id },
      data: { status: 'SUBMITTED', completedAt: new Date(), completedById: 'u-priya' },
    });
  }

  await db.auditLogEntry.create({
    data: {
      workOrderId,
      entity: `Stage document · ${getStage(stageId)?.label ?? stageId}`,
      entityId: evidence.id,
      action: 'CREATE',
      field: slot.label,
      beforeValue: prior?.fileName ?? null,
      afterValue: input.fileName,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate(`/orders/${workOrderId}`);
  return {
    ok: true,
    complete: assessment.complete,
    message: `${slot.label} attached.`,
    detail: prior
      ? `This replaces the previous version, which is kept as revision ${prior.version}.`
      : undefined,
  };
}

export async function removeStageDocument(
  workOrderId: string,
  documentId: string,
): Promise<EvidenceResult> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return { ok: false, message: 'That document is no longer there.' };

  await db.document.delete({ where: { id: documentId } });
  await db.auditLogEntry.create({
    data: {
      workOrderId,
      entity: 'Document',
      entityId: documentId,
      action: 'DELETE',
      field: doc.stageId ?? undefined,
      beforeValue: `Removed "${doc.fileName}" (${doc.title})`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  // Removing a required document takes the stage back to draft, which is the
  // honest outcome — the evidence no longer supports the sign-off.
  if (doc.evidenceId) {
    const ev = await db.stageEvidence.findUnique({
      where: { id: doc.evidenceId },
      include: { documents: { select: { docType: true } } },
    });
    if (ev) {
      const assessment = assessEvidence(
        ev.stageId,
        JSON.parse(ev.values),
        ev.documents.map((d) => d.docType),
      );
      if (!assessment.complete && ev.status === 'SUBMITTED') {
        await db.stageEvidence.update({
          where: { id: ev.id },
          data: { status: 'DRAFT', completedAt: null },
        });
      }
    }
  }

  safeRevalidate(`/orders/${workOrderId}`);
  return { ok: true, message: 'Document removed.', detail: 'The removal is on the audit log.' };
}
