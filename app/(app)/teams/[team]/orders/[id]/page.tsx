import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getOrderDetail } from '@/lib/queries/order-detail';
import { ROLE_META, STAKEHOLDER_META, TEAM_SLUGS, type Role } from '@/lib/domain/enums';
import { TeamOrderView } from './TeamOrderView';

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
export default async function TeamOrderPage({
  params,
}: {
  params: Promise<{ team: string; id: string }>;
}) {
  const { team: slug, id } = await params;
  const team = TEAM_SLUGS[slug];
  if (!team) notFound();

  const [order, financeUsers] = await Promise.all([
    getOrderDetail(id),
    // The advance gate is the same one the order page renders, so it needs the
    // same picker: escrow release is Finance's to authorise, and the final one
    // takes two of them.
    db.user.findMany({ where: { role: 'Finance', active: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!order) notFound();

  return (
    <TeamOrderView
      order={order}
      team={team}
      slug={slug}
      financeApprovers={financeUsers.map((u) => ({
        id: u.id,
        name: u.name,
        role: ROLE_META[u.role as Role]?.label ?? u.role,
      }))}
    />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ team: string; id: string }>;
}) {
  const { team: slug, id } = await params;
  const team = TEAM_SLUGS[slug];
  const order = await getOrderDetail(id);
  if (!order || !team) return { title: 'Order' };
  return { title: `${order.alias} · ${STAKEHOLDER_META[team].short}` };
}
