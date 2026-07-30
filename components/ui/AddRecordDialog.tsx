'use client';

/**
 * The Add button and its form, for every reference directory.
 *
 * The form is generated from the directory's own field declaration, so a new
 * field appears here the moment it is declared — there is no per-directory form
 * to forget to update. Every field that could puzzle a non-specialist carries
 * its explanation underneath rather than in a tooltip, because on a form you are
 * already typing, not hunting.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { createMasterRecord } from '@/lib/actions/masters';
import { masterForm, type MasterField } from '@/lib/domain/master-forms';
import { Button } from './Layout';
import { cn } from '@/lib/utils';

const input =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

function initialValues(fields: MasterField[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) {
    if (f.type === 'boolean') out[f.key] = f.defaultValue === true;
    else out[f.key] = f.defaultValue === undefined ? '' : String(f.defaultValue);
  }
  return out;
}

export function AddRecordButton({ type }: { type: string }) {
  const def = masterForm(type);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initialValues(def?.fields ?? []),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!def) return null;

  const set = (key: string, v: string | boolean) => setValues((p) => ({ ...p, [key]: v }));

  const reset = () => {
    setValues(initialValues(def.fields));
    setErrors({});
  };

  const submit = () => {
    setErrors({});
    startTransition(async () => {
      const res = await createMasterRecord(type, values);
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 8000 });
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail, duration: 9000 });
      }
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="primary" size="sm" icon={Plus}>
          Add
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(94vw,680px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <Dialog.Title className="text-fg flex items-center gap-2 text-[15px] font-semibold">
              <Plus className="size-4 shrink-0" aria-hidden />
              Add a {def.noun}
            </Dialog.Title>
            <Dialog.Description className="text-fg-secondary mt-1 text-[12.5px] leading-relaxed">
              {def.description}
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              {def.fields.map((f) => (
                <div
                  key={f.key}
                  className={cn('min-w-0', f.half ? 'sm:col-span-1' : 'sm:col-span-2')}
                >
                  {f.type === 'boolean' ? (
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={values[f.key] === true}
                        onChange={(e) => set(f.key, e.target.checked)}
                        className="accent-accent mt-0.5 size-3.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="text-fg block text-[12.5px] font-medium">{f.label}</span>
                        {f.help && (
                          <span className="text-fg-tertiary block text-[11.5px] leading-relaxed">
                            {f.help}
                          </span>
                        )}
                      </span>
                    </label>
                  ) : (
                    <label className="block min-w-0">
                      <span className="text-fg-secondary mb-1 block text-[11.5px] font-medium">
                        {f.label}
                        {f.required && <span className="text-danger ml-0.5">*</span>}
                      </span>
                      {f.type === 'select' ? (
                        <select
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => set(f.key, e.target.value)}
                          className={cn(input, errors[f.key] && 'border-danger')}
                        >
                          {!f.required && <option value="">Not set</option>}
                          {f.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => set(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          step={f.type === 'number' ? 'any' : undefined}
                          className={cn(input, errors[f.key] && 'border-danger')}
                        />
                      )}
                      {errors[f.key] ? (
                        <span className="text-danger mt-1 block text-[11.5px]">
                          {errors[f.key]}
                        </span>
                      ) : (
                        f.help && (
                          <span className="text-fg-tertiary mt-1 block text-[11.5px] leading-relaxed">
                            {f.help}
                          </span>
                        )
                      )}
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="primary" icon={Plus} disabled={pending} onClick={submit}>
              {pending ? 'Saving…' : `Add ${def.noun}`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
