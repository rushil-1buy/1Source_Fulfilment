import { db } from '@/lib/db';
import { getStage } from '@/lib/domain/stages';
import { stageContextFrom } from '@/lib/domain/stage-context';
import type { Stakeholder } from '@/lib/domain/enums';
import { deliverablesForTeam, isOverdue, isReady } from '@/lib/domain/deliverables/registry';
import type { DeliverableInput } from '@/lib/domain/deliverables/types';
import { buildDeliverableInput } from './deliverable-input';

export interface DeliverableRowData {
  id: string;
  kind: string;
  status: string;
  version: number;
  generatedAtStage: string;
  generatedAt: string;
  approvedAt: string | null;
  reviewNote: string | null;
  filedWith: string | null;
  filedRef: string | null;
  filedAt: string | null;
  computed: string;
  values: string;
}

export interface DeliverableSlotData {
  kind: string;
  label: string;
  plainLabel: string;
  purpose: string;
  ready: boolean;
  readyFromLabel: string;
  overdue: boolean;
  latest: DeliverableRowData | null;
}

export interface TeamDeliverables {
  slots: DeliverableSlotData[];
  /** Shared with the browser so the check preview runs against the same facts
   *  the server will use, rather than against something that merely looks close. */
  input: DeliverableInput | null;
}

/**
 * Everything a team owes on one order.
 *
 * Returns a slot for each document whether or not a draft exists — a team that
 * has not drafted its packing list needs to be told it owes one, and a list
 * built only from rows that exist would say nothing at all.
 */
export async function teamDeliverables(
  orderId: string,
  team: Stakeholder,
): Promise<TeamDeliverables> {
  const defs = deliverablesForTeam(team);
  if (defs.length === 0) return { slots: [], input: null };

  const wo = await db.workOrder.findUnique({
    where: { id: orderId },
    include: { customerPo: true, phasePlan: true },
  });
  if (!wo) return { slots: [], input: null };

  const [rows, input] = await Promise.all([
    db.teamDeliverable.findMany({
      where: { workOrderId: orderId, team, status: { not: 'SUPERSEDED' } },
      orderBy: { version: 'desc' },
    }),
    buildDeliverableInput(orderId),
  ]);

  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  // Highest live version per kind. Superseded rows are already filtered out, so
  // whatever is left is either the working draft or the approved one.
  const latestByKind = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestByKind.has(r.kind)) latestByKind.set(r.kind, r);

  return {
    input,
    slots: defs.map((def) => {
      const row = latestByKind.get(def.kind) ?? null;
      return {
        kind: def.kind,
        label: def.label,
        plainLabel: def.plainLabel,
        purpose: def.purpose,
        ready: isReady(def, wo.stage, ctx),
        readyFromLabel: getStage(def.readyFromStage).label,
        // Only unapproved work can be late. A signed document is not overdue.
        overdue: isOverdue(def, wo.stage) && row?.status !== 'APPROVED',
        latest: row
          ? {
              id: row.id,
              kind: row.kind,
              status: row.status,
              version: row.version,
              generatedAtStage: row.generatedAtStage,
              generatedAt: row.generatedAt.toISOString(),
              approvedAt: row.approvedAt?.toISOString() ?? null,
              reviewNote: row.reviewNote,
              filedWith: row.filedWith,
              filedRef: row.filedRef,
              filedAt: row.filedAt?.toISOString() ?? null,
              computed: row.computed,
              values: row.values,
            }
          : null,
      };
    }),
  };
}
