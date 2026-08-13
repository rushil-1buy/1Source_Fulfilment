'use client';

/**
 * THE FLOW RAIL — master prompt §5. The product's centrepiece.
 *
 * A dumb renderer over `railStates()` / `phaseProgress()` from lib/domain/stages
 * — all logic lives there, so the rail can never disagree with the state machine.
 *
 * §5.2: six visual states, every one distinguishable WITHOUT relying on colour
 * alone (each pairs colour with a distinct icon and a text label).
 * §5.3: pulsation to the exact specified numbers, with a reduced-motion fallback
 * that swaps the pulse for a static high-contrast ring plus a text badge.
 * §5.4: hover detail, click-to-deep-link, phase grouping, a "who owns it" toggle
 * that NAMES the responsible party under each stage (colour alone cannot say
 * "Customs Agent"), and a persistent Next Action call-to-action.
 */

import { useCallback, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  Clock,
  GripVertical,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Users,
  Workflow,
  Scale,
} from 'lucide-react';
import {
  PHASES,
  PHASE_DEFS,
  assessSla,
  getStage,
  phaseProgress,
  railStates,
  resolveRailAnchor,
  type PhaseId,
  type PhasePlan,
  type StageContext,
  type StageDef,
  type StageVisualState,
  stageOwner,
  stageNextActionOwner,
} from '@/lib/domain/stages';
import {
  isDefaultPlan,
  normalisePhasePlan,
  phaseEditability,
  type PhaseEditability,
} from '@/lib/domain/phase-plan';
import { STAKEHOLDER_META, type Stakeholder } from '@/lib/domain/enums';
import { inboundChain } from '@/lib/domain/incoterms';
import { stageLiability } from '@/lib/domain/stage-liability';
import { cn, humanDuration, relativeTime } from '@/lib/utils';
import { StakeholderBadge, StakeholderDot } from '@/components/ui/Badges';
import { usePreferences } from '@/components/providers/Preferences';

export interface FlowRailData {
  currentStage: string;
  ctx: StageContext;
  isBlocked: boolean;
  blockReason?: string | null;
  /** ISO string — props crossing the server/client boundary stay serializable. */
  stageEnteredAt: string;
  completedStageIds: string[];
  transitions?: { toStage: string; createdAt: string; actorLabel: string }[];
  /**
   * Steps added by hand to THIS order, keyed to the standard stage they follow.
   * Drawn distinctly — see ManualStepNode for why that matters.
   */
  customStages?: ManualStep[];
}

/**
 * Everything the rail needs to let an operator re-plan the flow by dragging the
 * phase tiles.
 *
 * Passed as one bag rather than eight loose props because the pieces are useless
 * apart — and omitted entirely on the read-only rails (dashboard, orders list),
 * which is what keeps drag handling out of those.
 */
export interface FlowPlanControls {
  /** The arrangement on screen — the draft if there is one, else what is saved. */
  value: PhasePlan;
  /** The arrangement last saved, so pending changes can be marked as pending. */
  saved: PhasePlan;
  /** In edit mode the tiles gain grips and remove buttons. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** A drag, a removal or a restore. Not persisted until the operator reviews it. */
  onPropose: (next: PhasePlan) => void;
  /** Opens the review dialog, where the reason is given and the save happens. */
  onReview: () => void;
  onDiscard: () => void;
  /** Locked out entirely — a closed or cancelled order. */
  disabled?: boolean;
  disabledReason?: string;
}

/** A step that exists on one order only. Never part of the 39-stage ladder. */
export interface ManualStep {
  id: string;
  afterStageId: string;
  phase: string;
  label: string;
  reason: string;
  owner: string;
  exitCriteria: string | null;
  expectedHours: number;
  /** PENDING | DONE | SKIPPED — whether the step has been carried out. */
  status: string;
  /**
   * PENDING_APPROVAL | APPROVED | REJECTED — whether it belongs in the flow at
   * all. Separate from `status`: a step can be agreed but not yet done, and one
   * nobody agreed to must not be able to claim it is done.
   */
  approval: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  blocking: boolean;
  sequence: number;
  completedBy: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
}

// ── Per-state presentation. Icon + label carry the meaning; colour reinforces. ──

const STATE_META: Record<
  StageVisualState,
  { label: string; icon: typeof Check; core: string; ring: string; text: string }
> = {
  COMPLETED: {
    label: 'Done',
    icon: Check,
    core: 'bg-success border-success text-success-fg',
    ring: 'bg-success',
    text: 'text-fg-secondary',
  },
  CURRENT: {
    label: 'Currently here',
    icon: Circle,
    core: 'bg-accent border-accent text-accent-fg',
    ring: 'bg-accent',
    text: 'text-fg font-semibold',
  },
  BLOCKED: {
    label: 'Blocked',
    icon: AlertTriangle,
    core: 'bg-danger border-danger text-danger-fg',
    ring: 'bg-danger',
    text: 'text-danger font-semibold',
  },
  AT_RISK: {
    label: 'Running late',
    icon: Clock,
    core: 'bg-warning border-warning text-warning-fg',
    ring: 'bg-warning',
    text: 'text-warning font-semibold',
  },
  UPCOMING: {
    label: 'Not started',
    icon: Circle,
    core: 'bg-surface-1 border-line-strong text-fg-tertiary border-dashed',
    ring: 'bg-line-strong',
    text: 'text-fg-tertiary',
  },
  SKIPPED: {
    label: 'Skipped',
    icon: Minus,
    core: 'bg-surface-3 border-line text-fg-tertiary border-dotted',
    ring: 'bg-line',
    text: 'text-fg-tertiary line-through decoration-[1.5px]',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Full horizontal rail — order detail
// ═══════════════════════════════════════════════════════════════════════════

export function FlowRail({
  data,
  onStageClick,
  onInsertStep,
  onManualStepClick,
  plan,
  className,
}: {
  data: FlowRailData;
  onStageClick?: (stageId: string) => void;
  /**
   * Asked for when the operator clicks a + between two cells. `afterCustomStageId`
   * is the manual step immediately to the left, or null when the left neighbour
   * is the standard stage itself — together they name the exact gap.
   */
  onInsertStep?: (afterStageId: string, afterCustomStageId: string | null) => void;
  onManualStepClick?: (step: ManualStep) => void;
  /** Omit to render a read-only rail with no flow editing at all. */
  plan?: FlowPlanControls;
  className?: string;
}) {
  const enteredAt = useMemo(() => new Date(data.stageEnteredAt), [data.stageEnteredAt]);
  const states = useMemo(
    () =>
      railStates({
        currentStage: data.currentStage,
        ctx: data.ctx,
        isBlocked: data.isBlocked,
        stageEnteredAt: enteredAt,
        completedStageIds: data.completedStageIds,
      }),
    [data, enteredAt],
  );
  const phases = useMemo(
    () =>
      phaseProgress({
        currentStage: data.currentStage,
        ctx: data.ctx,
        isBlocked: data.isBlocked,
        stageEnteredAt: enteredAt,
        completedStageIds: data.completedStageIds,
      }),
    [data, enteredAt],
  );

  // Anchor via resolveRailAnchor so a blocked order on an exception branch still
  // opens on the phase it is actually stuck in.
  const anchor = useMemo(() => resolveRailAnchor(data.currentStage), [data.currentStage]);
  const currentPhase = getStage(anchor.anchorStageId).phase as PhaseId;
  const [expanded, setExpanded] = useState<PhaseId>(currentPhase);
  const [swimlanes, setSwimlanes] = useState(false);

  const expandedStages = states.filter((s) => s.stage.phase === expanded);
  /**
   * Where a requested step lands by default: after the last stage of the phase
   * being viewed. The dialog lets the requester move it, so this only has to be a
   * sensible starting point rather than a guess at intent.
   */
  const lastStageOfPhase =
    expandedStages[expandedStages.length - 1]?.stage.id ?? states[0]?.stage.id ?? '';

  // ── Re-planning the flow ────────────────────────────────────────────────────

  /** What this order may still change, keyed by phase. Empty when not editable. */
  const editability = useMemo(() => {
    const map = new Map<PhaseId, PhaseEditability>();
    if (!plan) return map;
    for (const e of phaseEditability(plan.value, currentPhase)) map.set(e.phase, e);
    return map;
  }, [plan, currentPhase]);

  /** Phases whose position or inclusion differs from what is saved. */
  const pendingPhases = useMemo(() => {
    const out = new Set<PhaseId>();
    if (!plan) return out;
    const saved = normalisePhasePlan(plan.saved);
    const live = normalisePhasePlan(plan.value);
    for (const [i, e] of live.entries()) {
      const was = saved[i];
      if (!was || was.phase !== e.phase) out.add(e.phase);
      if (saved.find((s) => s.phase === e.phase)?.skipped !== e.skipped) out.add(e.phase);
    }
    return out;
  }, [plan]);

  const [dragPhase, setDragPhase] = useState<PhaseId | null>(null);

  /**
   * Moves a phase to a new index in the flow.
   *
   * Runs the result through normalisePhasePlan rather than trusting the splice, so
   * a drop that would put a phase somewhere it cannot go (ahead of the structural
   * phases, past the terminal one) is corrected in place instead of producing an
   * arrangement the server would then reject.
   */
  const movePhase = useCallback(
    (phase: PhaseId, toIndex: number) => {
      if (!plan) return;
      const current = normalisePhasePlan(plan.value);
      const from = current.findIndex((e) => e.phase === phase);
      if (from < 0 || from === toIndex) return;
      const next = [...current];
      const [lifted] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, lifted);
      const settled = normalisePhasePlan(next);
      // Nothing actually moved once the rules were applied — don't report a change.
      if (settled.map((e) => e.phase).join('') === current.map((e) => e.phase).join('')) return;
      plan.onPropose(settled);
    },
    [plan],
  );

  const toggleCurtail = useCallback(
    (phase: PhaseId) => {
      if (!plan) return;
      plan.onPropose(
        normalisePhasePlan(
          plan.value.map((e) => (e.phase === phase ? { ...e, skipped: !e.skipped } : e)),
        ),
      );
    },
    [plan],
  );

  /** Alt+Arrow nudges a phase along the row — the keyboard equivalent of a drag. */
  const nudge = useCallback(
    (phase: PhaseId, delta: -1 | 1) => {
      if (!plan) return;
      const idx = normalisePhasePlan(plan.value).findIndex((e) => e.phase === phase);
      if (idx < 0) return;
      movePhase(phase, idx + delta);
    },
    [plan, movePhase],
  );

  const editing = Boolean(plan?.editing && !plan.disabled);
  const dirty = pendingPhases.size > 0;

  /**
   * The row is built as a flat list of cells rather than one cell per stage, so
   * a manually inserted step occupies a real track of its own. It therefore
   * cannot overlap the stage before it, and the connector maths keeps working
   * unchanged — the line still runs from one cell's centre to the next's.
   */
  const cells = useMemo(() => {
    const manual = data.customStages ?? [];
    const out: (
      | { kind: 'stage'; key: string; item: (typeof expandedStages)[number] }
      | { kind: 'manual'; key: string; step: ManualStep }
    )[] = [];
    for (const item of expandedStages) {
      out.push({ kind: 'stage', key: item.stage.id, item });
      for (const step of manual
        .filter((m) => m.afterStageId === item.stage.id)
        .sort((a, b) => a.sequence - b.sequence)) {
        out.push({ kind: 'manual', key: step.id, step });
      }
    }
    return out;
  }, [expandedStages, data.customStages]);

  const transitionByStage = useMemo(() => {
    const map = new Map<string, { createdAt: string; actorLabel: string }>();
    for (const t of data.transitions ?? []) {
      map.set(t.toStage, { createdAt: t.createdAt, actorLabel: t.actorLabel });
    }
    return map;
  }, [data.transitions]);

  return (
    <Tooltip.Provider delayDuration={150}>
      {/* @container so the two grids below respond to the width they actually
          have. Keying off the viewport was wrong: the sidebar takes ~215px, so a
          790px window left the phase strip scrolling with its last tile off
          screen and every label truncated. */}
      <div
        className={cn('bg-surface-1 border-line-subtle @container rounded-[12px] border', className)}
      >
        {plan && (
          <FlowPlanBar
            plan={plan}
            editing={editing}
            dirty={dirty}
            pendingCount={pendingPhases.size}
          />
        )}

        {/* Phase strip — wraps to fill the full width; nothing scrolls, nothing
            is cut off, and labels wrap onto a second line instead of truncating. */}
        {/* flex-wrap with grow, not a fixed grid: the tiles on the final row
            stretch to consume the remaining width, so every row runs edge to edge
            with no dead cell at the end. */}
        <div
          className="flex flex-wrap items-stretch gap-1.5 p-2.5"
          // Dropping on the gaps between tiles would otherwise fall through to the
          // browser's default, which navigates away on some platforms.
          onDragOver={editing ? (e) => e.preventDefault() : undefined}
          onDrop={editing ? (e) => e.preventDefault() : undefined}
        >
          {phases.map((p, i) => {
            const meta = STATE_META[p.state];
            const isExpanded = expanded === p.phase.id;
            const rule = editability.get(p.phase.id);
            const canDrag = editing && Boolean(rule?.canMove);
            const isPending = pendingPhases.has(p.phase.id);
            const isDragging = dragPhase === p.phase.id;
            return (
              <button
                key={p.phase.id}
                type="button"
                onClick={() => setExpanded(p.phase.id)}
                aria-expanded={isExpanded}
                draggable={canDrag}
                onDragStart={
                  canDrag
                    ? (e) => {
                        setDragPhase(p.phase.id);
                        e.dataTransfer.effectAllowed = 'move';
                        // Firefox refuses to start a drag with an empty payload.
                        e.dataTransfer.setData('text/plain', p.phase.id);
                      }
                    : undefined
                }
                onDragEnd={canDrag ? () => setDragPhase(null) : undefined}
                onDragOver={
                  editing && dragPhase && dragPhase !== p.phase.id
                    ? (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        // Reordered on hover rather than on drop, so the row shows
                        // the arrangement being proposed while the tile is still in
                        // the air. A drop indicator would show the same thing with
                        // an extra translation step for the operator to do.
                        movePhase(dragPhase, i);
                      }
                    : undefined
                }
                onDrop={
                  editing
                    ? (e) => {
                        e.preventDefault();
                        setDragPhase(null);
                      }
                    : undefined
                }
                onKeyDown={
                  canDrag
                    ? (e) => {
                        // Alt, not a bare arrow: bare arrows still have to move
                        // focus along the strip.
                        if (!e.altKey) return;
                        if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          nudge(p.phase.id, -1);
                        } else if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          nudge(p.phase.id, 1);
                        }
                      }
                    : undefined
                }
                aria-label={
                  editing
                    ? `Phase ${p.phase.id}, ${p.phase.label}, position ${i + 1} of ${phases.length}.${
                        canDrag
                          ? ' Hold Alt and press the left or right arrow to move it.'
                          : ` Fixed: ${rule?.lockedBecause ?? ''}`
                      }`
                    : undefined
                }
                className={cn(
                  'group relative flex min-w-0 flex-1 basis-[148px] flex-col rounded-[9px] border px-2.5 py-2 text-left transition-colors',
                  isExpanded
                    ? 'border-accent-border bg-accent-subtle'
                    : 'border-line-subtle hover:bg-surface-3 bg-transparent',
                  canDrag && 'cursor-grab active:cursor-grabbing',
                  isDragging && 'opacity-40',
                  // A pending change is marked by a ring, not by colour alone —
                  // the tile already uses colour to say what state the phase is in.
                  isPending && 'ring-accent ring-offset-surface-1 ring-2 ring-offset-1',
                  p.curtailed && 'border-dashed opacity-60',
                )}
              >
                {editing && (
                  <span className="text-fg-tertiary absolute top-1 right-1 flex items-center gap-0.5">
                    {rule?.canMove ? (
                      <GripVertical className="size-3 rotate-90" strokeWidth={2} aria-hidden />
                    ) : (
                      <Lock className="size-2.5" strokeWidth={2.5} aria-hidden />
                    )}
                  </span>
                )}
                <div className="flex items-start gap-1.5">
                  <span
                    className={cn(
                      'mt-px grid size-4 shrink-0 place-items-center rounded-full border text-[9px]',
                      meta.core,
                    )}
                    aria-hidden
                  >
                    {p.state === 'COMPLETED' ? (
                      <Check className="size-2.5" strokeWidth={3} />
                    ) : (
                      p.phase.id
                    )}
                  </span>
                  {/* The full phase name always reads in full — a stage tracker
                      that says "Inspection &amp; …" tells the operator nothing. */}
                  <span className="text-fg min-w-0 text-[11.5px] leading-[1.25] font-semibold text-balance">
                    {p.phase.label}
                  </span>
                </div>
                {/* Pushes the progress bar to the bottom so tiles whose labels wrap
                    onto two lines still align their bars with the rest. */}
                <div className="mt-auto flex items-center gap-2 pt-1.5">
                  <div className="bg-surface-3 h-1 flex-1 overflow-hidden rounded-full">
                    <div
                      className={cn('h-full rounded-full transition-[width]', meta.ring)}
                      style={{ width: p.total ? `${(p.done / p.total) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-fg-tertiary tnum text-[10px]">
                    {p.done}/{p.total}
                  </span>
                </div>
                {/* Which phase is live, without relying on colour. A curtailed
                    phase says so here, since its progress bar reads 0/0 and would
                    otherwise be indistinguishable from one not yet started. */}
                {p.curtailed ? (
                  <span className="text-fg-tertiary mt-1 inline-block text-[9.5px] font-semibold tracking-wide uppercase">
                    Removed
                  </span>
                ) : (
                  (p.state === 'CURRENT' || p.state === 'BLOCKED' || p.state === 'AT_RISK') && (
                    <span
                      className={cn(
                        'mt-1 inline-block text-[9.5px] font-semibold tracking-wide uppercase',
                        p.state === 'BLOCKED'
                          ? 'text-danger'
                          : p.state === 'AT_RISK'
                            ? 'text-warning'
                            : 'text-accent-text',
                      )}
                    >
                      {STATE_META[p.state].label}
                    </span>
                  )
                )}
                {/* Only shown when all seven phases sit on one row — once the grid
                    wraps, a rightward chevron on a row-end tile points at nothing.
                    Hidden in edit mode, where the arrows would fight the grips for
                    the same few pixels. */}
                {i < phases.length - 1 && !editing && (
                  <span
                    className="text-fg-tertiary absolute top-1/2 -right-[8px] z-10 hidden -translate-y-1/2 @[860px]:block"
                    aria-hidden
                  >
                    <ChevronDown className="size-3 -rotate-90" strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {plan && editing && (
          <FlowPlanEditor
            phases={phases}
            editability={editability}
            pendingPhases={pendingPhases}
            onToggleCurtail={toggleCurtail}
            onNudge={nudge}
          />
        )}

        {/* Expanded phase: the stage nodes */}
        <div className="border-line-subtle border-t">
          <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
            <div className="min-w-0">
              <div className="text-fg text-[12.5px] font-semibold">
                Phase {expanded} · {PHASE_DEFS[expanded].label}
              </div>
              <div className="text-fg-tertiary text-[11.5px]">
                {PHASE_DEFS[expanded].description}
                {/* Phase E's chain depends on the term we bought on. The other
                    phases do not move with the Incoterm, so they keep the fixed
                    line. Printing "Customs Agent" on a DDP order named a party
                    that is not involved. */}
                <span className="text-fg-tertiary/70">
                  {' · Owner: '}
                  {expanded === 'E' ? inboundChain(data.ctx.incoterms) : PHASE_DEFS[expanded].owner}
                </span>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSwimlanes((s) => !s)}
                aria-pressed={swimlanes}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors',
                  swimlanes
                    ? 'border-accent-border bg-accent-subtle text-accent-text'
                    : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
                )}
              >
                <Users className="size-3.5" strokeWidth={2} aria-hidden />
                <span className="hidden @[520px]:inline">Who owns it</span>
              </button>
              {/* Adding a step is rare and consequential, so it gets ONE quiet
                  control rather than a + in every gap. The old handles put six
                  affordances on a rail whose job is to show state, and made an
                  action that needs approval look like a casual one. */}
              {onInsertStep && (
                <button
                  type="button"
                  onClick={() => onInsertStep(lastStageOfPhase, null)}
                  className="text-fg-tertiary hover:bg-surface-3 hover:text-fg-secondary flex shrink-0 items-center gap-1.5 rounded-[7px] px-2 py-1 text-[11.5px] transition-colors"
                  title="Request an extra step in this phase. It needs approval before it joins the flow."
                >
                  <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                  <span className="hidden @[640px]:inline">Request a step</span>
                </button>
              )}
            </span>
          </div>

          {/* One row of equal tracks, always. The stages of a phase divide the
              width between them, so the row runs edge to edge with no scrolling —
              and because it never wraps, a connector can never trail off the end
              of a line into empty space. Narrow screens get VerticalRail instead
              (see ResponsiveFlowRail), which is the honest layout down there. */}
          <div className="px-3 pt-4 pb-3">
            <ol
              className="group/rail grid items-start gap-x-0"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, minmax(0, 1fr))`,
              }}
            >
              {cells.map((cell, i) => {
                const next = cells[i + 1];
                const isLast = i === cells.length - 1;
                return (
                  <li key={cell.key} className="relative flex min-w-0 flex-col items-center">
                    {!isLast && (
                      <Connector
                        // The segment flowing INTO the current node gets the sheen.
                        active={cellState(next) === 'CURRENT'}
                        done={cellState(cell) === 'COMPLETED'}
                        diverted={cellState(next) === 'BLOCKED'}
                        skipped={cellState(cell) === 'SKIPPED' || cellState(next) === 'SKIPPED'}
                        manual={cell.kind === 'manual' || next.kind === 'manual'}
                      />
                    )}
                    {cell.kind === 'stage' ? (
                      <StageNode
                        stage={cell.item.stage}
                        state={cell.item.state}
                        owner={stageOwner(cell.item.stage, data.ctx)}
                        nextActionOwner={stageNextActionOwner(cell.item.stage, data.ctx)}
                        skipReason={cell.item.skipReason}
                        enteredAt={
                          cell.item.state !== 'UPCOMING'
                            ? transitionByStage.get(cell.item.stage.id)
                            : undefined
                        }
                        stageEnteredAt={
                          cell.item.stage.id === anchor.anchorStageId ? enteredAt : undefined
                        }
                        blockReason={
                          cell.item.state === 'BLOCKED'
                            ? (data.blockReason ??
                              (anchor.branch
                                ? `${anchor.branch.label} — ${anchor.branch.description}`
                                : null))
                            : undefined
                        }
                        branchLabel={
                          cell.item.state === 'BLOCKED' ? anchor.branch?.label : undefined
                        }
                        showSwimlane={swimlanes}
                        onClick={onStageClick ? () => onStageClick(cell.item.stage.id) : undefined}
                      />
                    ) : (
                      <ManualStepNode
                        step={cell.step}
                        showSwimlane={swimlanes}
                        onClick={
                          onManualStepClick ? () => onManualStepClick(cell.step) : undefined
                        }
                      />
                    )}
                    {/* Rendered as a SIBLING of the node, not inside it: the node
                        is already a button, and a button inside a button is
                        invalid and swallows the inner click. */}
                    {swimlanes && cell.kind === 'stage' && (
                      <RailLiability stageId={cell.item.stage.id} ctx={data.ctx} />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* No legend when owners are named: the names ARE the key, and a second
              copy of the same information is just something else to read. */}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

// ── Re-planning the flow ────────────────────────────────────────────────────

/**
 * The header above the phase strip: enters and leaves edit mode, and while there
 * are unsaved changes says so and offers the only two ways out.
 *
 * Deliberately not an auto-save. Re-planning a flow takes several drags, and the
 * intermediate arrangements are not decisions — committing each one would fill the
 * audit log with arrangements nobody chose.
 */
function FlowPlanBar({
  plan,
  editing,
  dirty,
  pendingCount,
}: {
  plan: FlowPlanControls;
  editing: boolean;
  dirty: boolean;
  pendingCount: number;
}) {
  // Whether the SAVED flow already departs from the standard ladder — separate
  // from `dirty`, which is about unsaved edits.
  const deviates = !isDefaultPlan(normalisePhasePlan(plan.saved));

  if (plan.disabled) {
    return (
      <div className="border-line-subtle text-fg-tertiary flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[11px]">
        <Lock className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        {plan.disabledReason ?? 'This order’s flow can no longer be changed.'}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2.5 py-1.5',
        dirty ? 'border-accent-border bg-accent-subtle' : 'border-line-subtle',
      )}
    >
      {dirty ? (
        <>
          <span className="text-accent-text flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold">
            <Workflow className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'} to this order’s flow
          </span>
          <span className="text-fg-tertiary hidden text-[11px] @[620px]:inline">
            Nothing is recorded until you save it with a reason.
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={plan.onDiscard}
              className="border-line-subtle text-fg-secondary hover:bg-surface-3 rounded-[7px] border px-2 py-1 text-[11.5px]"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={plan.onReview}
              className="bg-accent text-accent-fg hover:bg-accent/90 rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold"
            >
              Review &amp; save
            </button>
          </span>
        </>
      ) : (
        <>
          <span className="text-fg-tertiary flex min-w-0 items-center gap-1.5 text-[11px]">
            <Workflow className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {editing
              ? 'Drag a phase to move it, or remove one below. Locked phases cannot change.'
              : deviates
                ? 'This order does not follow the standard flow.'
                : 'Phases run left to right.'}
          </span>
          {/* An order already off the standard flow needs a way back to it even
              with nothing pending — otherwise reset lives inside a dialog that
              only opens once you have made a change you did not want to make. */}
          {deviates && (
            <button
              type="button"
              onClick={plan.onReview}
              className="border-line-subtle text-fg-secondary hover:bg-surface-3 ml-auto flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors"
            >
              <RotateCcw className="size-3" strokeWidth={2.25} aria-hidden />
              Why, or reset
            </button>
          )}
          <button
            type="button"
            onClick={() => plan.onEditingChange(!editing)}
            aria-pressed={editing}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] transition-colors',
              !deviates && 'ml-auto',
              editing
                ? 'border-accent-border bg-accent-subtle text-accent-text'
                : 'border-line-subtle text-fg-secondary hover:bg-surface-3',
            )}
          >
            <Workflow className="size-3.5" strokeWidth={2} aria-hidden />
            {editing ? 'Done adjusting' : 'Adjust flow'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The per-phase controls, shown under the strip while editing.
 *
 * A separate row rather than icons on the tiles themselves: a 148px tile has no
 * room to say WHY a phase is locked, and "Remove" needs to be unmistakable rather
 * than a 10px cross that sits next to a click target for something else entirely.
 */
function FlowPlanEditor({
  phases,
  editability,
  pendingPhases,
  onToggleCurtail,
  onNudge,
}: {
  phases: ReturnType<typeof phaseProgress>;
  editability: Map<PhaseId, PhaseEditability>;
  pendingPhases: Set<PhaseId>;
  onToggleCurtail: (phase: PhaseId) => void;
  onNudge: (phase: PhaseId, delta: -1 | 1) => void;
}) {
  const sequence = phases.filter((p) => !p.curtailed).map((p) => p.phase.id);
  const removed = phases.length - sequence.length;
  // "Standard" means BOTH nothing removed and nothing reordered. Checking only for
  // removals called a resequenced flow standard, which is the one thing the
  // caption exists to tell the operator it is not.
  const reordered = sequence.some((id, i) => id !== PHASES.filter((p) => sequence.includes(p))[i]);

  return (
    <div className="border-line-subtle bg-surface-2 border-b px-2.5 py-2">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-fg text-[11.5px] font-semibold">This order runs</span>
        <span className="text-accent-text tnum text-[12px] font-semibold tracking-wide">
          {sequence.join(' → ')}
        </span>
        <span className="text-fg-tertiary text-[11px]">
          {'· '}
          {[
            removed > 0 ? `${removed} phase${removed === 1 ? '' : 's'} removed` : null,
            reordered ? 'resequenced' : null,
          ]
            .filter(Boolean)
            .join(', ') || 'the standard flow'}
        </span>
      </div>

      <ul className="grid gap-1 @[620px]:grid-cols-2 @[900px]:grid-cols-3">
        {phases.map((p) => {
          const rule = editability.get(p.phase.id);
          const locked = !rule || (!rule.canMove && !rule.canSkip && !rule.canRestore);
          return (
            <li
              key={p.phase.id}
              className={cn(
                'border-line-subtle bg-surface-1 flex items-center gap-2 rounded-[7px] border px-2 py-1.5',
                pendingPhases.has(p.phase.id) && 'border-accent-border',
                p.curtailed && 'opacity-70',
              )}
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full border text-[9px] font-semibold',
                  p.curtailed
                    ? 'border-line text-fg-tertiary bg-surface-3 border-dotted'
                    : STATE_META[p.state].core,
                )}
                aria-hidden
              >
                {p.phase.id}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[11.5px]',
                  p.curtailed ? 'text-fg-tertiary line-through' : 'text-fg',
                )}
                title={p.phase.label}
              >
                {p.phase.label}
              </span>

              {locked ? (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className="text-fg-tertiary flex shrink-0 items-center gap-1 text-[10px]">
                      <Lock className="size-3" strokeWidth={2.25} aria-hidden />
                      Fixed
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      sideOffset={6}
                      className="border-line bg-surface-1 text-fg z-50 max-w-[16rem] rounded-[8px] border px-2.5 py-1.5 text-[11.5px] shadow-lg"
                    >
                      {rule?.lockedBecause}
                      <Tooltip.Arrow className="fill-surface-1" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ) : (
                <span className="flex shrink-0 items-center gap-0.5">
                  {/* Buttons as well as drag: a trackpad drag across a wrapped
                      flex row is fiddly, and this is the same operation. */}
                  <button
                    type="button"
                    onClick={() => onNudge(p.phase.id, -1)}
                    className="text-fg-tertiary hover:bg-surface-3 hover:text-fg rounded-[5px] p-1"
                    aria-label={`Move ${p.phase.label} earlier`}
                  >
                    <ChevronDown className="size-3 rotate-90" strokeWidth={2.5} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNudge(p.phase.id, 1)}
                    className="text-fg-tertiary hover:bg-surface-3 hover:text-fg rounded-[5px] p-1"
                    aria-label={`Move ${p.phase.label} later`}
                  >
                    <ChevronDown className="size-3 -rotate-90" strokeWidth={2.5} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleCurtail(p.phase.id)}
                    className={cn(
                      'ml-0.5 flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-medium',
                      p.curtailed
                        ? 'border-line-subtle text-fg-secondary hover:bg-surface-3'
                        : 'border-line-subtle text-fg-secondary hover:border-danger hover:text-danger',
                    )}
                  >
                    {p.curtailed ? (
                      <>
                        <RotateCcw className="size-2.5" strokeWidth={2.5} aria-hidden />
                        Put back
                      </>
                    ) : (
                      <>
                        <Scissors className="size-2.5" strokeWidth={2.5} aria-hidden />
                        Remove
                      </>
                    )}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── One node ────────────────────────────────────────────────────────────────

/**
 * WHO IS LIABLE FOR THIS STEP, sized for a rail column.
 *
 * The same answer as the Steps list, in about a fifth of the width — so it is
 * terse by necessity. Collapsed it states only which side carries the step;
 * opening it names the obligation and why. The full prose lives in the Steps
 * tab, which has room for it.
 *
 * Only rendered under "Who owns it", because that toggle is already the
 * ownership view and this is the other half of the same question: the rail says
 * who DOES the step, this says who CARRIES it. On the terms where those differ —
 * a DDP order, where the supplier clears customs — that gap is the whole point.
 */
function RailLiability({ stageId, ctx }: { stageId: string; ctx: StageContext }) {
  const [open, setOpen] = useState(false);
  const liability = stageLiability(stageId, ctx);
  // Steps the Incoterm does not govern get nothing, so the rail stays quiet
  // outside the logistics phase rather than growing a row of empty controls.
  if (!liability) return null;

  const ours = liability.rows.filter((r) => r.party === '1BUY').length;
  const side = ours === liability.rows.length ? 'Ours' : ours === 0 ? 'Theirs' : 'Split';

  return (
    <div className="mt-1 flex w-full min-w-0 flex-col items-center px-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Who is liable for ${stageId}`}
        className={cn(
          'flex max-w-full min-w-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[9.5px] font-medium transition-colors',
          side === 'Ours'
            ? 'bg-accent-subtle text-accent-text hover:bg-accent-subtle/80'
            : side === 'Theirs'
              ? 'bg-surface-3 text-fg-secondary hover:bg-surface-3/80'
              : 'bg-warning-subtle text-warning hover:bg-warning-subtle/80',
        )}
      >
        <Scale className="size-2.5 shrink-0" strokeWidth={2.2} aria-hidden />
        <span className="truncate">Liable · {side}</span>
      </button>

      {open && (
        <div className="border-line-subtle bg-surface-2 mt-1 w-full min-w-0 space-y-1.5 rounded-[7px] border px-1.5 py-1.5 text-left">
          <div className="text-fg-tertiary text-[9px] leading-snug">
            {liability.side === 'BUY' ? 'Bought' : 'Sold'} {liability.termCode}
          </div>
          {liability.rows.map((r) => (
            <div key={r.key} className="min-w-0">
              <div className="text-fg text-[9.5px] leading-tight font-medium text-balance">
                {r.label}
              </div>
              <div className="text-fg-tertiary text-[9px] leading-snug">{r.party}</div>
              {r.warning && (
                <div className="text-warning mt-0.5 text-[9px] leading-snug text-balance">
                  {r.warning}
                </div>
              )}
            </div>
          ))}
          {liability.riskNote && (
            <div className="border-line-subtle text-fg-tertiary border-t pt-1 text-[9px] leading-snug text-balance">
              Risk transfers — {liability.riskNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageNode({
  stage,
  state,
  skipReason,
  enteredAt,
  stageEnteredAt,
  blockReason,
  branchLabel,
  showSwimlane,
  onClick,
  owner,
  nextActionOwner,
}: {
  stage: StageDef;
  state: StageVisualState;
  /**
   * Resolved against the order, not read off the stage. On the customs and
   * carriage steps the Incoterm decides whether the work is ours or the
   * supplier's, and this node prints that party's name.
   */
  owner: Stakeholder;
  nextActionOwner: Stakeholder;
  skipReason?: string;
  enteredAt?: { createdAt: string; actorLabel: string };
  stageEnteredAt?: Date;
  blockReason?: string | null;
  branchLabel?: string;
  showSwimlane?: boolean;
  onClick?: () => void;
}) {
  const { reduceMotion, label: pick } = usePreferences();
  const meta = STATE_META[state];
  const Icon = meta.icon;
  const isPulsing = state === 'CURRENT' || state === 'BLOCKED' || state === 'AT_RISK';
  const urgent = state === 'BLOCKED';
  const sla = stageEnteredAt ? assessSla(stage.id, stageEnteredAt) : null;

  const node = (
    <div className="relative z-10 flex w-full min-w-0 flex-col items-center gap-1.5 px-1 text-center">
      {/* "Currently here" marker with upward caret (§5.2) */}
      <div className="h-[18px]">
        {isPulsing && (
          <span
            className={cn(
              // Must stay on one line: the marker slot is a fixed 18px so the
              // circles across a row align, and a wrapped chip would be clipped.
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[9px] font-bold tracking-[0.02em] whitespace-nowrap uppercase',
              state === 'BLOCKED'
                ? 'bg-danger-subtle text-danger'
                : state === 'AT_RISK'
                  ? 'bg-warning-subtle text-warning'
                  : 'bg-accent-subtle text-accent-text',
            )}
          >
            {branchLabel ?? meta.label}
          </span>
        )}
      </div>
      <div className="relative grid size-7 place-items-center">
        {/* Two concentric halo rings, staggered by 700ms (§5.3) */}
        {isPulsing && !reduceMotion && (
          <>
            <span
              className={cn(
                'absolute inset-0 rounded-full',
                meta.ring,
                urgent ? 'rail-halo-urgent' : 'rail-halo',
              )}
              aria-hidden
            />
            <span
              className={cn(
                'absolute inset-0 rounded-full',
                meta.ring,
                urgent ? 'rail-halo-urgent-delayed' : 'rail-halo-delayed',
              )}
              aria-hidden
            />
          </>
        )}
        <span
          className={cn(
            'relative z-10 grid size-7 place-items-center rounded-full border-2 transition-colors',
            meta.core,
            // Breathing glow on the core itself
            isPulsing && !reduceMotion && 'rail-breathe',
            // Reduced-motion fallback: static high-contrast ring
            isPulsing && reduceMotion && 'ring-2 ring-offset-2 ring-current ring-offset-[var(--surface-1)]',
          )}
          style={
            isPulsing && !reduceMotion
              ? ({ '--glow-color': 'currentColor' } as React.CSSProperties)
              : undefined
          }
        >
          <Icon
            className={cn('size-3.5', state === 'CURRENT' && 'fill-current')}
            strokeWidth={state === 'COMPLETED' ? 3 : 2.2}
            aria-hidden
          />
        </span>
      </div>
      <span className={cn('text-[10.5px] leading-[1.3]', meta.text)}>
        {pick(stage.label, stage.plainLabel)}
      </span>
      <span className="text-fg-tertiary font-mono text-[9px]">{stage.code}</span>
      {/* Who holds the ball, named.
          This replaced a 3px coloured ribbon: colour alone cannot say "Customs
          Agent", it was aria-hidden so screen readers got nothing, and telling
          two muted hues apart at 3px is not a reasonable ask. The dot stays for
          quick scanning, but the name is what carries the meaning. */}
      {showSwimlane && (
        <span className="mt-0.5 flex min-w-0 items-center justify-center gap-1">
          <StakeholderDot stakeholder={owner} />
          <span className="text-fg-secondary min-w-0 text-[9.5px] leading-[1.25] text-balance">
            {STAKEHOLDER_META[owner].label}
          </span>
        </span>
      )}
      {/* Always in the DOM for screen readers, visible when motion is reduced. */}
      {isPulsing && <span className="sr-only">— {meta.label}</span>}
      {sla && sla.status !== 'ON_TRACK' && (
        <span className={cn('text-[9.5px]', sla.status === 'BREACHED' ? 'text-danger' : 'text-warning')}>
          {humanDuration(sla.overdueHours)} over
        </span>
      )}
    </div>
  );

  const wrapped = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-surface-3 relative z-10 w-full min-w-0 rounded-[9px] py-1 transition-colors"
    >
      {node}
    </button>
  ) : (
    node
  );

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{wrapped}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className="bg-surface-2 border-line shadow-e4 z-50 w-[300px] rounded-[10px] border p-0 text-left"
        >
          <div className="border-line-subtle flex items-start justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <div className="text-fg text-[12.5px] font-semibold">{stage.label}</div>
              <div className="text-fg-tertiary font-mono text-[10px]">
                Stage {stage.code} · Phase {stage.phase}
              </div>
            </div>
            <StakeholderBadge stakeholder={owner} short />
          </div>
          <div className="space-y-2 px-3 py-2.5 text-[11.5px] leading-[1.5]">
            <p className="text-fg-secondary">{stage.description}</p>

            {state === 'SKIPPED' && skipReason && (
              <p className="text-warning bg-warning-subtle rounded-[6px] px-2 py-1.5">
                <strong className="font-semibold">Skipped:</strong> {skipReason}
              </p>
            )}
            {state === 'BLOCKED' && blockReason && (
              <p className="text-danger bg-danger-subtle rounded-[6px] px-2 py-1.5">
                <strong className="font-semibold">Blocked:</strong> {blockReason}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Field label="Owner">{STAKEHOLDER_META[owner].label}</Field>
              <Field label="Expected">
                {stage.expectedHours > 0 ? humanDuration(stage.expectedHours) : '—'}
              </Field>
              {enteredAt && (
                <>
                  <Field label="Entered">{relativeTime(enteredAt.createdAt)}</Field>
                  <Field label="By">{enteredAt.actorLabel}</Field>
                </>
              )}
              {sla && (
                <Field label="Time here">
                  <span
                    className={cn(
                      sla.status === 'BREACHED' && 'text-danger',
                      sla.status === 'AT_RISK' && 'text-warning',
                    )}
                  >
                    {humanDuration(sla.hoursInStage)}
                  </span>
                </Field>
              )}
            </dl>

            <div className="border-line-subtle border-t pt-2">
              <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
                To leave this stage
              </div>
              <p className="text-fg-secondary mt-0.5">{stage.exitCriteria}</p>
            </div>
            <div>
              <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
                Next action
              </div>
              <p className="text-fg-secondary mt-0.5">
                {stage.nextAction}{' '}
                <span className="text-fg-tertiary">
                  ({STAKEHOLDER_META[nextActionOwner].label})
                </span>
              </p>
            </div>
          </div>
          <Tooltip.Arrow className="fill-[var(--surface-2)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * The visual state of a cell, whichever kind it is.
 *
 * A manual step is never CURRENT: the stage ladder governs where the order
 * actually is, and a per-order step cannot claim to be the live stage without
 * lying about the state machine. PENDING therefore reads as UPCOMING.
 */
function cellState(
  cell:
    | { kind: 'stage'; item: { state: StageVisualState } }
    | { kind: 'manual'; step: ManualStep }
    | undefined,
): StageVisualState | undefined {
  if (!cell) return undefined;
  if (cell.kind === 'stage') return cell.item.state;
  return cell.step.status === 'DONE'
    ? 'COMPLETED'
    : cell.step.status === 'SKIPPED'
      ? 'SKIPPED'
      : 'UPCOMING';
}


/**
 * A step somebody added to this one order.
 *
 * It borrows the standard state vocabulary — same icons, same colours for done
 * and skipped — so its progress reads without a second lesson. What marks it as
 * non-standard is structural: a dashed circle and a "Manual step" badge. That
 * distinction has to be unmissable, because anyone auditing the flow needs to
 * know instantly which steps are process and which are one-offs.
 */
function ManualStepNode({
  step,
  showSwimlane,
  onClick,
}: {
  step: ManualStep;
  showSwimlane?: boolean;
  onClick?: () => void;
}) {
  const done = step.status === 'DONE';
  const skipped = step.status === 'SKIPPED';
  /**
   * Plus, not a clock, for a step still to be done — and accent, not warning,
   * even when it blocks. A warning-toned clock is exactly how the rail draws
   * AT_RISK, and a blocking step is not the same thing as a late one. Reusing
   * that language would put "must do" and "running late" side by side looking
   * identical. The MUST DO badge carries the blocking flag on its own.
   */
  const Icon = done ? Check : skipped ? Minus : Plus;
  const owner = STAKEHOLDER_META[step.owner as keyof typeof STAKEHOLDER_META];
  const waiting = !done && !skipped;

  const node = (
    <div className="relative z-10 flex w-full min-w-0 flex-col items-center gap-1.5 px-1 text-center">
      {/* Same fixed 18px slot as a standard stage, so circles stay aligned. */}
      <div className="h-[18px]">
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[9px] font-bold tracking-[0.02em] whitespace-nowrap uppercase',
            waiting && step.blocking
              ? 'bg-warning-subtle text-warning'
              : 'bg-accent-subtle text-accent-text',
          )}
        >
          <Plus className="size-2.5" strokeWidth={3} aria-hidden />
          {waiting && step.blocking ? 'Must do' : 'Manual'}
        </span>
      </div>
      <div className="relative grid size-7 place-items-center">
        <span
          className={cn(
            'relative z-10 grid size-7 place-items-center rounded-full border-2 border-dashed transition-colors',
            done
              ? 'bg-success-subtle border-success text-success'
              : skipped
                ? 'bg-surface-3 border-line text-fg-tertiary'
                : 'bg-accent-subtle border-accent-border text-accent-text',
          )}
        >
          <Icon className="size-3.5" strokeWidth={done ? 3 : 2.6} aria-hidden />
        </span>
      </div>
      <span
        className={cn(
          'text-[10.5px] leading-[1.3]',
          done ? 'text-fg-secondary' : skipped ? 'text-fg-tertiary line-through' : 'text-fg',
        )}
      >
        {step.label}
      </span>
      <span className="text-accent-text/80 font-mono text-[9px]">Manual step</span>
      {showSwimlane && owner && (
        <span className="mt-0.5 flex min-w-0 items-center justify-center gap-1">
          <StakeholderDot stakeholder={step.owner as Stakeholder} />
          <span className="text-fg-secondary min-w-0 text-[9.5px] leading-[1.25] text-balance">
            {owner.label}
          </span>
        </span>
      )}
      <span className="sr-only">
        — manually added step, {done ? 'done' : skipped ? 'skipped' : 'not done yet'}
      </span>
    </div>
  );

  const wrapped = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-surface-3 relative z-10 w-full min-w-0 rounded-[9px] py-1 transition-colors"
    >
      {node}
    </button>
  ) : (
    node
  );

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{wrapped}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className="bg-surface-2 border-line shadow-e4 z-50 w-[300px] rounded-[10px] border p-0 text-left"
        >
          <div className="border-line-subtle flex items-start justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <div className="text-fg text-[12.5px] font-semibold">{step.label}</div>
              <div className="text-fg-tertiary text-[10px]">
                Added to this order only · not part of the standard flow
              </div>
            </div>
            {owner && <StakeholderBadge stakeholder={step.owner as Stakeholder} short />}
          </div>
          <div className="space-y-2 px-3 py-2.5 text-[11.5px] leading-[1.5]">
            {/* The reason leads, because it is the whole justification for the
                step existing and the first thing anyone asks. */}
            <p className="text-accent-text bg-accent-subtle rounded-[6px] px-2 py-1.5">
              <strong className="font-semibold">Why it is here:</strong> {step.reason}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Field label="Owner">{owner?.label ?? step.owner}</Field>
              <Field label="Expected">{humanDuration(step.expectedHours)}</Field>
              <Field label="Added by">{step.createdBy}</Field>
              <Field label="Added">{relativeTime(step.createdAt)}</Field>
              <Field label="Status">
                {done ? 'Done' : skipped ? 'Skipped' : 'Not done yet'}
              </Field>
              {step.completedBy && <Field label="By">{step.completedBy}</Field>}
            </dl>
            {step.exitCriteria && (
              <div className="border-line-subtle border-t pt-2">
                <div className="text-fg-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
                  What counts as finished
                </div>
                <p className="text-fg-secondary mt-0.5">{step.exitCriteria}</p>
              </div>
            )}
            {waiting && step.blocking && (
              <p className="text-warning bg-warning-subtle rounded-[6px] px-2 py-1.5">
                The order should not pass this point until this is done.
              </p>
            )}
            {onClick && (
              <p className="text-fg-tertiary border-line-subtle border-t pt-2">
                Click to mark it done, skip it, or remove it.
              </p>
            )}
          </div>
          <Tooltip.Arrow className="fill-[var(--surface-2)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-tertiary text-[9.5px] tracking-[0.04em] uppercase">{label}</dt>
      <dd className="text-fg-secondary truncate font-medium">{children}</dd>
    </div>
  );
}

function Connector({
  active,
  done,
  diverted,
  skipped,
  manual,
}: {
  active: boolean;
  done: boolean;
  diverted: boolean;
  skipped: boolean;
  /** One end of this segment is a manually inserted step. */
  manual?: boolean;
}) {
  const { reduceMotion } = usePreferences();
  return (
    // Spans from this node's circle to the next one's. 38px down = the 18px
    // "currently here" marker slot + the 6px gap + half of the 28px circle, so
    // the line meets the circles dead centre whatever the label wraps to.
    <span
      className="pointer-events-none absolute top-[38px] left-1/2 z-0 flex h-0 w-full items-center"
      aria-hidden
    >
      {diverted ? (
        // Exception branches divert onto a dashed line rather than continuing.
        <span className="border-danger h-0 w-full border-t-2 border-dashed" />
      ) : manual ? (
        // A segment touching an inserted step is drawn dashed in the accent, so
        // the eye can see at a glance that the flow leaves standard process here
        // — even before reading a single label.
        <span className="border-accent-border h-0 w-full border-t-2 border-dashed" />
      ) : active ? (
        <span
          className={cn('h-[2.5px] w-full rounded-full', reduceMotion ? 'bg-accent' : 'rail-sheen')}
        />
      ) : done ? (
        <span className="bg-success h-[2.5px] w-full rounded-full" />
      ) : skipped ? (
        <span className="border-line h-0 w-full border-t-2 border-dotted" />
      ) : (
        <span className="border-line-strong h-0 w-full border-t-2 border-dashed" />
      )}
    </span>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// Responsive wrapper — horizontal rail on tablet and up, vertical timeline on
// narrow viewports (§5.1). Switched with CSS rather than a JS media query so it
// is correct on the server render too, with no layout shift on hydration.
// ═══════════════════════════════════════════════════════════════════════════

export function ResponsiveFlowRail({
  data,
  onStageClick,
  onInsertStep,
  onManualStepClick,
  plan,
  className,
}: {
  data: FlowRailData;
  onStageClick?: (stageId: string) => void;
  onInsertStep?: (afterStageId: string, afterCustomStageId: string | null) => void;
  onManualStepClick?: (step: ManualStep) => void;
  plan?: FlowPlanControls;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="bg-surface-1 border-line-subtle rounded-[12px] border p-3 md:hidden">
        <div className="text-fg-tertiary mb-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          Progress
        </div>
        <VerticalRail data={data} onManualStepClick={onManualStepClick} />
        {/* Reordering by drag needs a pointer and room for seven tiles side by
            side; neither exists here. The button below opens the same dialog, so
            the capability is not lost on a phone — only the drag gesture is. */}
        {plan && !plan.disabled && (
          <button
            type="button"
            onClick={plan.onReview}
            className="border-line-subtle text-fg-secondary hover:bg-surface-3 mt-3 flex w-full items-center justify-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-[12px]"
          >
            <Workflow className="size-3.5" strokeWidth={2} aria-hidden />
            Adjust this order’s flow
          </button>
        )}
      </div>
      <div className="hidden md:block">
        <FlowRail
          data={data}
          onStageClick={onStageClick}
          onInsertStep={onInsertStep}
          onManualStepClick={onManualStepClick}
          plan={plan}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Micro-rail — one per row in the orders list (§5.1)
// ═══════════════════════════════════════════════════════════════════════════

export function MicroRail({ data, className }: { data: FlowRailData; className?: string }) {
  const { reduceMotion } = usePreferences();
  const enteredAt = new Date(data.stageEnteredAt);
  const states = railStates({
    currentStage: data.currentStage,
    ctx: data.ctx,
    isBlocked: data.isBlocked,
    stageEnteredAt: enteredAt,
    completedStageIds: data.completedStageIds,
  });
  const done = states.filter((s) => s.state === 'COMPLETED').length;

  return (
    /**
     * Fifty of these render at once, so every decision here is about legibility
     * at a glance rather than detail.
     *
     * Two things were wrong before and both hurt most on a light background:
     *
     *  · the live mark carried `rail-breathe`, a 10px box-shadow glow. On a 3px
     *    sliver that is not a pulse, it is a smudge — the mark you most need to
     *    find was the blurriest thing in the row.
     *  · upcoming stages were `bg-line-strong` at 45% opacity, which on white is
     *    almost nothing, so the bar had no visible length and "6 of 34 done" and
     *    "6 of 8 done" looked identical.
     *
     * Now: solid track, no opacity tricks, and the live mark pops geometrically —
     * wider, full height, with a surface-coloured ring that separates it from its
     * neighbours at any zoom. Motion is a gentle opacity pulse, which cannot
     * bleed into adjacent marks the way a shadow does.
     */
    <span
      className={cn('flex items-center gap-[2px]', className)}
      role="img"
      aria-label={`Progress: ${done} of ${states.length} stages done`}
    >
      {states.map((s) => {
        const isLive = s.state === 'CURRENT' || s.state === 'BLOCKED' || s.state === 'AT_RISK';
        return (
          <span
            key={s.stage.id}
            className={cn(
              'rounded-[1.5px] transition-colors',
              // The live mark is bigger than its neighbours, so it is findable
              // before any colour is read — which is also what makes it work for
              // a colour-blind reader.
              isLive ? 'h-[13px] w-[5px]' : 'h-[9px] w-[3.5px]',
              s.state === 'COMPLETED' && 'bg-success',
              s.state === 'CURRENT' && 'bg-accent ring-surface-1 ring-1',
              s.state === 'BLOCKED' && 'bg-danger ring-surface-1 ring-1',
              s.state === 'AT_RISK' && 'bg-warning ring-surface-1 ring-1',
              // A real track colour rather than a faded one: the length of the
              // bar is information, and it has to survive a white background.
              s.state === 'UPCOMING' && 'bg-line-strong',
              // Skipped reads as absent rather than pending — hollow, not faint.
              s.state === 'SKIPPED' && 'border-line-strong border border-dashed bg-transparent',
              isLive && !reduceMotion && 'micro-pulse',
            )}
          />
        );
      })}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Vertical timeline — narrow viewports (§5.1)
// ═══════════════════════════════════════════════════════════════════════════

export function VerticalRail({
  data,
  onManualStepClick,
}: {
  data: FlowRailData;
  onManualStepClick?: (step: ManualStep) => void;
}) {
  const { reduceMotion, label: pick } = usePreferences();
  const enteredAt = new Date(data.stageEnteredAt);
  const states = railStates({
    currentStage: data.currentStage,
    ctx: data.ctx,
    isBlocked: data.isBlocked,
    stageEnteredAt: enteredAt,
    completedStageIds: data.completedStageIds,
  });

  return (
    <ol className="relative pl-6">
      {PHASES.map((pid) => {
        const inPhase = states.filter((s) => s.stage.phase === pid);
        if (inPhase.length === 0) return null;
        return (
          <li key={pid} className="mb-3">
            <div className="text-fg-tertiary mb-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
              Phase {pid} · {PHASE_DEFS[pid].label}
            </div>
            <ol>
              {inPhase.flatMap((s) => [
                s,
                ...(data.customStages ?? [])
                  .filter((m) => m.afterStageId === s.stage.id)
                  .sort((a, b) => a.sequence - b.sequence),
              ]).map((entry) => {
                // A manual step has no `stage`; that is how the two are told apart.
                if (!('stage' in entry)) {
                  const step = entry;
                  const isDone = step.status === 'DONE';
                  const isSkipped = step.status === 'SKIPPED';
                  const StepIcon = isDone ? Check : isSkipped ? Minus : Plus;
                  const body = (
                    <>
                      <span className="bg-line-subtle absolute top-0 -left-[13px] h-full w-px" aria-hidden />
                      <span className="relative -ml-[26px] grid size-5 shrink-0 place-items-center">
                        <span
                          className={cn(
                            'relative z-10 grid size-5 place-items-center rounded-full border-2 border-dashed',
                            isDone
                              ? 'bg-success-subtle border-success text-success'
                              : isSkipped
                                ? 'bg-surface-3 border-line text-fg-tertiary'
                                : 'bg-accent-subtle border-accent-border text-accent-text',
                          )}
                        >
                          <StepIcon className="size-2.5" strokeWidth={2.5} aria-hidden />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span
                          className={cn(
                            'block text-[12.5px]',
                            isSkipped ? 'text-fg-tertiary line-through' : 'text-fg',
                          )}
                        >
                          {step.label}
                        </span>
                        <span className="text-accent-text text-[10px] font-semibold uppercase">
                          Manual step
                          {!isDone && !isSkipped && step.blocking ? ' · must do' : ''}
                        </span>
                        <span className="text-fg-tertiary block text-[10.5px] leading-[1.4]">
                          {step.reason}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={step.id} className="relative py-1.5">
                      {onManualStepClick ? (
                        <button
                          type="button"
                          onClick={() => onManualStepClick(step)}
                          className="hover:bg-surface-3 flex w-full items-start gap-2.5 rounded-[8px] transition-colors"
                        >
                          {body}
                        </button>
                      ) : (
                        <span className="flex items-start gap-2.5">{body}</span>
                      )}
                    </li>
                  );
                }
                const s = entry;
                const meta = STATE_META[s.state];
                const Icon = meta.icon;
                const isLive =
                  s.state === 'CURRENT' || s.state === 'BLOCKED' || s.state === 'AT_RISK';
                return (
                  <li key={s.stage.id} className="relative flex items-start gap-2.5 py-1.5">
                    <span className="bg-line-subtle absolute top-0 -left-[13px] h-full w-px" aria-hidden />
                    <span className="relative -ml-[26px] grid size-5 shrink-0 place-items-center">
                      {isLive && !reduceMotion && (
                        <span
                          className={cn(
                            'absolute inset-0 rounded-full',
                            meta.ring,
                            s.state === 'BLOCKED' ? 'rail-halo-urgent' : 'rail-halo',
                          )}
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          'relative z-10 grid size-5 place-items-center rounded-full border-2',
                          meta.core,
                          isLive && reduceMotion && 'ring-2 ring-current ring-offset-1',
                        )}
                      >
                        <Icon className="size-2.5" strokeWidth={2.5} aria-hidden />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[12.5px]', meta.text)}>
                        {pick(s.stage.label, s.stage.plainLabel)}
                      </span>
                      {isLive && (
                        <span
                          className={cn(
                            'text-[10px] font-semibold uppercase',
                            s.state === 'BLOCKED'
                              ? 'text-danger'
                              : s.state === 'AT_RISK'
                                ? 'text-warning'
                                : 'text-accent-text',
                          )}
                        >
                          {meta.label}
                        </span>
                      )}
                      {s.state === 'SKIPPED' && s.skipReason && (
                        <span className="text-fg-tertiary block text-[10.5px]">{s.skipReason}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}
