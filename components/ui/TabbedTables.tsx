'use client';

/**
 * Several modules are naturally a set of registers rather than one list —
 * Warehouse has receipts, inspections, repacking and deliveries; Tax has the
 * output register, credit ledger, reverse charge, way bills and returns.
 *
 * Each section is a full RecordTable, so they all keep the §8.1 guarantees, and
 * the tab strip scrolls inside itself so it never widens the page.
 */

import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { RecordTable, type ColumnSpec, type RecordRow } from './RecordTable';
import { AddRecordButton } from './AddRecordDialog';
import { EmptyState, Panel } from './Layout';
import { cn } from '@/lib/utils';

export interface TableSection {
  id: string;
  label: string;
  /** One line explaining what this register is for. */
  description?: string;
  columns: ColumnSpec[];
  rows: RecordRow[];
  emptyTitle?: string;
  emptyDescription?: string;
  /** Overrides the noun in the pagination bar; defaults to the tab label. */
  rowNoun?: string;
  /**
   * When set, an Add button appears in this section's toolbar, opening the form
   * declared for that directory in lib/domain/master-forms.ts.
   */
  addType?: string;
}

export function TabbedTables({ sections }: { sections: TableSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  if (sections.length === 0) {
    return (
      <Panel>
        <EmptyState title="Nothing to show" description="No records exist for this module yet." />
      </Panel>
    );
  }

  return (
    <Tabs.Root value={active} onValueChange={setActive} className="min-w-0">
      <Tabs.List className="border-line-subtle mb-3 flex min-w-0 gap-0.5 overflow-x-auto border-b pb-px">
        {sections.map((s) => (
          <Tabs.Trigger
            key={s.id}
            value={s.id}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-t-[8px] border-b-2 border-transparent px-2.5 py-2 text-[12.5px] whitespace-nowrap transition-colors',
              'data-[state=active]:border-accent data-[state=active]:text-accent-text data-[state=active]:font-medium',
              'text-fg-secondary hover:text-fg hover:bg-surface-3',
            )}
          >
            {s.label}
            {s.rows.length > 0 && (
              <span className="bg-surface-3 text-fg-tertiary tnum rounded-full px-1.5 text-[10px]">
                {s.rows.length}
              </span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {sections.map((s) => (
        <Tabs.Content key={s.id} value={s.id} className="min-w-0 outline-none">
          {s.description && (
            <p className="text-fg-tertiary mb-2.5 max-w-[min(95ch,100%)] text-[12px] leading-relaxed">
              {s.description}
            </p>
          )}
          <RecordTable
            columns={s.columns}
            rows={s.rows}
            exportName={s.id}
            searchPlaceholder={`Search ${s.label.toLowerCase()}…`}
            emptyTitle={s.emptyTitle ?? `No ${s.label.toLowerCase()} yet`}
            emptyDescription={s.emptyDescription}
            rowNoun={s.rowNoun ?? s.label.toLowerCase()}
            primaryAction={s.addType ? <AddRecordButton type={s.addType} /> : undefined}
          />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
