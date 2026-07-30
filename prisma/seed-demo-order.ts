/**
 * CLI wrapper. The demo order itself is defined in lib/demo/demo-order.ts so the
 * app can rebuild it too — the Reset button on the order runs the same code that
 * seeds it, which is the only way the two cannot drift apart.
 *
 * Run with: npx tsx prisma/seed-demo-order.ts
 */

import { PrismaClient } from '@/lib/generated/prisma';
import { seedDemoOrder } from '@/lib/demo/demo-order';

export { seedDemoOrder };

if (process.argv[1]?.includes('seed-demo-order')) {
  const db = new PrismaClient();
  seedDemoOrder(db)
    .then((r) => {
      console.log('demo order ready');
      console.log(`  alias      : ${r.alias}   \u2192  /orders/${r.alias}`);
      console.log(`  name       : ${r.canonicalName}`);
      console.log(`  stage      : ${r.stage}`);
      console.log(`  progress   : ${r.done} done, ${r.remaining} still to do`);
      console.log(`  next up    : ${r.nextUp}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
