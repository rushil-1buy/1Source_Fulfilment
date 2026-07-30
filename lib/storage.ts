import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded files live.
 *
 * Deliberately OUTSIDE `public/`. These are commercial documents — signed test
 * reports, bills of entry, bank advices — and anything under `public/` is served
 * to whoever guesses the URL. They are read back through a route handler
 * instead, which is where an access check belongs once roles are enforced.
 *
 * A local directory is the right call for a self-hosted build: it needs no
 * external service, survives a restart, and swapping it for object storage means
 * replacing these four functions and nothing else.
 *
 * ON A SERVERLESS HOST IT IS NOT DURABLE. Vercel's filesystem is ephemeral and
 * per-invocation, so a written file is gone by the next request. Rather than
 * accept an upload and lose it — which looks like success and is not — uploads
 * are refused there with an explanation. Silent data loss on a signed inspection
 * report is far worse than an honest refusal.
 */
const ROOT = path.join(process.cwd(), '.uploads');

/**
 * True where the filesystem does not survive the request. Vercel sets VERCEL=1
 * in every runtime; other serverless hosts would need adding here.
 */
export const DURABLE_STORAGE = !process.env.VERCEL;

/** Why uploads are unavailable, for the message the operator actually sees. */
export const NO_STORAGE_REASON =
  'This deployment has no document storage configured. Its filesystem is ephemeral, so an uploaded file would be lost between requests. Connect object storage (Vercel Blob or S3) to enable uploads — everything else on the order works as normal.';

/** 20 MB. A scanned purchase order is well under this; a video is not a document. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * What we accept. Restricted on purpose — this is a document store, and an
 * allow-list is the only sane way to stop it becoming a general file dump.
 */
export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

export function extensionFor(mimeType: string, fileName: string): string | null {
  const byMime = ALLOWED_MIME[mimeType];
  if (byMime) return byMime;
  // Some browsers send an empty type for a drag-and-dropped file, so fall back
  // to the name — but only to an extension we already allow.
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  return Object.values(ALLOWED_MIME).includes(ext) ? ext : null;
}

export interface StoredFile {
  /** Relative to the storage root — what goes in Document.storagePath. */
  storagePath: string;
  sizeBytes: number;
}

/** Writes the bytes and returns where they went. */
export async function storeFile(
  bytes: ArrayBuffer | Uint8Array,
  opts: { documentId: string; extension: string },
): Promise<StoredFile> {
  if (!DURABLE_STORAGE) throw new Error(NO_STORAGE_REASON);
  // One directory per document id, so a superseding upload of the same slot
  // cannot collide with the version it replaces.
  const dir = path.join(ROOT, opts.documentId);
  await mkdir(dir, { recursive: true });
  const rel = path.join(opts.documentId, `file.${opts.extension}`);
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await writeFile(path.join(ROOT, rel), buf);
  return { storagePath: rel, sizeBytes: buf.byteLength };
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  // Refuse anything that tries to climb out of the storage root.
  const resolved = path.resolve(ROOT, storagePath);
  if (!resolved.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error('Refused: that path is outside the document store.');
  }
  return readFile(resolved);
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  const resolved = path.resolve(ROOT, storagePath);
  if (!resolved.startsWith(path.resolve(ROOT) + path.sep)) return;
  await unlink(resolved).catch(() => {
    /* already gone — nothing to undo */
  });
}
