'use server';

/**
 * Putting the demo order back to its starting position.
 *
 * A demo walks the order forward through escrow, testing, shipping, customs,
 * inspection and invoicing, and every one of those leaves rows behind. Doing the
 * next demo needs all of that gone — not hidden, gone — or the second run starts
 * from a half-finished order that behaves nothing like the first.
 *
 * This rebuilds the order from the SAME definition the database seed uses
 * (lib/demo/demo-order.ts). Sharing it is the point: a bespoke "undo" written
 * separately would drift from the seed, and the reset would slowly stop producing
 * the order the demo was designed around.
 *
 * SAFETY
 *
 * This deletes a work order and everything hanging off it. That is fine for the
 * demo fixture and catastrophic for anything else, so it does not take an order
 * id at all — it can only ever act on the one alias, checked again against the
 * row it loaded before anything is removed. There is deliberately no parameter an
 * caller could point somewhere else.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { STAGE_BY_ID } from '@/lib/domain/stages';
import { ALIAS, WO_ID, seedDemoOrder } from '@/lib/demo/demo-order';

export interface DemoResetResult {
  ok: boolean;
  message: string;
  detail?: string;
  /** Where the order sits afterwards, for the toast. */
  stage?: string;
}

/**
 * Nothing else is exported from this file on purpose. In a 'use server' module
 * every export becomes a callable endpoint, so a convenience helper here would be
 * a second way to reach demo-only behaviour. Whether the button renders is decided
 * from DEMO_ORDER_ALIAS on the client; whether the reset RUNS is decided below.
 */
export async function resetDemoOrder(): Promise<DemoResetResult> {
  // Loaded by id AND checked by alias. Either alone would be enough in practice;
  // together they mean a rename or a re-seeded id cannot turn this into a delete
  // of somebody else's order.
  const existing = await db.workOrder.findUnique({
    where: { id: WO_ID },
    select: { id: true, alias: true, stage: true },
  });

  if (existing && existing.alias !== ALIAS) {
    return {
      ok: false,
      message: 'Refusing to reset.',
      detail: `The order at the demo id is "${existing.alias}", not "${ALIAS}". Something else is using that record, so nothing was touched.`,
    };
  }

  const from = existing?.stage ?? null;

  try {
    const r = await seedDemoOrder(db);

    for (const path of [`/orders/${ALIAS}`, `/orders/${WO_ID}`, '/orders', '/dashboard', '/escrow', '/testing', '/logistics', '/customs', '/warehouse', '/tax', '/reports', '/documents']) {
      try {
        revalidatePath(path);
      } catch {
        /* not in a request context */
      }
    }

    // The stage id is not a label. "supplier pi received" is what the operator
    // gets if it is merely lowercased, and the rest of the app never shows that.
    const wasAt = from ? STAGE_BY_ID[from] : null;
    const movedOn = Boolean(from && from !== 'SUPPLIER_PI_RECEIVED');

    return {
      ok: true,
      message: `Demo order reset to ${r.stage}.`,
      detail: !from
        ? `Rebuilt from scratch. ${r.remaining} stages ahead.`
        : movedOn
          ? `It was at ${wasAt ? `${wasAt.code} ${wasAt.label}` : from}. Everything the last run produced — escrow, shipments, testing, customs, invoices, evidence and any re-planned flow — has been cleared. ${r.remaining} stages ahead again.`
          : `It was already at the start; the run so far has been cleared and the timeline refreshed. ${r.remaining} stages ahead.`,
      stage: r.stage,
    };
  } catch (e) {
    return {
      ok: false,
      message: 'The reset did not finish.',
      detail: e instanceof Error ? e.message : 'Unknown error rebuilding the demo order.',
    };
  }
}
