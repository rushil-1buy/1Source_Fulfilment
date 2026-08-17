/**
 * Every document on an order, written to disk in the order the flow produced
 * them.
 *
 * For working through the flow by hand: open the folder, read top to bottom,
 * and the paperwork tells the story of the trade in the sequence it happened.
 *
 * THE NAMING IS THE POINT. Files are prefixed with a zero-padded sequence taken
 * from the STAGE LADDER, not from the filename or the timestamp. Sorting by
 * name in any file browser then gives the true order of the flow — which
 * alphabetical stage codes do not, because B10 sorts before B2 and D5a sorts
 * between D5 and D6. The stage code is kept in the name after the sequence, so
 * a file can still be tied back to the step that filed it.
 *
 *   01_A1_customer-purchase-order_CPO-ACME-S0001.txt
 *   02_A2_approved-vendor-record.txt
 *   ...
 *   27_G5_bank-credit-advice.txt
 *
 * Run:  npx tsx scripts/export-documents.ts [alias]
 * With no alias every order is exported, each into its own folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '../lib/generated/prisma';
import { applicableStages, getStage } from '../lib/domain/stages';
import { stageContextFrom, STAGE_CONTEXT_INCLUDE } from '../lib/domain/stage-context';
import { docFlowFor } from '../lib/domain/document-flow';
import { STAKEHOLDER_META } from '../lib/domain/enums';

const db = new PrismaClient();

const OUT = path.resolve(process.cwd(), 'document-exports');

/** A filename fragment that survives every file system we might land on. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

async function exportOrder(alias: string): Promise<number> {
  const wo = await db.workOrder.findFirst({
    where: { alias },
    include: {
      ...STAGE_CONTEXT_INCLUDE,
      documents: { orderBy: { createdAt: 'asc' } },
      customerPo: { include: { customer: true } },
      supplierPo: { include: { supplier: true } },
    },
  });
  if (!wo) {
    console.error(`  ! no order with alias ${alias}`);
    return 0;
  }

  const ctx = stageContextFrom(wo as Parameters<typeof stageContextFrom>[0]);
  /** Ladder position per stage — the true order of the flow. */
  const order = new Map(applicableStages(ctx).map((s, i) => [s.id, i]));

  /*
   * Sorted by where the step sits on the ladder, then by when it was filed.
   * Documents with no stage recorded go last rather than first: they are the
   * ones the flow cannot place, and burying them at the top would put unplaced
   * paperwork in front of the customer's purchase order.
   */
  const docs = [...wo.documents].sort((a, b) => {
    const ai = a.stageId ? (order.get(a.stageId) ?? 9_000) : 9_999;
    const bi = b.stageId ? (order.get(b.stageId) ?? 9_000) : 9_999;
    return ai - bi || a.createdAt.getTime() - b.createdAt.getTime();
  });

  const dir = path.join(OUT, slug(wo.alias));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const index: string[] = [
    `DOCUMENTS — ${wo.alias}`,
    `${wo.canonicalName}`,
    '',
    `Customer   ${wo.customerPo.customer.name}`,
    `Supplier   ${wo.supplierPo.supplier.name}`,
    `Bought on  ${wo.incoterms}    Sold on  ${wo.customerPo.incoterms ?? '—'}`,
    `Payment    ${wo.paymentMethod}`,
    `Stage      ${getStage(wo.stage).code} ${getStage(wo.stage).label}`,
    '',
    'Files are numbered in the order the flow produced them. Sort by name and you are',
    'reading the trade in sequence.',
    '',
    'No.  Step  Document                                  Provided by / needed by',
    '─'.repeat(96),
  ];

  docs.forEach((d, i) => {
    const seq = String(i + 1).padStart(2, '0');
    const stage = d.stageId ? getStage(d.stageId) : null;
    const code = stage?.code ?? 'XX';
    const name = `${seq}_${code}_${slug(d.title)}.txt`;

    const flow = docFlowFor(d.docType);
    const provided = flow ? STAKEHOLDER_META[flow.provider].label : 'Not on the document map';
    const needed = flow?.requiredBy.length
      ? flow.requiredBy.map((r) => STAKEHOLDER_META[r].short).join(', ')
      : 'Internal only';

    /*
     * A header on every file.
     *
     * A document opened from a folder has none of the screen around it, so it
     * has to carry its own provenance: which order, which step, who owed it and
     * who was waiting on it. Without that a folder of text files is a folder of
     * text files.
     */
    const header = [
      '='.repeat(78),
      `${d.title}`,
      '='.repeat(78),
      `Order          ${wo.alias}  ·  ${wo.canonicalName}`,
      `Step           ${stage ? `${stage.code} — ${stage.label}` : 'Not tied to a step'}`,
      `Document type  ${d.docType}`,
      `Filed by       ${d.uploadedBy}`,
      `Filed on       ${d.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`,
      `Provided by    ${provided}`,
      `Needed by      ${needed}`,
      flow ? `Why           ${flow.why}` : '',
      '='.repeat(78),
      '',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    fs.writeFileSync(
      path.join(dir, name),
      header + (d.bodyText ?? 'No content was captured for this document.') + '\n',
      'utf8',
    );

    index.push(
      `${seq}   ${code.padEnd(5)} ${d.title.slice(0, 40).padEnd(41)} ${provided} → ${needed}`,
    );
  });

  index.push('', `${docs.length} documents.`);
  fs.writeFileSync(path.join(dir, '00_INDEX.txt'), index.join('\n') + '\n', 'utf8');

  console.log(`  ${wo.alias.padEnd(16)} ${String(docs.length).padStart(3)} documents → ${dir}`);
  return docs.length;
}

async function main() {
  const only = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });

  const orders = await db.workOrder.findMany({
    where: only ? { alias: only } : undefined,
    orderBy: { alias: 'asc' },
    select: { alias: true },
  });

  if (orders.length === 0) {
    console.error(only ? `No order with alias ${only}.` : 'No orders to export.');
    process.exit(1);
  }

  console.log(`Exporting ${orders.length} order${orders.length === 1 ? '' : 's'} to ${OUT}\n`);
  let total = 0;
  for (const o of orders) total += await exportOrder(o.alias);
  console.log(`\n${total} documents written.`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
