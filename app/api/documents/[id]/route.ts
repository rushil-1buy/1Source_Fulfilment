import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readStoredFile } from '@/lib/storage';

/**
 * Serves an uploaded document.
 *
 * Files are stored outside `public/` on purpose (see lib/storage.ts), so this is
 * the only way to read one back. That makes it the natural place for an access
 * check once roles are enforced — the TODO is deliberate and marked.
 *
 * `?download=1` forces a save dialog; the default is inline, so a PDF opens in
 * the browser's own viewer and can be read without leaving the app.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = await db.document.findUnique({
    where: { id },
    select: { fileName: true, mimeType: true, storagePath: true, bodyText: true },
  });

  if (!doc) {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  // TODO(rbac): once roles are enforced, check the caller may see this order's
  // documents before returning bytes.

  if (!doc.storagePath) {
    // Seeded and generated documents hold renderable text rather than a file.
    if (doc.bodyText) {
      return new NextResponse(doc.bodyText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        },
      });
    }
    return NextResponse.json(
      {
        error:
          'This document has no uploaded file. It was recorded as a reference rather than attached.',
      },
      { status: 404 },
    );
  }

  try {
    const bytes = await readStoredFile(doc.storagePath);
    const download = new URL(request.url).searchParams.get('download') === '1';
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(doc.fileName)}"`,
        // Commercial paperwork should not sit in a shared cache.
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'The file is recorded but its contents could not be read from storage.' },
      { status: 410 },
    );
  }
}
