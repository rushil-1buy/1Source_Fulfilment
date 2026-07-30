import { PrismaClient } from '@/lib/generated/prisma';
const db = new PrismaClient();
async function main() {
  const wo = await db.workOrder.findFirst({
    where: { alias: 'WO-2026-0113' },
    include: {
      escrowAccount: { include: { transactions: { include: { approvals: { include: { approver: true } } } } } },
      customsEntry: true,
      grns: true, inspections: true, repackJobs: true, pods: true,
      taxInvoices: { include: { lines: true, eWayBills: true } },
      itcEntries: true,
      transitions: true, communications: true, documents: true, auditEntries: true,
      shipments: true,
    },
  });
  if (!wo) return;
  console.log('=== WO-2026-0113 after a fully manual walk to closure ===');
  console.log('stage / status  ', wo.stage, '/', wo.status, '| closed', wo.closedAt?.toISOString().slice(0,10));
  console.log('artifacts       ', `${wo.transitions.length} transitions · ${wo.communications.length} communications · ${wo.shipments.length} shipments · ${wo.grns.length} goods receipts · ${wo.inspections.length} inspections · ${wo.repackJobs.length} repack jobs · ${wo.pods.length} delivery proofs · ${wo.taxInvoices.length} invoices · ${wo.itcEntries.length} credit entries · ${wo.auditEntries.length} audit rows`);

  const fin = wo.escrowAccount?.transactions.find(t => t.type === 'FINAL_RELEASE');
  console.log('\n=== Dual authorisation on the final release (AC#23) ===');
  console.log('amount     ₹' + ((fin?.amount ?? 0) / 100).toLocaleString('en-IN'));
  console.log('approvers  ', fin?.approvals.map(a => `${a.approver.name} (${a.approver.role})`).join(' + '));
  console.log('distinct   ', new Set(fin?.approvals.map(a => a.approverId)).size, 'approver(s)');

  const ce = wo.customsEntry;
  console.log('\n=== Landed cost rule in the live flow (AC#26) ===');
  console.log('duty paid to customs  ₹' + ((ce?.totalDuty ?? 0)/100).toLocaleString('en-IN'));
  console.log('  real cost (BCD+SWS) ₹' + (((ce?.dutyBcd ?? 0)+(ce?.dutySws ?? 0))/100).toLocaleString('en-IN'), '  <- included in landed cost');
  console.log('  recoverable (IGST)  ₹' + ((ce?.dutyIgst ?? 0)/100).toLocaleString('en-IN'), '  <- EXCLUDED from landed cost');
  console.log('credit ledger entries ', wo.itcEntries.map(i => `${i.source} ₹${(i.totalCredit/100).toLocaleString('en-IN')}`).join(', '));

  const inv = wo.taxInvoices[0];
  console.log('\n=== Invoice raised at dispatch, not after delivery ===');
  const dispatchTxn = wo.transitions.find(t => t.toStage === 'OUTBOUND_BOOKED');
  const podTxn = wo.transitions.find(t => t.toStage === 'POD_ISSUED_TO_CUSTOMER');
  console.log('invoice        ', inv?.invoiceNumber, '|', inv?.taxTreatment, '| total ₹' + ((inv?.totalAmount ?? 0)/100).toLocaleString('en-IN'));
  console.log('invoice dated  ', inv?.invoiceDate.toISOString());
  console.log('dispatch stage ', dispatchTxn?.createdAt.toISOString());
  console.log('delivery proof ', podTxn?.createdAt.toISOString());
  console.log('invoice before delivery proof?', inv && podTxn ? (inv.invoiceDate <= podTxn.createdAt ? 'YES — correct' : 'NO') : 'n/a');
  console.log('e-way bill     ', inv?.eWayBills[0]?.ewbNumber ?? 'none (below threshold)');
  console.log('e-invoice      ', inv?.eInvoiceStatus, inv?.irn ? '(reference present)' : '(no reference — manual mode)');

  console.log('\n=== Provenance across the walk (AC#20) ===');
  const byProv = new Map<string, number>();
  for (const t of wo.transitions) byProv.set(t.provenance, (byProv.get(t.provenance) ?? 0) + 1);
  console.log([...byProv].map(([k,v]) => `${k}=${v}`).join(' '));
  await db.$disconnect();
}
main();
