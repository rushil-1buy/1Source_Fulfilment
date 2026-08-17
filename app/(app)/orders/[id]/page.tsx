import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getOrderDetail } from '@/lib/queries/order-detail';
import { ROLE_META, type Role } from '@/lib/domain/enums';
import { OrderDetailView } from './OrderDetailView';
import { agenticRunLog } from '@/lib/actions/agentic-run';
import { SIM_PREFIX } from '@/lib/domain/simulation-config';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


/** Next 16: `params` is a Promise and must be awaited. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, financeUsers] = await Promise.all([
    getOrderDetail(id),
    // Only Finance may authorise an escrow release, and the final one needs two
    // of them — so the picker is populated from the role, not free text.
    db.user.findMany({ where: { role: 'Finance', active: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!order) notFound();

  /*
   * The agent's own account of the run, for simulated orders only.
   *
   * Fetched here rather than inside the view so a real order pays nothing for a
   * panel it will never render — and so the check for "is this a simulation"
   * lives in one place instead of being re-derived from the alias downstream.
   */
  const runLog = order.alias.startsWith(SIM_PREFIX) ? await agenticRunLog(order.id) : [];

  return (
    <OrderDetailView
      order={order}
      runLog={runLog}
      financeApprovers={financeUsers.map((u) => ({
        id: u.id,
        name: u.name,
        role: ROLE_META[u.role as Role]?.label ?? u.role,
      }))}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderDetail(id);
  return { title: order ? order.alias : 'Order' };
}
