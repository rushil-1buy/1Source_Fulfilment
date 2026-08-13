import { notFound } from 'next/navigation';
import { teamLoads, teamWorkspace } from '@/lib/queries/team';
import { STAKEHOLDER_META, TEAM_SLUGS } from '@/lib/domain/enums';
import { TeamWorkspaceView } from './TeamWorkspaceView';

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
export default async function TeamPage({ params }: { params: Promise<{ team: string }> }) {
  const { team: slug } = await params;
  const team = TEAM_SLUGS[slug];
  // An unknown slug is a 404 rather than a redirect to some default team: landing
  // silently on somebody else's queue is worse than being told the link is wrong.
  if (!team) notFound();

  const [workspace, loads] = await Promise.all([teamWorkspace(team), teamLoads()]);
  return <TeamWorkspaceView workspace={workspace} loads={loads} slug={slug} />;
}

export async function generateMetadata({ params }: { params: Promise<{ team: string }> }) {
  const { team: slug } = await params;
  const team = TEAM_SLUGS[slug];
  return { title: team ? STAKEHOLDER_META[team].label : 'Team' };
}
