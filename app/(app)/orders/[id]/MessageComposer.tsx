'use client';

/**
 * The composer behind "Log a communication", "Send message" and "Reply".
 *
 * One form, two intents. Logging records something that already happened;
 * sending records something going out now and marks the thread awaiting a reply.
 * Every field says in plain words what it is for, because the people using this
 * are not going to guess what "direction" means.
 *
 * It serves two places, and the order is fixed in both: the Control Tower's
 * order page and a team's view of that same order. What differs is who is
 * writing and whether it answers something. Rather than a second composer that
 * would drift from this one field by field, both are props — `fromTeam` names
 * the desk it is sent from, and `replyTo` threads it onto an existing message.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Send, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import { logCommunication } from '@/lib/actions/communication';
import { STAKEHOLDERS, STAKEHOLDER_META, isOneBuy, type Stakeholder } from '@/lib/domain/enums';
import { Button, SectionLabel } from '@/components/ui/Layout';
import { cn } from '@/lib/utils';

type Intent = 'LOG' | 'SEND';

/**
 * Outside parties first, then our own teams as internal notes.
 *
 * Naming the team matters now that there are five of them: "internal note" told
 * the reader nobody outside 1BUY would see it, but not whose desk it was for.
 */
const COUNTERPARTIES = [
  ...STAKEHOLDERS.filter((c) => !isOneBuy(c)).map((code) => ({
    code,
    label: `The ${STAKEHOLDER_META[code].label.toLowerCase()}`,
  })),
  ...STAKEHOLDERS.filter(isOneBuy).map((code) => ({
    code,
    label: `Internal note — ${STAKEHOLDER_META[code].short}`,
  })),
];

const CHANNELS = [
  { code: 'EMAIL', label: 'Email' },
  { code: 'PHONE', label: 'Phone call' },
  { code: 'WHATSAPP', label: 'WhatsApp' },
  { code: 'MEETING', label: 'Meeting' },
  { code: 'PORTAL', label: 'Their portal' },
  { code: 'COURIER', label: 'Courier / hard copy' },
] as const;

const field =
  'bg-surface-1 border-line-subtle focus:border-accent text-fg placeholder:text-fg-tertiary w-full rounded-[8px] border px-2.5 py-1.5 text-[13px] outline-none';

export function MessageComposer({
  workOrderId,
  orderAlias,
  intent,
  open,
  onOpenChange,
  fromTeam = 'ONE_BUY_SOURCING',
  replyTo,
}: {
  workOrderId: string;
  orderAlias: string;
  intent: Intent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which 1BUY desk this is from — decides attribution and where replies go. */
  fromTeam?: Stakeholder;
  /** The message being answered, when this composer opened as a reply. */
  replyTo?: { id: string; subject: string; counterpartyCode: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A reply goes back to whoever wrote, not to whatever the default was.
  const [counterparty, setCounterparty] = useState<string>(
    replyTo?.counterpartyCode ?? 'CUSTOMER',
  );
  // Sending is by definition outbound; logging could be either way.
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>(
    intent === 'SEND' ? 'OUTBOUND' : 'INBOUND',
  );
  const [channel, setChannel] = useState<string>('EMAIL');
  const [subject, setSubject] = useState(
    // "Re:" once, however many times a thread goes back and forth.
    replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : '',
  );
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(intent === 'SEND');
  const [needsReply, setNeedsReply] = useState(intent === 'SEND');

  const internal = isOneBuy(counterparty);
  const sending = intent === 'SEND';

  const submit = () => {
    setErrors({});
    startTransition(async () => {
      const res = await logCommunication({
        workOrderId,
        intent,
        fromTeam,
        replyToId: replyTo?.id,
        counterparty: counterparty as 'CUSTOMER',
        channel: channel as 'EMAIL',
        direction: internal ? 'INTERNAL' : direction,
        subject,
        body,
        shared,
        needsReply,
      });
      if (res.ok) {
        toast.success(res.message, { description: res.detail, duration: 9000 });
        setSubject('');
        setBody('');
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(res.errors ?? {});
        toast.error(res.message, { description: res.detail });
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="bg-surface-1 border-line shadow-e4 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border">
          <div className="border-line-subtle border-b px-5 py-3.5">
            <Dialog.Title className="text-fg flex items-center gap-2 text-[15px] font-semibold">
              {sending ? (
                <Send className="size-4 shrink-0" aria-hidden />
              ) : (
                <StickyNote className="size-4 shrink-0" aria-hidden />
              )}
              {sending ? 'Send a message' : 'Log a communication'}
            </Dialog.Title>
            <Dialog.Description className="text-fg-secondary mt-1 text-[12.5px] leading-relaxed">
              {sending
                ? `Recorded against ${orderAlias} and marked awaiting a reply. There is no mail connector configured, so you still send it from your own mail client — this is the record, not the delivery.`
                : `Records something that already happened on ${orderAlias} — a call, a meeting, or a message sent outside the platform — so the thread stays complete.`}
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-3.5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="min-w-0">
                  <SectionLabel>Who is at the other end</SectionLabel>
                  <select
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    className={field}
                  >
                    {COUNTERPARTIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-0">
                  <SectionLabel>How it happened</SectionLabel>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className={field}
                  >
                    {CHANNELS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Which way it went only makes sense with someone outside. */}
              {!internal && !sending && (
                <div className="min-w-0">
                  <SectionLabel>Which way it went</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['INBOUND', 'They contacted us'],
                        ['OUTBOUND', 'We contacted them'],
                      ] as const
                    ).map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setDirection(v)}
                        className={cn(
                          'rounded-[8px] border px-2.5 py-1.5 text-[12.5px] transition-colors',
                          direction === v
                            ? 'border-accent bg-accent-subtle text-accent-text font-medium'
                            : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="min-w-0">
                <SectionLabel>Subject</SectionLabel>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What this is about, in a line"
                  className={cn(field, errors.subject && 'border-danger')}
                />
                {errors.subject && (
                  <span className="text-danger mt-1 block text-[11.5px]">{errors.subject}</span>
                )}
              </label>

              <label className="min-w-0">
                <SectionLabel>{sending ? 'Message' : 'What was said'}</SectionLabel>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={7}
                  placeholder={
                    sending
                      ? 'Write the message as you want it to read.'
                      : 'Summarise what was agreed, asked or promised — enough that someone else could pick this up.'
                  }
                  className={cn(field, 'resize-y leading-relaxed', errors.body && 'border-danger')}
                />
                {errors.body && (
                  <span className="text-danger mt-1 block text-[11.5px]">{errors.body}</span>
                )}
              </label>

              {!internal && (
                <div className="grid gap-2">
                  <Check
                    checked={shared}
                    onChange={setShared}
                    label="Visible to the other party"
                    hint="Leave off to keep this an internal record of the exchange."
                  />
                  <Check
                    checked={needsReply}
                    onChange={setNeedsReply}
                    label="We are waiting on a reply"
                    hint="Shows the thread as awaiting a response, and counts toward the order's open items."
                  />
                </div>
              )}
            </div>
          </div>

          <div className="border-line-subtle flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="secondary" icon={X}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="primary"
              icon={sending ? Send : StickyNote}
              disabled={pending}
              onClick={submit}
            >
              {pending ? 'Recording…' : sending ? 'Record and mark sent' : 'Log it'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent mt-0.5 size-3.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="text-fg block text-[12.5px] font-medium">{label}</span>
        <span className="text-fg-tertiary block text-[11.5px] leading-relaxed">{hint}</span>
      </span>
    </label>
  );
}
