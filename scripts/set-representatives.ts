/**
 * Only two individuals represent 1BUY — Ankit Sharma (Vice President) and
 * Akash Dwivedi (Manager). This collapses the seeded roster onto those two and
 * rewrites every denormalised actor name already sitting in records, so no
 * retired name survives anywhere on screen or on a printed document.
 *
 * Ankit carries the approving/compliance side, Akash the operating side. Both
 * hold Finance access because the final escrow release requires two distinct
 * Finance approvers and there are exactly two people.
 */

import { PrismaClient } from '@/lib/generated/prisma';

const db = new PrismaClient();

const ANKIT = 'Ankit Sharma';
const AKASH = 'Akash Dwivedi';

/** Retired name → who now does that job. */
const MAP: Record<string, string> = {
  'Anita Rao': ANKIT,
  'Meera Iyer': ANKIT,
  'Anil Verma': ANKIT,
  'Sameer Mehta': AKASH,
  'Kiran Kumar': AKASH,
  'Dev Sharma': AKASH,
  'Priya Nair': AKASH,
  Priya: AKASH,
};

/** Rewrites any retired name found inside a free-text string. */
function rewrite(v: string | null): string | null {
  if (!v) return v;
  let out = v;
  for (const [from, to] of Object.entries(MAP)) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

async function main() {
  // ── 1. The roster ────────────────────────────────────────────────────────
  const ankit = await db.user.upsert({
    where: { email: 'ankit.sharma@1buy.ai' },
    update: { name: ANKIT, role: 'Finance', title: 'Vice President', initials: 'AS', active: true },
    create: {
      name: ANKIT,
      email: 'ankit.sharma@1buy.ai',
      role: 'Finance',
      title: 'Vice President',
      initials: 'AS',
    },
  });
  const akash = await db.user.upsert({
    where: { email: 'akash.dwivedi@1buy.ai' },
    update: { name: AKASH, role: 'Finance', title: 'Manager', initials: 'AD', active: true },
    create: {
      name: AKASH,
      email: 'akash.dwivedi@1buy.ai',
      role: 'Finance',
      title: 'Manager',
      initials: 'AD',
    },
  });

  // Everyone retired is repointed at one of the two, then deactivated. Their
  // rows stay so historic foreign keys (approvals, transitions) remain valid —
  // an audit trail that loses its author is not an audit trail.
  const retiring = await db.user.findMany({
    where: { name: { in: Object.keys(MAP) } },
  });
  for (const u of retiring) {
    const heir = MAP[u.name] === ANKIT ? ankit : akash;
    // Move every reference off the retired row before parking it.
    await db.stageTransition.updateMany({ where: { actorId: u.id }, data: { actorId: heir.id } });
    await db.auditLogEntry.updateMany({ where: { actorId: u.id }, data: { actorId: heir.id } });
    await db.task.updateMany({ where: { ownerId: u.id }, data: { ownerId: heir.id } });
    await db.communication.updateMany({ where: { loggedById: u.id }, data: { loggedById: heir.id } });
    await db.inspectionReport.updateMany({
      where: { inspectorId: u.id },
      data: { inspectorId: heir.id },
    });
    await db.escrowApproval.updateMany({
      where: { approverId: u.id },
      data: { approverId: heir.id },
    });
    await db.user.delete({ where: { id: u.id } });
  }

  // Rushil Kohli is the signed-in operator, not a stand-in representative, so
  // the account stays — but it is titled so documents never print a bare name.
  await db.user.updateMany({
    where: { email: 'rushil@1buy.ai' },
    data: { title: 'Administrator' },
  });

  console.log(`Roster: ${ANKIT} (Vice President) · ${AKASH} (Manager) · retired ${retiring.length}`);

  // ── 2. Denormalised names already written into records ───────────────────
  // Rather than hand-listing columns and missing some, sweep every TEXT column
  // in the database. A retired name is equally wrong in a shipment's actor field
  // and in the middle of an email body, so both get the same treatment.
  const tables: { name: string }[] = await db.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
  );

  const EMAILS: Record<string, string> = {
    'anita.rao@1buy.ai': 'ankit.sharma@1buy.ai',
    'meera.iyer@1buy.ai': 'ankit.sharma@1buy.ai',
    'anil.verma@1buy.ai': 'ankit.sharma@1buy.ai',
    'sameer.mehta@1buy.ai': 'akash.dwivedi@1buy.ai',
    'kiran.kumar@1buy.ai': 'akash.dwivedi@1buy.ai',
    'dev.sharma@1buy.ai': 'akash.dwivedi@1buy.ai',
    'priya.nair@1buy.ai': 'akash.dwivedi@1buy.ai',
  };
  const ALL = { ...MAP, ...EMAILS };

  let touched = 0;
  for (const t of tables) {
    const cols: { name: string; type: string; pk: number }[] = await db.$queryRawUnsafe(
      `PRAGMA table_info('${t.name}')`,
    );
    // PRAGMA returns numbers as BigInt through the raw driver, so compare loosely.
    // Identifier columns are skipped: a cuid may happen to contain a retired name
    // as a substring, and rewriting a key would break every row that points at it.
    const textCols = cols.filter(
      (c) =>
        /CHAR|TEXT|CLOB/i.test(c.type) &&
        Number(c.pk) === 0 &&
        c.name !== 'id' &&
        !/Id$/.test(c.name),
    );
    for (const c of textCols) {
      for (const [from, to] of Object.entries(ALL)) {
        // The unique index on User.email would collide if two rows converged, but
        // the retired rows are already gone, so nothing can.
        const n = await db.$executeRawUnsafe(
          `UPDATE "${t.name}" SET "${c.name}" = replace("${c.name}", ?, ?) WHERE "${c.name}" LIKE ?`,
          from,
          to,
          `%${from}%`,
        );
        if (n > 0) {
          touched += n;
          console.log(`  ${t.name}.${c.name}: ${n} row(s) — "${from}" -> "${to}"`);
        }
      }
    }
  }

  // The "Attn" line printed on documents the supplier replies to.
  const org = await db.orgSetting.findFirst();
  if (org) {
    await db.orgSetting.update({
      where: { id: org.id },
      data: { contactAttn: `Mr. ${ANKIT} — VP & Mr. ${AKASH} — MGR` },
    });
  }

  console.log(`\nRewrote ${touched} field value(s) carrying a retired name.`);

  const left = await db.user.findMany({ orderBy: { name: 'asc' } });
  console.log('\nFinal roster:');
  for (const u of left) console.log(`  ${u.name.padEnd(15)} ${(u.title ?? '—').padEnd(15)} ${u.role}`);

  await db.$disconnect();
}

main();
