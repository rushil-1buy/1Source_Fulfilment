/**
 * Parses prisma/schema.prisma into structured JSON.
 *
 * Written rather than pulled from a library because the doc comments (///) are
 * the most valuable part of this schema — they carry the reasoning — and most
 * parsers discard them.
 */
const fs = require('node:fs');

const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');

const models = [];
let cur = null;
let pending = [];   // /// doc comments waiting for the next declaration
let fileHeader = [];
let inHeader = true;

const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Decimal', 'BigInt']);

for (const raw of lines) {
  const line = raw.trim();

  if (inHeader) {
    if (line.startsWith('//') && !line.startsWith('///')) { fileHeader.push(line.replace(/^\/+\s?/, '')); continue; }
    if (line === '') continue;
    inHeader = false;
  }

  if (line.startsWith('///')) { pending.push(line.replace(/^\/\/\/\s?/, '')); continue; }
  if (line.startsWith('//')) continue;

  const m = /^model\s+(\w+)\s*\{/.exec(line);
  if (m) {
    cur = { name: m[1], doc: pending.join(' '), fields: [], indexes: [], uniques: [], id: null };
    models.push(cur);
    pending = [];
    continue;
  }
  if (line === '}') { cur = null; pending = []; continue; }
  if (!cur) { pending = []; continue; }

  // Block attributes.
  if (line.startsWith('@@')) {
    const idx = /@@index\(\[([^\]]+)\]/.exec(line);
    if (idx) cur.indexes.push(idx[1].split(',').map((x) => x.trim()));
    const uq = /@@unique\(\[([^\]]+)\]/.exec(line);
    if (uq) cur.uniques.push(uq[1].split(',').map((x) => x.trim()));
    pending = [];
    continue;
  }

  const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
  if (!f) { pending = []; continue; }
  const [, name, type, list, opt, rest] = f;

  const rel = /@relation\(([^)]*)\)/.exec(rest);
  const field = {
    name,
    type,
    list: Boolean(list),
    optional: Boolean(opt),
    scalar: SCALARS.has(type),
    isId: /@id\b/.test(rest),
    unique: /@unique\b/.test(rest),
    default: (/@default\(([^)]*)\)/.exec(rest) || [])[1] ?? null,
    updatedAt: /@updatedAt\b/.test(rest),
    relation: rel ? rel[1] : null,
    onDelete: (/onDelete:\s*(\w+)/.exec(rest) || [])[1] ?? null,
    fk: (/fields:\s*\[([^\]]+)\]/.exec(rest) || [])[1] ?? null,
    refs: (/references:\s*\[([^\]]+)\]/.exec(rest) || [])[1] ?? null,
    doc: pending.join(' '),
  };
  if (field.isId) cur.id = name;
  cur.fields.push(field);
  pending = [];
}

// Relations, derived from the relation-bearing side.
const byName = new Map(models.map((m) => [m.name, m]));
const relations = [];
for (const m of models) {
  for (const f of m.fields) {
    if (f.scalar || f.list) continue;
    if (!byName.has(f.type)) continue;
    if (!f.fk) continue; // this is the owning side
    relations.push({
      from: m.name,
      to: f.type,
      field: f.name,
      fk: f.fk,
      optional: f.optional,
      onDelete: f.onDelete ?? 'None',
    });
  }
}

const stats = {
  models: models.length,
  fields: models.reduce((a, m) => a + m.fields.filter((f) => f.scalar).length, 0),
  relationFields: models.reduce((a, m) => a + m.fields.filter((f) => !f.scalar).length, 0),
  relations: relations.length,
  indexes: models.reduce((a, m) => a + m.indexes.length, 0),
  uniques: models.reduce((a, m) => a + m.uniques.length + m.fields.filter((f) => f.unique).length, 0),
  documented: models.filter((m) => m.doc).length,
};

fs.writeFileSync(process.argv[3], JSON.stringify({ fileHeader, models, relations, stats }, null, 1));
console.log(JSON.stringify(stats));
