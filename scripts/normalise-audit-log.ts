/**
 * Brings the seeded audit rows into the shape the log now uses: a readable field
 * label, and a real before value on a stage change.
 *
 * A live audit log must never be rewritten — these rows are fabricated demo
 * history, written before the log's shape settled, so normalising them once is
 * about the demo reading correctly rather than about editing a real record.
 */
import { PrismaClient } from '@/lib/generated/prisma';
import { getStage } from '@/lib/domain/stages';
const db = new PrismaClient();

async function main() {
  let n = 0;

  // Raw stage ids → labels, with the previous stage as the "from".
  const stageRows = await db.auditLogEntry.findMany({
    where: { field: 'stage' },
    orderBy: [{ workOrderId: 'asc' }, { createdAt: 'asc' }],
  });
  const prevByOrder = new Map<string, string>();
  for (const r of stageRows) {
    const label = getStage(r.afterValue ?? '')?.label ?? r.afterValue;
    const before = prevByOrder.get(r.workOrderId ?? '') ?? null;
    await db.auditLogEntry.update({
      where: { id: r.id },
      data: { field: 'Stage', entity: 'Work order stage', beforeValue: before, afterValue: label },
    });
    if (r.workOrderId && label) prevByOrder.set(r.workOrderId, label);
    n++;
  }

  n += (await db.auditLogEntry.updateMany({
    where: { field: 'canonicalName' },
    data: { field: 'Work order name', entity: 'Work order' },
  })).count;

  n += (await db.auditLogEntry.updateMany({
    where: { entity: 'WorkOrder', field: null },
    data: { field: 'Work order name', entity: 'Work order' },
  })).count;

  n += (await db.auditLogEntry.updateMany({
    where: { entity: 'WorkOrder' },
    data: { entity: 'Work order' },
  })).count;

  /**
   * Rows whose afterValue is a sentence like "Field: old → new" were written by
   * an earlier version that lumped several changes into one row. Split them into
   * the per-field shape so every row has a real field, before and after.
   */
  const lumped = await db.auditLogEntry.findMany({
    where: { afterValue: { contains: ' → ' } },
  });
  for (const r of lumped) {
    const parts = (r.afterValue ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    const parsed = parts
      .map((part) => part.match(/^(.+?):\s*(.*?)\s*→\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m));
    if (parsed.length === 0) continue;

    // Each change becomes its own row, timestamped as the original was.
    await db.auditLogEntry.createMany({
      data: parsed.map((m) => ({
        workOrderId: r.workOrderId,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        field: m[1].trim(),
        beforeValue: m[2].trim() === '—' || m[2].trim() === '' ? null : m[2].trim(),
        afterValue: m[3].trim() === '—' || m[3].trim() === '' ? null : m[3].trim(),
        reason: r.reason,
        provenance: r.provenance,
        actorId: r.actorId,
        actorLabel: r.actorLabel,
        createdAt: r.createdAt,
      })),
    });
    // Also keep the name change the old row was carrying in beforeValue.
    await db.auditLogEntry.delete({ where: { id: r.id } });
    n += parsed.length;
    console.log(`  split a lumped row into ${parsed.length}: ${parsed.map((m) => m[1].trim()).join(', ')}`);
  }

  /** The other lumped form an earlier version wrote: "Field set to value; …". */
  const setTo = await db.auditLogEntry.findMany({
    where: { afterValue: { contains: ' set to ' } },
  });
  for (const r of setTo) {
    const parsed = (r.afterValue ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((part) => part.match(/^(.+?)\s+set to\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m));
    if (parsed.length === 0) continue;
    await db.auditLogEntry.createMany({
      data: parsed.map((m) => ({
        workOrderId: r.workOrderId,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        field: m[1].trim(),
        beforeValue: null,
        afterValue: m[2].trim() === 'blank' ? null : m[2].trim(),
        reason: r.reason,
        provenance: r.provenance,
        actorId: r.actorId,
        actorLabel: r.actorLabel,
        createdAt: r.createdAt,
      })),
    });
    await db.auditLogEntry.delete({ where: { id: r.id } });
    n += parsed.length;
    console.log(`  split a "set to" row into ${parsed.length}: ${parsed.map((m) => m[1].trim()).join(', ')}`);
  }

  // Raw key paths as field names, e.g. "SUPPLIER_PO_ISSUED.supplierPo".
  const rawKeys = await db.auditLogEntry.findMany({ where: { field: { contains: '.' } } });
  for (const r of rawKeys) {
    const m = (r.afterValue ?? '').match(/^Attached "(.+?)" as (.+)$/);
    await db.auditLogEntry.update({
      where: { id: r.id },
      data: m
        ? { field: m[2], afterValue: m[1], entity: 'Stage document' }
        : { field: (r.field ?? '').split('.').pop() ?? r.field },
    });
    n++;
  }

  n += (await db.auditLogEntry.updateMany({
    where: { entity: 'StageEvidence' },
    data: { entity: 'Stage evidence' },
  })).count;

  /** Model names read as code; the log is read by people. */
  const ENTITY_LABELS: Record<string, string> = {
    Document: 'Document',
    ExceptionRecord: 'Problem raised',
    IntegrationConnector: 'Connector setting',
    SupplierPO: 'Supplier purchase order',
    CustomerPO: 'Customer purchase order',
    ProformaInvoice: 'Proforma invoice',
    TaxInvoice: 'Tax invoice',
    StageEvidence: 'Stage evidence',
    WorkOrder: 'Work order',
  };
  for (const [from, to] of Object.entries(ENTITY_LABELS)) {
    if (from === to) continue;
    n += (await db.auditLogEntry.updateMany({ where: { entity: from }, data: { entity: to } })).count;
  }

  // A row with no field names nothing, which defeats the point of a log line.
  // Fall back to the record it belongs to.
  const fieldless = await db.auditLogEntry.findMany({ where: { field: null } });
  for (const r of fieldless) {
    await db.auditLogEntry.update({
      where: { id: r.id },
      data: { field: r.entity },
    });
    n++;
  }

  console.log(`Normalised ${n} audit row(s).`);

  const sample = await db.auditLogEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('\nfield'.padEnd(21), 'from'.padEnd(24), 'to');
  for (const a of sample) {
    console.log(
      (a.field ?? '—').padEnd(20),
      (a.beforeValue ?? '(not set)').slice(0, 23).padEnd(24),
      (a.afterValue ?? '(cleared)').slice(0, 34),
    );
  }
  await db.$disconnect();
}
main();
