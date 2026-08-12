'use server';

/**
 * Uploading a real file against an order.
 *
 * Takes FormData so the browser streams the bytes straight to the server action
 * — no base64 round trip, and the file never has to fit in a JSON payload.
 *
 * Two entry points, because there are two moments a document arrives:
 *  * as evidence for a stage, filed against that stage's declared slot;
 *  * at creation time, when the customer's own order or the supplier's quote is
 *    the thing being recorded.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { assessEvidence, evidenceFor } from '@/lib/domain/stage-evidence';
import { getStage, ladderPosition, resolveRailAnchor } from '@/lib/domain/stages';
import { STAGE_CONTEXT_INCLUDE, stageContextFrom } from '@/lib/domain/stage-context';
import {
  ALLOWED_MIME,
  DURABLE_STORAGE,
  MAX_UPLOAD_BYTES,
  NO_STORAGE_REASON,
  deleteStoredFile,
  extensionFor,
  storeFile,
} from '@/lib/storage';

export interface UploadResult {
  ok: boolean;
  message: string;
  detail?: string;
  documentId?: string;
  /** True when this upload completed the stage's evidence. */
  complete?: boolean;
}

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* no request context */
  }
}

/**
 * Appends the impermanence note on a host where the file will not survive the
 * instance. It rides on `detail` rather than `message` so the confirmation the
 * operator reads first stays short, and so a successful upload still reads as a
 * success — which it is; it is just not permanent.
 */
function withStorageNote(detail: string | undefined): string | undefined {
  if (DURABLE_STORAGE) return detail;
  return detail ? `${detail} ${NO_STORAGE_REASON}` : NO_STORAGE_REASON;
}

/** Shared checks, so both entry points refuse the same things for the same reasons. */
function validate(file: File | null): { ok: true; extension: string } | { ok: false; result: UploadResult } {
  if (!file || file.size === 0) {
    return { ok: false, result: { ok: false, message: 'No file was selected.' } };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      result: {
        ok: false,
        message: 'That file is too large.',
        detail: `The limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB and this one is ${(file.size / 1024 / 1024).toFixed(1)} MB. A scan at 150 dots per inch is usually well under it.`,
      },
    };
  }
  const extension = extensionFor(file.type, file.name);
  if (!extension) {
    return {
      ok: false,
      result: {
        ok: false,
        message: 'That kind of file is not accepted.',
        detail: `Accepted: ${[...new Set(Object.values(ALLOWED_MIME))].join(', ')}. This is a document store, so the list is deliberately short.`,
      },
    };
  }
  return { ok: true, extension };
}

/**
 * Attaches an uploaded file as evidence for a stage.
 *
 * FormData fields: workOrderId, stageId, docId, file.
 */
export async function uploadStageDocument(formData: FormData): Promise<UploadResult> {
  const workOrderId = String(formData.get('workOrderId') ?? '');
  const stageId = String(formData.get('stageId') ?? '');
  const docId = String(formData.get('docId') ?? '');
  const file = formData.get('file') as File | null;

  const def = evidenceFor(stageId);
  const slot = def?.documents.find((d) => d.id === docId);
  if (!def || !slot) return { ok: false, message: 'That is not a document this stage expects.' };

  const check = validate(file);
  if (!check.ok) return check.result;

  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      stage: true,
      paymentMethod: true,
      testingRequired: true,
      testScope: true,
      incoterms: true,
      ...STAGE_CONTEXT_INCLUDE,
    },
  });
  if (!wo) return { ok: false, message: 'That order no longer exists.' };

  /**
   * Nothing may be filed against a stage the order has not reached.
   *
   * The panel already hides the control, but a hidden control is a courtesy, not
   * a rule — this is the rule. Evidence attached to a stage the order never
   * entered is a claim about work that has not happened, and it would satisfy
   * that stage's gate later without anybody looking at it again.
   *
   * Earlier stages stay open: a report arriving late, or a mistyped number, is
   * ordinary, and the evidence panel has always allowed those corrections.
   */
  const ctx = stageContextFrom(wo);
  const { anchorStageId } = resolveRailAnchor(wo.stage);
  const here = ladderPosition(anchorStageId, ctx);
  const target = ladderPosition(stageId, ctx);
  if (here >= 0 && target > here) {
    const at = getStage(anchorStageId);
    const to = getStage(stageId);
    return {
      ok: false,
      message: `This order has not reached ${to.code} ${to.label} yet.`,
      detail: `It is at ${at.code} ${at.label}. Documents can only be filed against a step the order has actually got to — otherwise the paperwork would satisfy a gate for work nobody has done.`,
    };
  }

  const evidence = await db.stageEvidence.upsert({
    where: { workOrderId_stageId: { workOrderId, stageId } },
    create: { workOrderId, stageId, values: '{}', status: 'DRAFT' },
    update: {},
  });

  // Re-attaching the same slot supersedes rather than adding a second file, so
  // "the signed report" is never ambiguous. The old bytes stay on disk under
  // their own document id, which is what makes the earlier version retrievable.
  const prior = await db.document.findFirst({
    where: { evidenceId: evidence.id, docType: docId },
    orderBy: { version: 'desc' },
  });

  const created = await db.document.create({
    data: {
      stageId,
      evidenceId: evidence.id,
      docType: docId,
      title: slot.label,
      fileName: file!.name,
      mimeType: file!.type || 'application/octet-stream',
      sizeBytes: file!.size,
      version: (prior?.version ?? 0) + 1,
      workOrderId,
      uploadedBy: 'Akash Dwivedi',
      provenance: 'MANUAL',
    },
  });

  try {
    const stored = await storeFile(await file!.arrayBuffer(), {
      documentId: created.id,
      extension: check.extension,
    });
    await db.document.update({
      where: { id: created.id },
      data: { storagePath: stored.storagePath, sizeBytes: stored.sizeBytes },
    });
  } catch (err) {
    // A row pointing at bytes that were never written is worse than no row.
    await db.document.delete({ where: { id: created.id } });
    return {
      ok: false,
      message: 'The file could not be saved.',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // The upload can be what completes the stage, so re-assess.
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
      entity: 'Document',
      entityId: created.id,
      action: 'CREATE',
      field: slot.label,
      beforeValue: prior?.fileName ?? null,
      afterValue: file!.name,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate(`/orders/${workOrderId}`);
  return {
    ok: true,
    documentId: created.id,
    complete: assessment.complete,
    message: `${slot.label} uploaded.`,
    detail: withStorageNote(
      prior
        ? `This replaces the previous file, which is kept as revision ${prior.version}.`
        : assessment.complete
          ? 'That was the last thing outstanding — this stage is now signed off.'
          : undefined,
    ),
  };
}

/**
 * Attaches a file to a purchase order or proforma invoice at the moment it is
 * created — the customer's own order, or the supplier's quote.
 *
 * FormData fields: file, docType, plus ONE of customerPoId / supplierPoId / piId.
 */
export async function uploadRecordDocument(formData: FormData): Promise<UploadResult> {
  const file = formData.get('file') as File | null;
  const docType = String(formData.get('docType') ?? 'OTHER');
  const customerPoId = (formData.get('customerPoId') as string | null) || null;
  const supplierPoId = (formData.get('supplierPoId') as string | null) || null;
  const piId = (formData.get('piId') as string | null) || null;
  /**
   * A work order is a valid anchor in its own right, not only something derived
   * from the paperwork. Escrow proof is the case that forced this: it belongs to
   * the job and its money movement, not to any of the four documents.
   */
  const directWorkOrderId = (formData.get('workOrderId') as string | null) || null;
  const title = String(formData.get('title') ?? 'Attached document');

  if (!customerPoId && !supplierPoId && !piId && !directWorkOrderId) {
    return { ok: false, message: 'There is nothing to attach this to yet.' };
  }
  const check = validate(file);
  if (!check.ok) return check.result;

  // Attach to the work order too when one already exists, so the file shows up
  // on the order's document list and not only against the paperwork.
  const workOrderId =
    directWorkOrderId ??
    (
      await db.workOrder.findFirst({
        where: {
          OR: [
            ...(customerPoId ? [{ customerPoId }] : []),
            ...(supplierPoId ? [{ supplierPoId }] : []),
          ],
        },
        select: { id: true },
      })
    )?.id ??
    null;

  const created = await db.document.create({
    data: {
      docType,
      title,
      fileName: file!.name,
      mimeType: file!.type || 'application/octet-stream',
      sizeBytes: file!.size,
      version: 1,
      customerPoId,
      supplierPoId,
      piId,
      workOrderId,
      uploadedBy: 'Akash Dwivedi',
      provenance: 'MANUAL',
    },
  });

  try {
    const stored = await storeFile(await file!.arrayBuffer(), {
      documentId: created.id,
      extension: check.extension,
    });
    await db.document.update({
      where: { id: created.id },
      data: { storagePath: stored.storagePath, sizeBytes: stored.sizeBytes },
    });
  } catch (err) {
    await db.document.delete({ where: { id: created.id } });
    return {
      ok: false,
      message: 'The file could not be saved.',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  await db.auditLogEntry.create({
    data: {
      workOrderId,
      entity: 'Document',
      entityId: created.id,
      action: 'CREATE',
      field: title,
      afterValue: `Uploaded "${file!.name}" (${(file!.size / 1024).toFixed(0)} KB)`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  safeRevalidate('/documents');
  if (workOrderId) safeRevalidate(`/orders/${workOrderId}`);
  return {
    ok: true,
    documentId: created.id,
    message: `${file!.name} attached.`,
    detail: withStorageNote(`Filed as ${title.toLowerCase()} and viewable from the order.`),
  };
}

/** Removes a document and the bytes behind it. */
export async function deleteDocument(documentId: string): Promise<UploadResult> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return { ok: false, message: 'That document is no longer there.' };

  if (doc.storagePath) await deleteStoredFile(doc.storagePath);
  await db.document.delete({ where: { id: documentId } });

  await db.auditLogEntry.create({
    data: {
      workOrderId: doc.workOrderId,
      entity: 'Document',
      entityId: documentId,
      action: 'DELETE',
      field: doc.stageId ?? undefined,
      beforeValue: `Removed "${doc.fileName}" (${doc.title})`,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });

  // Losing a required document takes the stage back to draft — the honest
  // outcome, because the evidence no longer supports the sign-off.
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

  if (doc.workOrderId) safeRevalidate(`/orders/${doc.workOrderId}`);
  return { ok: true, message: 'Document removed.', detail: 'The removal is on the audit log.' };
}
