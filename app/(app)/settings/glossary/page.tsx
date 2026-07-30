import { PageHeader, PageShell } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec, type RecordRow } from '@/components/ui/RecordTable';
import { db } from '@/lib/db';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Glossary' };

const COLUMNS: ColumnSpec[] = [
  { key: 'term', label: 'Term', mobile: 'primary', width: '190px' },
  { key: 'plainTerm', label: 'Plain English name', mobile: 'secondary', width: '200px' },
  { key: 'category', label: 'Area', kind: 'chip', mobile: 'meta', width: '130px' },
  { key: 'whatItIs', label: 'What it is', mobile: 'meta' },
  { key: 'whyItMatters', label: 'Why it matters' },
  { key: 'example', label: 'Example', kind: 'mono', mobile: 'hidden', width: '200px' },
  { key: 'whoFillsItIn', label: 'Who fills it in', mobile: 'hidden' },
];

export default async function GlossaryPage() {
  const terms = await db.glossaryTerm.findMany({ orderBy: [{ category: 'asc' }, { term: 'asc' }] });
  const rows: RecordRow[] = terms.map((t) => ({
    id: t.id,
    term: t.term,
    plainTerm: t.plainTerm,
    category: t.category,
    whatItIs: t.whatItIs,
    whyItMatters: t.whyItMatters,
    example: t.example,
    whoFillsItIn: t.whoFillsItIn,
  }));

  return (
    <PageShell width="full">
      <PageHeader
        title="Glossary & tooltip text"
        description="Every tooltip in the platform is stored here as data rather than written into the screens, so the wording can be improved without a developer. Each entry follows the same shape: what it is, why it matters, an example, and who fills it in."
      />
      <RecordTable
      rowNoun="terms"
        columns={COLUMNS}
        rows={rows}
        exportName="glossary"
        searchPlaceholder="Search terms, plain names or explanations…"
        emptyTitle="No glossary terms yet"
        pageSize={50}
      />
    </PageShell>
  );
}
