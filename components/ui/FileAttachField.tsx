'use client';

/**
 * Choosing files to attach to something that does not exist yet.
 *
 * On a create form there is nothing to attach to until the record is saved, so
 * this holds the chosen files client-side and the parent uploads them once it
 * has an id. That ordering matters: uploading first would leave orphaned files
 * behind every abandoned form.
 */

import { FileUp, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ACCEPTED_UPLOAD_TYPES =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.doc,.docx,.csv,.txt';

export function FileAttachField({
  label,
  help,
  files,
  onChange,
  className,
}: {
  label: string;
  help: string;
  files: File[];
  onChange: (files: File[]) => void;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">{label}</span>

      <label
        className={cn(
          'border-line-subtle hover:border-line-strong hover:bg-surface-3 flex cursor-pointer items-center gap-2 rounded-[8px] border border-dashed px-3 py-2.5 transition-colors',
        )}
      >
        <FileUp className="text-fg-tertiary size-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="text-fg-secondary text-[12.5px]">
          {files.length === 0
            ? 'Choose a PDF or scan'
            : `${files.length} file${files.length === 1 ? '' : 's'} chosen — add another`}
        </span>
        <input
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_TYPES}
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) onChange([...files, ...picked]);
            e.target.value = '';
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-1.5 grid gap-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="border-line-subtle bg-surface-inset flex min-w-0 items-center gap-2 rounded-[7px] border px-2.5 py-1.5"
            >
              <Paperclip className="text-fg-tertiary size-3.5 shrink-0" aria-hidden />
              <span className="text-fg min-w-0 flex-1 truncate font-mono text-[11px]">{f.name}</span>
              <span className="text-fg-tertiary shrink-0 text-[10.5px]">
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="text-fg-tertiary hover:text-danger shrink-0 transition-colors"
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">{help}</span>
    </div>
  );
}

/**
 * Uploads the chosen files against a record that now exists. Returns how many
 * landed, so the caller can tell the operator rather than failing silently.
 */
export async function uploadChosenFiles(
  files: File[],
  target: { customerPoId?: string; supplierPoId?: string; piId?: string },
  docType: string,
  title: string,
  upload: (fd: FormData) => Promise<{ ok: boolean; message: string; detail?: string }>,
): Promise<{ uploaded: number; failed: { name: string; message: string }[] }> {
  const failed: { name: string; message: string }[] = [];
  let uploaded = 0;
  for (const file of files) {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('docType', docType);
    fd.set('title', title);
    if (target.customerPoId) fd.set('customerPoId', target.customerPoId);
    if (target.supplierPoId) fd.set('supplierPoId', target.supplierPoId);
    if (target.piId) fd.set('piId', target.piId);
    const res = await upload(fd);
    if (res.ok) uploaded++;
    else failed.push({ name: file.name, message: res.detail ?? res.message });
  }
  return { uploaded, failed };
}
