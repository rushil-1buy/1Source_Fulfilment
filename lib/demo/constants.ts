/**
 * The demo order's alias, in a module with no server-only imports.
 *
 * Kept apart from lib/demo/demo-order.ts so a client component can check "is this
 * the demo order" without pulling the seed — and with it PrismaClient and every
 * master data table — into the browser bundle.
 */
export const DEMO_ORDER_ALIAS = 'DEMO-ORDER';
