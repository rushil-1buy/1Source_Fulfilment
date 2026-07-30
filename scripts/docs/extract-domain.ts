import { writeFileSync } from 'node:fs';
import { PHASES, PHASE_DEFS, STAGE_DEFS } from '@/lib/domain/stages';
import { STAGE_EVIDENCE } from '@/lib/domain/stage-evidence';
import { subTasksFor, TESTING_STANDARDS } from '@/lib/domain/stage-tasks';
import { NAV_GROUPS } from '@/lib/nav';
import { INCOTERM_DEFS } from '@/lib/domain/incoterms';
import { STAKEHOLDER_META, PAYMENT_METHOD_META, TEST_SCOPE_META } from '@/lib/domain/enums';

const ev = new Map(STAGE_EVIDENCE.map((e) => [e.stageId, e]));

const out = {
  phases: PHASES.map((p) => ({ ...PHASE_DEFS[p] })),
  stages: STAGE_DEFS.map((s) => {
    const e = ev.get(s.id);
    return {
      id: s.id, code: s.code, phase: s.phase, label: s.label, plainLabel: s.plainLabel,
      description: s.description, exitCriteria: s.exitCriteria, owner: s.owner,
      expectedHours: s.expectedHours, artifacts: s.artifacts, nextAction: s.nextAction,
      nextActionOwner: s.nextActionOwner, isExceptionBranch: !!s.isExceptionBranch,
      isTerminal: !!s.isTerminal, conditional: !!s.applies,
      attestation: e?.attestation ?? null,
      fields: (e?.fields ?? []).map((f) => ({ id: f.id, label: f.label, type: f.type, required: !!f.required, help: f.help, options: f.options ?? null, unit: f.unit ?? null })),
      documents: (e?.documents ?? []).map((d) => ({ id: d.id, label: d.label, required: !!d.required, help: d.help })),
      subTasks: subTasksFor(s.id).map((t) => ({ kind: t.kind, label: t.label, detail: t.detail, owner: t.owner, required: t.required, standard: t.standard ?? null })),
    };
  }),
  nav: NAV_GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items.map((i) => ({ href: i.href, label: i.label, plainLabel: i.plainLabel, hint: i.hint, children: i.children ?? [] })) })),
  incoterms: Object.values(INCOTERM_DEFS).map((i) => ({ code: i.code, name: i.name, mode: i.mode, deliveryPoint: i.deliveryPoint, riskTransfersAt: i.riskTransfersAt, carriage: i.carriage, insurance: i.insurance, exportClearance: i.exportClearance, importClearance: i.importClearance, implies: i.implies, watchOut: i.watchOut })),
  standards: TESTING_STANDARDS,
  stakeholders: STAKEHOLDER_META,
  paymentMethods: PAYMENT_METHOD_META,
  testScopes: TEST_SCOPE_META,
};

writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const fieldCount = out.stages.reduce((a, s) => a + s.fields.length, 0);
const docCount = out.stages.reduce((a, s) => a + s.documents.length, 0);
const taskCount = out.stages.reduce((a, s) => a + s.subTasks.length, 0);
console.log(`phases=${out.phases.length} stages=${out.stages.length} fields=${fieldCount} documents=${docCount} subTasks=${taskCount} screens=${out.nav.reduce((a,g)=>a+g.items.length,0)} incoterms=${out.incoterms.length}`);
