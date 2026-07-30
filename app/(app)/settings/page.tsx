import Link from 'next/link';
import {
  BookOpen,
  Building2,
  Calculator,
  Hash,
  Plug,
  ScrollText,
  Users,
} from 'lucide-react';
import { db } from '@/lib/db';
import { PageHeader, PageShell, Panel } from '@/components/ui/Layout';
import { Chip } from '@/components/ui/Badges';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const [org, connectors, glossaryCount, numberingCount, userCount] = await Promise.all([
    db.orgSetting.findFirst(),
    db.integrationConnector.findMany({ select: { mode: true } }),
    db.glossaryTerm.count(),
    db.numberingSeries.count(),
    db.user.count(),
  ]);

  const manualCount = connectors.filter((c) => c.mode === 'MANUAL').length;

  const cards = [
    {
      href: '/settings/integrations',
      icon: Plug,
      title: 'Integrations & connector health',
      description:
        'The five external systems, what mode each is in, and whether anything is failing.',
      meta: `${connectors.length} connectors · ${manualCount} manual`,
      ready: true,
    },
    {
      href: '/settings/glossary',
      icon: BookOpen,
      title: 'Glossary & tooltip editor',
      description:
        'Every tooltip in the app is stored here as data, so wording can be improved without a developer.',
      meta: `${glossaryCount} terms`,
      ready: true,
    },
    {
      href: '/settings/tax',
      icon: Calculator,
      title: 'Tax configuration',
      description:
        'Our own GSTIN, place of business, LUT details, and the e-invoice / e-way bill thresholds.',
      meta: org ? `${org.stateName} · GSTIN ${org.gstin}` : 'Not configured',
      ready: false,
    },
    {
      href: '/settings/users',
      icon: Users,
      title: 'Users & roles',
      description:
        'Who can do what. Escrow release requires Finance, and the final release needs two of them.',
      meta: `${userCount} users`,
      ready: false,
    },
    {
      href: '/settings/numbering',
      icon: Hash,
      title: 'Numbering series',
      description: 'Prefixes and sequences for every document type.',
      meta: `${numberingCount} series`,
      ready: false,
    },
    {
      href: '/settings/sla',
      icon: ScrollText,
      title: 'SLA configuration',
      description: 'How long each stage should take before an order is flagged as running late.',
      meta: 'Derived from the stage ladder',
      ready: false,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="How the platform behaves, and how it talks to the outside world."
      />

      {org && (
        <Panel className="mb-4">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            <span className="bg-accent-subtle text-accent-text grid size-9 shrink-0 place-items-center rounded-[10px]">
              <Building2 className="size-4.5" strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-fg text-[13.5px] font-semibold">{org.legalName}</div>
              <div className="text-fg-tertiary mt-0.5 text-[12px]">
                Trading as {org.brandName} · {org.addressLine1}, {org.city} {org.pincode}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip size="sm">GSTIN {org.gstin}</Chip>
                <Chip size="sm">
                  {org.stateName} ({org.stateCode})
                </Chip>
                {org.cin && <Chip size="sm">CIN {org.cin}</Chip>}
                {org.lutNumber && <Chip size="sm">LUT {org.lutNumber}</Chip>}
                <Chip size="sm">Margin floor {org.marginFloorPct}%</Chip>
              </div>
              <p className="text-fg-tertiary mt-2 max-w-[min(80ch,100%)] text-[11.5px] leading-relaxed">
                The registration state above is what decides whether a customer invoice comes out as
                CGST + SGST or as IGST, so changing it changes the tax on every future invoice.
              </p>
            </div>
          </div>
        </Panel>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.href} className="min-w-0">
            {c.ready ? (
              <Link
                href={c.href}
                className="bg-surface-1 border-line-subtle hover:border-accent-border hover:bg-surface-3 block h-full min-w-0 rounded-[12px] border p-3.5 transition-colors"
              >
                <CardBody {...c} />
              </Link>
            ) : (
              <div className="bg-surface-1 border-line-subtle block h-full min-w-0 rounded-[12px] border p-3.5 opacity-60">
                <CardBody {...c} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

function CardBody({
  icon: Icon,
  title,
  description,
  meta,
  ready,
}: {
  icon: typeof Plug;
  title: string;
  description: string;
  meta: string;
  ready: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="text-fg-tertiary size-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <span className="text-fg truncate text-[13px] font-semibold">{title}</span>
        {!ready && (
          <Chip size="sm" tone="neutral">
            Coming next
          </Chip>
        )}
      </div>
      <p className="text-fg-tertiary mt-1.5 text-[12px] leading-relaxed">{description}</p>
      <div className="text-fg-secondary mt-2 text-[11px]">{meta}</div>
    </>
  );
}
