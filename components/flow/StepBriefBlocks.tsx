'use client';

/**
 * The three things a step tile was not saying.
 *
 * WHO IS RESPONSIBLE — and on the legs and at the border, why: the delivery
 * term decides it, and the party performing the work is often not the party
 * bearing it. A carrier flies the consignment on FOB and on CIF; only the term
 * says whose cost that is.
 *
 * WHAT THIS STEP MAKES, AND WHAT IT IS WAITING ON — the same document list
 * split by who produces it, because "the packing list is missing" and "the
 * packing list is missing and the supplier owes it" are different amounts of
 * information and only the second can be acted on. Anything already filed opens
 * to the document itself.
 *
 * WHAT THE AGENT SUGGESTS — the next move in terms of this order's own state,
 * with a draft message where somebody outside owes us something. Rendered only
 * on the step the order is actually sitting on: guidance on a step nobody is
 * working is noise, and noise is what teaches people to stop reading it.
 */

import { useState } from 'react';
import {
  Bot,
  Check,
  ChevronRight,
  Clock,
  Copy,
  FileOutput,
  Inbox,
  ShieldQuestion,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StepBrief, StepDocument } from '@/lib/domain/step-brief';
import type { AgentBriefing, SuggestionKind } from '@/lib/domain/agent-guidance';
import { STAKEHOLDER_META } from '@/lib/domain/enums';
import { Chip, StakeholderBadge } from '@/components/ui/Badges';
import { Button } from '@/components/ui/Layout';
import { DocumentSheetDialog, type SheetDoc } from '@/components/documents/DocumentSheet';
import { cn, formatDate } from '@/lib/utils';

/** A document already filed against this step, matched to what was expected. */
export interface FiledDoc {
  id: string;
  docType: string;
  title: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  version: number;
  sizeBytes: number;
  bodyText: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function ResponsibleBlock({ brief }: { brief: StepBrief }) {
  const r = brief.responsibility;
  return (
    <div className="border-line-subtle bg-surface-1 mt-3 min-w-0 overflow-hidden rounded-[9px] border">
      <div className="text-fg-tertiary border-line-subtle flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
        <UserRound className="size-3" strokeWidth={2} aria-hidden />
        Entity responsible
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StakeholderBadge stakeholder={r.entity} />
          {r.term && (
            <Chip tone="neutral" size="sm">
              {r.term.side === 'BUY' ? 'Supplier terms' : 'Customer terms'} · {r.term.code}
            </Chip>
          )}
          {/*
            The party doing the work, where that is somebody else. Shown beside
            the bearer rather than instead of it — a tile naming only the carrier
            tells a desk the leg is not their problem on a term where it is.
          */}
          {r.executedBy && (
            <Chip tone="muted" size="sm">
              Performed by {STAKEHOLDER_META[r.executedBy].short}
            </Chip>
          )}
        </div>
        <p className="text-fg-secondary mt-1.5 text-[11.5px] leading-relaxed">{r.because}</p>
        {r.term && (
          <p className="text-fg-tertiary mt-1 text-[11px] leading-relaxed">{r.term.carries}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function StepDocumentsBlock({
  brief,
  filed,
  orderAlias,
}: {
  brief: StepBrief;
  filed: FiledDoc[];
  orderAlias: string;
}) {
  const [open, setOpen] = useState<SheetDoc | null>(null);

  const byType = new Map<string, FiledDoc>();
  for (const f of filed) byType.set(f.docType.toLowerCase(), f);

  const sheetFor = (d: StepDocument, f: FiledDoc): SheetDoc => ({
    id: f.id,
    docType: f.docType,
    kindLabel: d.label,
    title: f.title,
    fileName: f.fileName,
    uploadedBy: f.uploadedBy,
    createdAt: f.createdAt,
    version: f.version,
    sizeBytes: f.sizeBytes,
    stepLabel: `${brief.code} ${brief.label}`,
    orderAlias,
    bodyText: f.bodyText,
  });

  /*
   * Documents filed here that the step never asked for.
   *
   * The gate's expectations are a list of what SHOULD arrive; a real order also
   * accumulates things nobody planned for. Dropping them would make the tile
   * disagree with the register, which is how two views of the same order start
   * being checked against each other.
   */
  const expected = new Set([...brief.creates, ...brief.receives].map((d) => d.id.toLowerCase()));
  const unexpected = filed.filter((f) => !expected.has(f.docType.toLowerCase()));

  const section = (
    title: string,
    icon: typeof FileOutput,
    docs: StepDocument[],
    emptyNote: string,
  ) => {
    const Icon = icon;
    return (
      <div className="min-w-0">
        <div className="text-fg-tertiary flex items-center gap-1.5 px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
          <Icon className="size-3" strokeWidth={2} aria-hidden />
          {title}
          <span className="text-fg-tertiary/70 normal-case">({docs.length})</span>
        </div>
        {docs.length === 0 ? (
          <p className="text-fg-tertiary px-2.5 pb-2 text-[11px] leading-relaxed">{emptyNote}</p>
        ) : (
          <ul className="divide-line-subtle/70 divide-y border-t border-t-transparent">
            {docs.map((d) => {
              const f = byType.get(d.id.toLowerCase());
              return (
                <li key={d.id} className="min-w-0 px-2.5 py-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {f ? (
                      <button
                        type="button"
                        onClick={() => setOpen(sheetFor(d, f))}
                        className="text-accent-text min-w-0 flex-1 truncate text-left text-[11.5px] font-medium hover:underline"
                      >
                        {d.label}
                      </button>
                    ) : (
                      <span className="text-fg min-w-0 flex-1 truncate text-[11.5px] font-medium">
                        {d.label}
                      </span>
                    )}
                    {f ? (
                      <Chip tone="success" size="sm" icon={Check}>
                        Filed {formatDate(f.createdAt)}
                      </Chip>
                    ) : (
                      <Chip tone={d.required ? 'warning' : 'muted'} size="sm" icon={Clock}>
                        {d.required ? 'Outstanding' : 'Optional'}
                      </Chip>
                    )}
                  </div>
                  <p className="text-fg-tertiary mt-0.5 text-[10.5px] leading-relaxed">
                    <span className="font-medium">From {d.providerLabel}.</span> {d.why}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="border-line-subtle bg-surface-1 mt-2.5 min-w-0 divide-y divide-[color:var(--color-line-subtle)] overflow-hidden rounded-[9px] border">
        {section(
          'Created at this step',
          FileOutput,
          brief.creates,
          'This step produces no paperwork of its own.',
        )}
        {section(
          'Received at this step',
          Inbox,
          brief.receives,
          'Nothing is expected from anybody else here.',
        )}
        {unexpected.length > 0 && (
          <div className="min-w-0">
            <div className="text-fg-tertiary flex items-center gap-1.5 px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
              <ShieldQuestion className="size-3" strokeWidth={2} aria-hidden />
              Also filed here
              <span className="text-fg-tertiary/70 normal-case">({unexpected.length})</span>
            </div>
            <ul className="divide-line-subtle/70 divide-y">
              {unexpected.map((f) => (
                <li key={f.id} className="min-w-0 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setOpen({
                        id: f.id,
                        docType: f.docType,
                        kindLabel: f.docType,
                        title: f.title,
                        fileName: f.fileName,
                        uploadedBy: f.uploadedBy,
                        createdAt: f.createdAt,
                        version: f.version,
                        sizeBytes: f.sizeBytes,
                        stepLabel: `${brief.code} ${brief.label}`,
                        orderAlias,
                        bodyText: f.bodyText,
                      })
                    }
                    className="text-accent-text min-w-0 truncate text-left text-[11.5px] font-medium hover:underline"
                  >
                    {f.title}
                  </button>
                  <span className="text-fg-tertiary ml-2 text-[10.5px]">
                    filed by {f.uploadedBy}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DocumentSheetDialog doc={open} open={open !== null} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTION_TONE: Record<SuggestionKind, 'danger' | 'warning' | 'accent' | 'success' | 'muted'> = {
  DECIDE: 'warning',
  RECORD: 'accent',
  CHASE: 'warning',
  ADVANCE: 'success',
  HANDOVER: 'muted',
};

const SUGGESTION_WORD: Record<SuggestionKind, string> = {
  DECIDE: 'Needs a person',
  RECORD: 'Yours to do',
  CHASE: 'Chase',
  ADVANCE: 'Ready',
  HANDOVER: 'Next',
};

export function AgentCompanionBlock({ briefing }: { briefing: AgentBriefing }) {
  const [showDraft, setShowDraft] = useState(false);
  const draft = briefing.draft;

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      toast.success('Draft copied', { description: 'Read it before you send it.' });
    } catch {
      toast.error('Could not reach the clipboard.');
    }
  };

  return (
    <div className="border-accent-border bg-accent-subtle/40 mt-2.5 min-w-0 overflow-hidden rounded-[9px] border">
      <div className="text-accent-text border-accent-border/60 flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[0.05em] uppercase">
        <Sparkles className="size-3" strokeWidth={2} aria-hidden />
        What the agent suggests
      </div>

      <div className="min-w-0 px-2.5 py-2">
        <p className="text-fg text-[11.5px] leading-relaxed">{briefing.situation}</p>

        <ol className="mt-2 flex min-w-0 flex-col gap-1.5">
          {briefing.suggestions.map((s, i) => (
            <li key={`${s.kind}-${i}`} className="flex min-w-0 items-start gap-2">
              <Chip tone={SUGGESTION_TONE[s.kind]} size="sm">
                {SUGGESTION_WORD[s.kind]}
              </Chip>
              <span className="min-w-0 flex-1">
                <span className="text-fg block text-[11.5px] font-medium">{s.title}</span>
                <span className="text-fg-secondary block text-[10.5px] leading-relaxed">
                  {s.because}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {draft && (
          <div className="border-accent-border/60 mt-2.5 border-t pt-2">
            <button
              type="button"
              onClick={() => setShowDraft((o) => !o)}
              aria-expanded={showDraft}
              className="text-accent-text flex items-center gap-1.5 text-[11.5px] font-medium"
            >
              <ChevronRight
                className={cn('size-3.5 shrink-0 transition-transform', showDraft && 'rotate-90')}
                strokeWidth={2}
                aria-hidden
              />
              A message to {draft.toLabel} is drafted
            </button>

            {showDraft && (
              <div className="mt-2 min-w-0">
                <div className="border-line-subtle bg-surface-1 min-w-0 rounded-[8px] border p-2.5">
                  <p className="text-fg text-[11.5px] font-semibold">{draft.subject}</p>
                  <pre className="text-fg-secondary mt-1.5 font-sans text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                    {draft.body}
                  </pre>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <Button variant="secondary" icon={Copy} onClick={copy}>
                    Copy the draft
                  </Button>
                  {/*
                    Said out loud, every time. The agent assembles and a person
                    sends — an agent that mails a counterparty on its own
                    authority is a different product with a different risk
                    profile, and the moment somebody assumes it already went is
                    the moment this stops being useful.
                  */}
                  <span className="text-fg-tertiary text-[10.5px] leading-relaxed">
                    Nothing is sent from here. {draft.basedOn}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-fg-tertiary border-accent-border/60 mt-2.5 flex items-start gap-1.5 border-t pt-2 text-[10.5px] leading-relaxed">
          <Bot className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Derived from this order&rsquo;s own state — the stage it sits on, the fields still
            blank and the documents still owed. The desk keeps the decision; the agent removes the
            lookup.
          </span>
        </p>
      </div>
    </div>
  );
}
