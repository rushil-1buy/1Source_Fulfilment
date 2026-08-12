/**
 * Drives one order from its current stage to ORDER_CLOSED through the SAME
 * server action the "Advance" button calls, with every connector in MANUAL mode.
 * This is the AC#7 + AC#19 proof.
 */
import { PrismaClient } from '@/lib/generated/prisma';
import { advanceStage } from '../lib/actions/stage';
import { nextStageFor, getStage, type StageContext } from '../lib/domain/stages';

const db = new PrismaClient();

async function main() {
  const alias = process.argv[2] ?? 'WO-2026-0113';
  const finance = await db.user.findMany({ where: { role: 'Finance' }, select: { id: true, name: true } });
  const approverIds = finance.slice(0, 2).map((f) => f.id);
  console.log(`Finance approvers available: ${finance.map(f => f.name).join(', ')}\n`);

  let steps = 0;
  for (;;) {
    const wo = await db.workOrder.findFirst({ where: { alias } });
    if (!wo) { console.log('order not found'); break; }
    if (wo.status === 'CLOSED' || wo.stage === 'ORDER_CLOSED') { console.log('\nReached ORDER_CLOSED.'); break; }
    if (++steps > 40) { console.log('\nstopped: too many steps'); break; }

    const ctx: StageContext = {
      paymentMethod: wo.paymentMethod as 'ESCROW',
      testingRequired: wo.testingRequired,
      testScope: (wo.testScope as 'LOT_SAMPLE' | null) ?? null,
      incoterms: wo.incoterms,
    };
    const next = nextStageFor(wo.stage, ctx);
    if (!next) { console.log('\nno further stage from', wo.stage); break; }

    const res = await advanceStage(wo.id, next.id, { approverIds });
    const stage = getStage(next.id);
    if (res.ok) {
      console.log(`  ${String(steps).padStart(2)}. ${stage.code.padEnd(4)} ${stage.label.padEnd(38)} [${res.provenance}]`);
      if (res.detail) console.log(`      ${res.detail.slice(0, 150)}`);
    } else {
      console.log(`  ${String(steps).padStart(2)}. ${stage.code.padEnd(4)} ${stage.label.padEnd(38)} REFUSED`);
      console.log(`      ${res.message}`);
      if (res.detail) console.log(`      ${res.detail.slice(0, 160)}`);
      break;
    }
  }
  await db.$disconnect();
}
main();
