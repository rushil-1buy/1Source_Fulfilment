/**
 * Every deliverable, and the rules about when one is due.
 *
 * One list, read by the generator, the team screens and the checks alike. A
 * second list anywhere would drift, and the failure mode is a team not being
 * told about a document they are answerable for — which is silent until an
 * auditor asks for it.
 */

import { STAGE_DEFS, type StageContext, applicableStages } from '@/lib/domain/stages';
import type { Stakeholder } from '@/lib/domain/enums';
import { PNL } from './pnl';
import {
  DELIVERY_NOTE,
  ESCROW_RELEASE,
  GRN_NOTE,
  IMPORT_FILE,
  INSPECTION_REPORT,
  PACKING_LIST,
  SOURCING_TERMS,
} from './team-docs';
import type { DeliverableDef, DeliverableKind } from './types';

export const DELIVERABLES: DeliverableDef[] = [
  SOURCING_TERMS,
  PNL,
  ESCROW_RELEASE,
  IMPORT_FILE,
  INSPECTION_REPORT,
  GRN_NOTE,
  PACKING_LIST,
  DELIVERY_NOTE,
];

const BY_KIND = new Map(DELIVERABLES.map((d) => [d.kind, d]));

export function deliverableFor(kind: string): DeliverableDef | null {
  return BY_KIND.get(kind as DeliverableKind) ?? null;
}

export function deliverablesForTeam(team: Stakeholder): DeliverableDef[] {
  return DELIVERABLES.filter((d) => d.team === team);
}

/** Ladder position, used to compare "is the order past this stage yet". */
const positionOf = (stageId: string) => STAGE_DEFS.findIndex((s) => s.id === stageId);

/**
 * Whether the order has gone far enough for this document's figures to mean
 * something.
 *
 * Measured against stages the order ACTUALLY runs, not the master ladder — an
 * order with testing switched off never reaches the testing stages, and a
 * document keyed to one of them would otherwise stay forever un-draftable.
 */
export function isReady(def: DeliverableDef, currentStage: string, ctx: StageContext): boolean {
  const runs = applicableStages(ctx);
  const readyIdx = runs.findIndex((s) => s.id === def.readyFromStage);
  // A stage this order never runs cannot gate anything on it.
  if (readyIdx === -1) return true;
  const nowIdx = runs.findIndex((s) => s.id === currentStage);
  if (nowIdx === -1) return false;
  return nowIdx >= readyIdx;
}

/** Past the point it should have been approved by. */
export function isOverdue(def: DeliverableDef, currentStage: string): boolean {
  const due = positionOf(def.dueByStage);
  const now = positionOf(currentStage);
  return due !== -1 && now !== -1 && now > due;
}
