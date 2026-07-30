import { PageHeader, PageShell } from '@/components/ui/Layout';
import { RecordTable, type ColumnSpec } from '@/components/ui/RecordTable';
import { listDocuments } from '@/lib/queries/modules';

export const metadata = { title: 'Documents' };

const COLUMNS: ColumnSpec[] = [
  { key: 'title', label: 'Document', mobile: 'primary' },
  { key: 'docType', label: 'Document type', kind: 'chip', mobile: 'meta', width: '190px' },
  { key: 'order', label: 'Work order', kind: 'mono', mobile: 'secondary', width: '150px' },
  { key: 'fileName', label: 'File name', kind: 'mono', mobile: 'hidden', width: '220px' },
  { key: 'sizeKb', label: 'Size in kilobytes', kind: 'number', mobile: 'hidden', width: '160px' },
  { key: 'version', label: 'Version', kind: 'number', mobile: 'hidden', width: '100px' },
  { key: 'uploadedBy', label: 'Filed by', mobile: 'meta' },
  { key: 'provenance', label: 'Source', termKey: 'provenance', kind: 'provenance', mobile: 'hidden', width: '110px' },
  { key: 'createdAt', label: 'Filed on', kind: 'datetime', mobile: 'meta', width: '170px' },
];

export default async function DocumentsPage() {
  const rows = await listDocuments();
  return (
    <PageShell width="full">
      <PageHeader
        title="Documents"
        plainTitle="Files"
        description="Every document across every order, filed automatically as each stage produces it. Nothing here was uploaded by hand into a folder somebody has to remember."
      />
      <RecordTable
      rowNoun="documents"
        columns={COLUMNS}
        rows={rows}
        exportName="documents"
        searchPlaceholder="Search by title, type, order or file name…"
        emptyTitle="No documents yet"
        emptyDescription="Documents appear here as orders progress and each stage produces its paperwork."
        pageSize={50}
      />
    </PageShell>
  );
}
