/**
 * Builds a self-contained HTML reference for the database design.
 *
 * Self-contained on purpose: this goes to a tech team who will open it from a
 * file share or an email attachment, quite possibly with no network. Every style
 * and script is inline, there are no font or CDN requests, and it works from
 * file:// as it does from a server.
 *
 * Everything is read out of the parsed schema, including the /// doc comments —
 * which are the most valuable part of this schema, because they carry the
 * reasoning rather than just the shape.
 */

const fs = require('node:fs');
const path = require('node:path');

const { fileHeader, models, relations, stats } = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'),
);
const rawSchema = fs.readFileSync(process.argv[2], 'utf8');
const { erd, dfd0, dfd1 } = require('./diagrams.js');

// ── Domain grouping ─────────────────────────────────────────────────────────
// Ordered so the file reads in the direction data flows through the business,
// not alphabetically — a reader following one order top to bottom finds the
// tables in the sequence they are written to.
const GROUPS = [
  {
    id: 'identity',
    title: 'Identity & configuration',
    blurb:
      'Who uses the system and how the organisation itself is configured. Thresholds live here rather than in code so an ops lead can change them without a deploy.',
    models: ['User', 'OrgSetting', 'NumberingSeries', 'GlossaryTerm', 'SavedView'],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    blurb:
      'One row per external system and one per call made to it. Every call is logged with its latency, attempt number and correlation id, so a dispute about what a third party was told is answerable.',
    models: ['IntegrationConnector', 'IntegrationCallLog'],
  },
  {
    id: 'masters',
    title: 'Master data',
    blurb:
      'Reference data an order points at rather than copies. The AVL is the control that keeps buying inside franchised distribution.',
    models: ['Customer', 'Supplier', 'AVLRecord', 'MpnCatalogueItem', 'HsnRate', 'TestParameterMaster', 'Carrier', 'TestingLab'],
  },
  {
    id: 'orders',
    title: 'Orders, quotes & the work order',
    blurb:
      'The four documents that define an order, the lines on each, the mapping between customer demand and supplier supply, and the work order that ties them together. POLinkMapping is the join that carries the allocated quantity and both prices, line by line.',
    models: ['CustomerPO', 'CustomerPOLine', 'ProformaInvoice', 'PILine', 'SupplierPO', 'SupplierPOLine', 'POLinkMapping', 'WorkOrder', 'StageTransition'],
  },
  {
    id: 'escrow',
    title: 'Escrow',
    blurb:
      'Money held by a neutral third party, every movement against it, the approvals that authorised each, and any dispute raised.',
    models: ['EscrowAccount', 'EscrowTransaction', 'EscrowApproval', 'EscrowDispute'],
  },
  {
    id: 'testing',
    title: 'Independent testing',
    blurb:
      'The request sent to the laboratory, the verdict that came back, and the per-line detail behind it.',
    models: ['TestRequest', 'TestResult', 'TestLineResult'],
  },
  {
    id: 'logistics',
    title: 'Logistics',
    blurb: 'Shipment legs with their tracking history, and the proof that delivery happened.',
    models: ['Shipment', 'TrackingEvent', 'ProofOfDelivery'],
  },
  {
    id: 'customs',
    title: 'Customs',
    blurb:
      'The Bill of Entry and everything that happens to it — status changes from ICEGATE and any query raised against the declaration.',
    models: ['CustomsEntry', 'CustomsStatusEvent', 'CustomsQuery'],
  },
  {
    id: 'warehouse',
    title: 'Receipt, inspection & value-add',
    blurb:
      'What physically arrived, what the inspection found line by line, and the repack that turns a supplier’s carton into the customer’s.',
    models: ['Grn', 'GrnLine', 'InspectionReport', 'InspectionChecklistItem', 'RepackJob'],
  },
  {
    id: 'tax',
    title: 'Tax & statutory',
    blurb:
      'Outward invoices with their lines, credit notes, e-way bills, and the two registers that decide what is recoverable: input tax credit and reverse-charge self-invoices. TaxPeriodSummary is the rollup a return is filed from.',
    models: ['TaxInvoice', 'TaxInvoiceLine', 'CreditNote', 'EWayBill', 'InputTaxCredit', 'ReverseChargeSelfInvoice', 'TaxPeriodSummary'],
  },
  {
    id: 'evidence',
    title: 'Evidence, flow overlays & audit',
    blurb:
      'What proves each stage happened, the per-order deviations from the standard ladder, and the append-only record of every change with its reason.',
    models: ['Document', 'StageEvidence', 'StageEvidenceRevision', 'CustomStage', 'OrderPhasePlan', 'AuditLogEntry'],
  },
  {
    id: 'ops',
    title: 'Communication, tasks & exceptions',
    blurb:
      'Everything said about an order, everything owed on it, and everything that went wrong with it.',
    models: ['Communication', 'CommunicationParticipant', 'CommunicationContext', 'Task', 'ExceptionRecord'],
  },
];

const byName = new Map(models.map((m) => [m.name, m]));
const grouped = new Set(GROUPS.flatMap((g) => g.models));
const ungrouped = models.filter((m) => !grouped.has(m.name)).map((m) => m.name);
if (ungrouped.length) {
  GROUPS.push({ id: 'other', title: 'Other', blurb: 'Not yet grouped.', models: ungrouped });
}

const groupOf = new Map();
for (const g of GROUPS) for (const n of g.models) groupOf.set(n, g);

// Inbound / outbound relations per model.
const out = new Map();
const inb = new Map();
for (const r of relations) {
  if (!out.has(r.from)) out.set(r.from, []);
  out.get(r.from).push(r);
  if (!inb.has(r.to)) inb.set(r.to, []);
  inb.get(r.to).push(r);
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── Field row ───────────────────────────────────────────────────────────────
function fieldRow(f, model) {
  const flags = [];
  if (f.isId) flags.push('<span class="fl id">PK</span>');
  if (f.unique) flags.push('<span class="fl uq">unique</span>');
  if (f.fk) flags.push('<span class="fl fk">FK</span>');
  if (f.updatedAt) flags.push('<span class="fl">updatedAt</span>');
  // Money is the one convention worth flagging inline — it is an integer in
  // minor units everywhere, and reading it as rupees is the classic mistake.
  const money = /(?:Amount|Value|Total|Price|Cost|Duty|Fee|Tax|Freight|Limit|Bcd|Sws|Igst|Cess)$/i.test(f.name) && f.type === 'Int';
  if (money) flags.push('<span class="fl money">minor units</span>');

  const type = `${esc(f.type)}${f.list ? '[]' : ''}${f.optional ? '?' : ''}`;
  const rel = f.fk
    ? `→ <a href="#m-${esc(f.type)}">${esc(f.type)}</a>${f.onDelete ? ` <span class="od">on delete ${esc(f.onDelete)}</span>` : ''}`
    : !f.scalar && byName.has(f.type)
      ? `↔ <a href="#m-${esc(f.type)}">${esc(f.type)}</a>`
      : '';

  return `<tr class="${f.scalar ? '' : 'relrow'}">
    <td class="fn">${esc(f.name)}${f.optional ? '' : '<span class="req" title="Required">*</span>'}</td>
    <td class="ft"><code>${type}</code></td>
    <td class="fd">${f.default ? `<code>${esc(f.default)}</code>` : ''}</td>
    <td class="fx">${flags.join(' ')}${rel ? ` ${rel}` : ''}</td>
    <td class="fc">${esc(f.doc)}</td>
  </tr>`;
}

// ── Model card ──────────────────────────────────────────────────────────────
function modelCard(m) {
  const o = out.get(m.name) ?? [];
  const i = inb.get(m.name) ?? [];
  const scalars = m.fields.filter((f) => f.scalar);
  const rels = m.fields.filter((f) => !f.scalar);

  /**
   * Tokens that are shown as badges rather than as text, added to the search
   * index so the filter finds what the reader can see. Without this, searching
   * the very term the placeholder suggests returns almost nothing.
   */
  const tokens = [];
  if (m.fields.some((f) => /(?:Amount|Value|Total|Price|Cost|Duty|Fee|Tax|Freight|Limit|Bcd|Sws|Igst|Cess)$/i.test(f.name) && f.type === 'Int')) tokens.push('minor units money');
  if (m.fields.some((f) => f.name.startsWith('provenance'))) tokens.push('provenance');
  if (m.fields.some((f) => f.onDelete === 'Cascade')) tokens.push('cascade');
  if (m.fields.some((f) => f.fk)) tokens.push('foreign key fk');

  return `<section class="model" id="m-${esc(m.name)}" data-name="${esc(m.name.toLowerCase())}" data-group="${esc(groupOf.get(m.name)?.id ?? 'other')}" data-text="${esc((m.name + ' ' + m.doc + ' ' + m.fields.map((f) => f.name + ' ' + f.doc).join(' ') + ' ' + tokens.join(' ')).toLowerCase())}">
    <header class="mh">
      <h3>${esc(m.name)}</h3>
      <span class="mstat">${scalars.length} fields · ${rels.length} relations${m.indexes.length ? ` · ${m.indexes.length} index${m.indexes.length === 1 ? '' : 'es'}` : ''}</span>
    </header>
    ${m.doc ? `<p class="mdoc">${esc(m.doc)}</p>` : ''}
    <table class="ftab">
      <thead><tr><th>Field</th><th>Type</th><th>Default</th><th>Keys / relation</th><th>Note</th></tr></thead>
      <tbody>${m.fields.map((f) => fieldRow(f, m)).join('')}</tbody>
    </table>
    ${
      m.uniques.length || m.indexes.length
        ? `<div class="cons">
            ${m.uniques.map((u) => `<span class="cons-i"><b>unique</b> (${u.map(esc).join(', ')})</span>`).join('')}
            ${m.indexes.map((x) => `<span class="cons-i"><b>index</b> (${x.map(esc).join(', ')})</span>`).join('')}
           </div>`
        : ''
    }
    ${
      i.length
        ? `<div class="refby"><b>Referenced by</b> ${i
            .map((r) => `<a href="#m-${esc(r.from)}">${esc(r.from)}.${esc(r.field)}</a>${r.onDelete && r.onDelete !== 'None' ? ` <span class="od">${esc(r.onDelete)}</span>` : ''}`)
            .join(', ')}</div>`
        : ''
    }
  </section>`;
}

// ── Relationship map: WorkOrder at the centre, since it is ──────────────────
const woChildren = (inb.get('WorkOrder') ?? []).map((r) => r.from).sort();
const woParents = (out.get('WorkOrder') ?? []).map((r) => r.to);

const mapSvg = () => {
  const cx = 480;
  const cy = 300;
  const r1 = 230;
  const nodes = woChildren.map((n, k) => {
    const a = (k / woChildren.length) * Math.PI * 2 - Math.PI / 2;
    return { n, x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 * 0.82 };
  });
  const edges = nodes
    .map(
      (nd) =>
        `<line x1="${cx}" y1="${cy}" x2="${nd.x.toFixed(1)}" y2="${nd.y.toFixed(1)}" class="edge"/>`,
    )
    .join('');
  const labels = nodes
    .map(
      (nd) =>
        `<g class="node"><circle cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="4"/><text x="${nd.x.toFixed(1)}" y="${(nd.y - 9).toFixed(1)}" text-anchor="middle">${esc(nd.n)}</text></g>`,
    )
    .join('');
  return `<svg viewBox="0 0 960 620" role="img" aria-label="WorkOrder and the ${woChildren.length} tables that hang off it">
    ${edges}
    ${labels}
    <g class="hub"><circle cx="${cx}" cy="${cy}" r="46"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">WorkOrder</text></g>
  </svg>`;
};

const nav = [`<li><a href="#g-diagrams">Diagrams</a> <span class="n">ERD · DFD</span></li>`].concat(GROUPS.map(
  (g) =>
    `<li><a href="#g-${g.id}">${esc(g.title)}</a> <span class="n">${g.models.length}</span></li>`,
)).join('');

const groupsHtml = GROUPS.map((g) => {
  const present = g.models.filter((n) => byName.has(n));
  // Only worth drawing where there is a relationship to show.
  const inGroupRels = relations.filter(
    (r) => present.includes(r.from) && present.includes(r.to) && r.from !== r.to,
  );
  const diagram = inGroupRels.length
    ? `<figure class="fig">
         <div class="figscroll">${erd(present, models, relations)}</div>
         <figcaption>ERD — ${esc(g.title)}. ${inGroupRels.length} relationship${inGroupRels.length === 1 ? '' : 's'} inside this domain; foreign keys pointing outside it are listed on each table.</figcaption>
       </figure>`
    : '';
  return `<section class="group" id="g-${g.id}">
    <h2>${esc(g.title)}</h2>
    <p class="blurb">${esc(g.blurb)}</p>
    ${diagram}
    ${present.map((n) => modelCard(byName.get(n))).join('')}
  </section>`;
}).join('');

/** The order spine — the tables an order actually threads through. */
const SPINE = ['Customer', 'CustomerPO', 'CustomerPOLine', 'ProformaInvoice', 'Supplier', 'SupplierPO', 'SupplierPOLine', 'POLinkMapping', 'WorkOrder', 'StageTransition'];
const spineErd = erd(SPINE.filter((n) => byName.has(n)), models, relations, { entityWidth: 220, extraRows: 3 });

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>1BUY Fulfilment Platform — database design</title>
<style>
  :root {
    --bg:#ffffff; --bg2:#f7f7fb; --bg3:#eeeef5; --ink:#16161d; --ink2:#4a4a5e; --ink3:#7a7a92;
    --line:#e2e2ec; --line2:#cfcfdd; --accent:#4338ca; --accent-bg:#eeecff;
    --warn:#8a5300; --warn-bg:#fff6e6; --ok:#0f6b45; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e0e14; --bg2:#15151e; --bg3:#1d1d29; --ink:#ececf2; --ink2:#b4b4c6; --ink3:#8888a0;
      --line:#262634; --line2:#333346; --accent:#9d92ff; --accent-bg:#20203a; --warn:#e0a44a; --warn-bg:#2b2113; --ok:#57c99a; }
  }
  :root[data-theme="dark"] { --bg:#0e0e14; --bg2:#15151e; --bg3:#1d1d29; --ink:#ececf2; --ink2:#b4b4c6; --ink3:#8888a0;
    --line:#262634; --line2:#333346; --accent:#9d92ff; --accent-bg:#20203a; --warn:#e0a44a; --warn-bg:#2b2113; --ok:#57c99a; }
  :root[data-theme="light"] { --bg:#ffffff; --bg2:#f7f7fb; --bg3:#eeeef5; --ink:#16161d; --ink2:#4a4a5e; --ink3:#7a7a92;
    --line:#e2e2ec; --line2:#cfcfdd; --accent:#4338ca; --accent-bg:#eeecff; --warn:#8a5300; --warn-bg:#fff6e6; --ok:#0f6b45; }

  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  code { font-family:var(--mono); font-size:.86em; }

  .wrap { display:grid; grid-template-columns:250px minmax(0,1fr); gap:0; }
  @media (max-width:900px) { .wrap { grid-template-columns:1fr; } aside { position:static !important; height:auto !important; border-right:0 !important; border-bottom:1px solid var(--line); } }

  aside { position:sticky; top:0; height:100vh; overflow:auto; background:var(--bg2);
    border-right:1px solid var(--line); padding:18px 14px; }
  aside h1 { font-size:15px; margin:0 0 2px; letter-spacing:-.01em; }
  aside .sub { font-size:11.5px; color:var(--ink3); margin:0 0 14px; }
  aside ul { list-style:none; margin:0; padding:0; }
  aside li { margin:1px 0; display:flex; align-items:center; gap:6px; }
  aside li a { font-size:12.5px; color:var(--ink2); padding:3px 0; flex:1; min-width:0; }
  aside li a:hover { color:var(--accent); }
  aside .n { font-size:10px; color:var(--ink3); background:var(--bg3); border-radius:9px; padding:1px 6px; }

  main { min-width:0; padding:26px 30px 80px; }
  @media (max-width:900px) { main { padding:20px 16px 60px; } }

  .top { display:flex; flex-wrap:wrap; align-items:flex-end; gap:14px; margin-bottom:6px; }
  h1.title { font-size:26px; margin:0; letter-spacing:-.02em; }
  .tag { font-size:12px; color:var(--ink3); }
  #theme { margin-left:auto; background:var(--bg2); border:1px solid var(--line); color:var(--ink2);
    border-radius:7px; padding:5px 10px; font-size:12px; cursor:pointer; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px; margin:16px 0 22px; }
  .stat { background:var(--bg2); border:1px solid var(--line); border-radius:9px; padding:9px 11px; }
  .stat b { display:block; font-size:20px; letter-spacing:-.02em; }
  .stat span { font-size:10.5px; color:var(--ink3); text-transform:uppercase; letter-spacing:.05em; }

  .note { background:var(--bg2); border:1px solid var(--line); border-left:3px solid var(--accent);
    border-radius:8px; padding:11px 13px; margin:0 0 20px; font-size:13px; color:var(--ink2); }
  .note b { color:var(--ink); }
  .note ul { margin:8px 0 0; padding-left:18px; }
  .note li { margin:3px 0; }

  #q { width:100%; background:var(--bg2); border:1px solid var(--line2); color:var(--ink);
    border-radius:9px; padding:9px 12px; font-size:13.5px; margin-bottom:6px; }
  #q:focus { outline:2px solid var(--accent); outline-offset:1px; }
  #qn { font-size:11.5px; color:var(--ink3); margin:0 0 18px; }

  .mapbox { background:var(--bg2); border:1px solid var(--line); border-radius:11px; padding:6px 8px 2px; margin:0 0 26px; overflow:hidden; }
  .mapbox h2 { font-size:14px; margin:8px 8px 0; }
  .mapbox p { font-size:12px; color:var(--ink3); margin:3px 8px 4px; }
  .mapbox svg { width:100%; height:auto; display:block; }
  .edge { stroke:var(--line2); stroke-width:1; }
  .node circle { fill:var(--accent); opacity:.8; }
  .node text { fill:var(--ink2); font-size:10.5px; font-family:var(--mono); }
  .hub circle { fill:var(--accent); }
  .hub text { fill:#fff; font-size:12px; font-weight:600; }
  :root[data-theme="dark"] .hub text { fill:#0e0e14; }
  @media (prefers-color-scheme: dark) { .hub text { fill:#0e0e14; } }

  .group { margin:0 0 34px; scroll-margin-top:16px; }
  .group > h2 { font-size:19px; margin:26px 0 4px; letter-spacing:-.01em; padding-bottom:6px; border-bottom:2px solid var(--line); }
  .blurb { font-size:13px; color:var(--ink2); margin:6px 0 16px; max-width:74ch; }

  .model { background:var(--bg2); border:1px solid var(--line); border-radius:11px;
    padding:12px 14px 10px; margin:0 0 12px; scroll-margin-top:16px; }
  .mh { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; }
  .mh h3 { font-size:14.5px; margin:0; font-family:var(--mono); letter-spacing:-.01em; }
  .mstat { font-size:11px; color:var(--ink3); margin-left:auto; }
  .mdoc { font-size:12.5px; color:var(--ink2); margin:7px 0 2px; max-width:88ch; }

  .ftab { width:100%; border-collapse:collapse; margin-top:9px; }
  .ftab thead th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.05em;
    color:var(--ink3); font-weight:600; padding:4px 8px; border-bottom:1px solid var(--line2); }
  .ftab td { padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; font-size:12.5px; }
  .ftab tr:last-child td { border-bottom:0; }
  .relrow { background:color-mix(in srgb, var(--accent-bg) 45%, transparent); }
  .fn { font-family:var(--mono); font-size:12px; white-space:nowrap; }
  .req { color:var(--warn); margin-left:2px; }
  .ft { white-space:nowrap; color:var(--ink2); }
  .fd { white-space:nowrap; color:var(--ink3); }
  .fx { white-space:nowrap; font-size:11px; }
  .fc { color:var(--ink2); font-size:12px; }

  .fl { display:inline-block; font-size:9.5px; text-transform:uppercase; letter-spacing:.04em;
    border:1px solid var(--line2); color:var(--ink3); border-radius:4px; padding:0 4px; }
  .fl.id { border-color:var(--accent); color:var(--accent); }
  .fl.uq { border-color:var(--ok); color:var(--ok); }
  .fl.fk { border-color:var(--line2); }
  .fl.money { border-color:var(--warn); color:var(--warn); }
  .od { font-size:10px; color:var(--ink3); }

  .cons, .refby { font-size:11.5px; color:var(--ink3); margin-top:8px; display:flex; flex-wrap:wrap; gap:5px 12px; }
  .cons-i b, .refby b { color:var(--ink2); font-weight:600; }
  .refby { padding-top:7px; border-top:1px dashed var(--line); }

  details.raw { margin-top:26px; background:var(--bg2); border:1px solid var(--line); border-radius:10px; padding:10px 13px; }
  details.raw summary { cursor:pointer; font-size:13.5px; font-weight:600; }
  details.raw pre { overflow:auto; max-height:70vh; background:var(--bg); border:1px solid var(--line);
    border-radius:8px; padding:12px; font-family:var(--mono); font-size:11.5px; line-height:1.5; }

  /* ── Diagrams ───────────────────────────────────────────────────────── */
  .legend { display:flex; flex-wrap:wrap; align-items:center; gap:6px 18px; background:var(--bg2);
    border:1px solid var(--line); border-radius:9px; padding:9px 13px; margin:0 0 16px; font-size:12px; color:var(--ink2); }
  .legend b { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink3); }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  .lg { width:46px; height:20px; flex:none; }

  .fig { margin:0 0 22px; background:var(--bg2); border:1px solid var(--line); border-radius:11px; padding:10px 10px 4px; }
  /* Wide diagrams scroll inside their own box; the page never scrolls sideways. */
  .figscroll { overflow-x:auto; overflow-y:hidden; }
  .fig figcaption { font-size:12px; color:var(--ink3); padding:8px 4px 6px; max-width:96ch; line-height:1.5; }
  .fig svg { display:block; height:auto; }
  .erd { min-width:660px; }
  .dfd { min-width:820px; }

  /* Entities */
  .ent rect { fill:var(--bg); stroke:var(--line2); stroke-width:1; }
  .ent .ehead { fill:var(--accent-bg); stroke:none; }
  .en { fill:var(--ink); font:600 11.5px var(--mono); }
  .ef { fill:var(--ink2); font:10.5px var(--mono); }
  .ef.key { fill:var(--ink); font-weight:600; }
  .ek { fill:var(--accent); font:600 8px var(--mono); }
  .et { fill:var(--ink3); font:9.5px var(--mono); }

  /* Connectors + crow's foot */
  .rl { fill:none; stroke:var(--line2); stroke-width:1.3; }
  .cf { fill:none; stroke:var(--accent); stroke-width:1.4; stroke-linecap:round; }
  .cf-o { fill:var(--bg); stroke:var(--accent); stroke-width:1.4; }
  .rel:hover .rl { stroke:var(--accent); stroke-width:2; }

  /* DFD */
  .dfd-ext rect { fill:var(--bg3); stroke:var(--line2); stroke-width:1.2; }
  .dfd-ext text { fill:var(--ink); font:600 11.5px -apple-system,sans-serif; }
  .dfd-proc rect { fill:var(--accent-bg); stroke:var(--accent); stroke-width:1.3; }
  .dfd-proc .pn { fill:var(--ink); font:600 11.5px -apple-system,sans-serif; }
  .dfd-proc .ps { fill:var(--ink3); font:9.5px -apple-system,sans-serif; }
  .dfd-store rect { fill:var(--bg); stroke:var(--line2); stroke-width:1.2; }
  .dfd-store line { stroke:var(--line2); stroke-width:1.2; }
  .dfd-store text { fill:var(--ink2); font:11px -apple-system,sans-serif; }
  .dfd-store .sid { fill:var(--accent); font-weight:600; }
  .dfd-flow path { fill:none; stroke:var(--line2); stroke-width:1.2; }
  .dfd-flow path.dash { stroke-dasharray:4 3; }
  .dfd-flow .fl { fill:var(--ink3); font:9.5px -apple-system,sans-serif; }
  .dfd marker path { fill:var(--line2); }
  .dnote { fill:var(--ink3); font:10.5px -apple-system,sans-serif; }

  .mapbox h3 { font-size:14px; margin:8px 8px 0; }

  .hidden { display:none !important; }
  footer { margin-top:36px; padding-top:14px; border-top:1px solid var(--line); font-size:11.5px; color:var(--ink3); }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <h1>Database design</h1>
    <p class="sub">1BUY Fulfilment Platform</p>
    <ul>${nav}</ul>
    <ul style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px">
      <li><a href="#raw">Raw schema</a></li>
    </ul>
  </aside>

  <main>
    <div class="top">
      <h1 class="title">Database design</h1>
      <span class="tag">Prisma · SQLite · generated from <code>prisma/schema.prisma</code></span>
      <button id="theme" type="button">Toggle theme</button>
    </div>

    <div class="stats">
      <div class="stat"><b>${stats.models}</b><span>Tables</span></div>
      <div class="stat"><b>${stats.fields}</b><span>Columns</span></div>
      <div class="stat"><b>${stats.relations}</b><span>Foreign keys</span></div>
      <div class="stat"><b>${stats.relationFields}</b><span>Relation fields</span></div>
      <div class="stat"><b>${stats.uniques}</b><span>Unique constraints</span></div>
      <div class="stat"><b>${stats.indexes}</b><span>Composite indexes</span></div>
    </div>

    <div class="note">
      <b>Conventions that matter before reading anything else.</b>
      <ul>
        <li><b>Money is an integer in minor units</b> — paise for INR, cents for USD. Every column named <code>*Amount</code>, <code>*Value</code>, <code>*Total</code>, <code>*Price</code>, <code>*Cost</code>, <code>*Duty</code>, <code>*Fee</code>, <code>*Tax</code> or <code>*Freight</code> is flagged <span class="fl money">minor units</span> below. Reading one as rupees is off by a hundred. The one exception is <code>unitPrice*</code>, a Float because component prices carry four decimals; it is converted to integer minor units at line level immediately so error cannot accumulate.</li>
        <li><b>There are no native enums.</b> SQLite has none, so enum-ish columns are <code>String</code> with the authoritative union types and Zod schemas in <code>lib/domain/enums.ts</code>. The comment on each such column lists the permitted values.</li>
        <li><b>Provenance.</b> Anything an external API could have produced carries <code>provenance</code>, <code>provenanceActor</code>, <code>provenanceAt</code> and <code>provenanceRef</code>, so a reader can always tell whether the platform was told a fact or assumed it.</li>
        <li><b>Import IGST is not a cost.</b> <code>dutyIgst</code> on WorkOrder is recoverable and is deliberately excluded from landed cost; <code>dutyBcd</code> and <code>dutySws</code> are real cost. Treating them alike misstates margin on every imported order.</li>
        <li><b>Cascades are not uniform.</b> Most children of WorkOrder cascade on delete. <code>InputTaxCredit</code>, <code>ReverseChargeSelfInvoice</code> and <code>IntegrationCallLog</code> hold a nullable <code>workOrderId</code> and do <em>not</em> cascade — deleting a work order would orphan tax rows into the registers, so they must be removed explicitly.</li>
      </ul>
    </div>

    <label for="q" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)">Filter</label>
    <input id="q" type="search" placeholder="Filter tables and columns — try “escrow”, “gstin”, “provenance”, “minor units”…" autocomplete="off">
    <p id="qn"></p>

    <section class="group" id="g-diagrams">
      <h2>Diagrams</h2>
      <p class="blurb">An entity-relationship diagram of the order spine and a two-level data-flow diagram. Per-domain ERDs sit at the head of each section below, so no single canvas has to carry ${stats.models} entities.</p>

      <div class="legend">
        <b>Crow's foot notation</b>
        <span><svg viewBox="0 0 46 20" class="lg"><path d="M8,10 H26" class="rl"/><path d="M30,4 L30,16" class="cf"/></svg> exactly one</span>
        <span><svg viewBox="0 0 46 20" class="lg"><path d="M8,10 H24" class="rl"/><circle cx="30" cy="10" r="3.5" class="cf-o"/></svg> zero or one</span>
        <span><svg viewBox="0 0 46 20" class="lg"><path d="M4,10 H20" class="rl"/><path d="M20,10 L31,4 M20,10 L31,10 M20,10 L31,16" class="cf"/><path d="M35,4 L35,16" class="cf"/></svg> one or many</span>
        <span><svg viewBox="0 0 46 20" class="lg"><path d="M2,10 H16" class="rl"/><path d="M16,10 L27,4 M16,10 L27,10 M16,10 L27,16" class="cf"/><circle cx="35" cy="10" r="3.5" class="cf-o"/></svg> zero or many</span>
      </div>

      <figure class="fig">
        <div class="figscroll">${spineErd}</div>
        <figcaption>ERD — the order spine. Customer demand enters on the left; <code>POLinkMapping</code> is the join that binds a customer line to a supplier line with its allocated quantity and both prices. Hover any connector for its foreign key and delete behaviour.</figcaption>
      </figure>

      <div class="mapbox">
        <h3>WorkOrder is the hub</h3>
        <p>${woChildren.length} tables hang off a single work order; it in turn points at ${[...new Set(woParents)].length} parents (${[...new Set(woParents)].map(esc).join(', ')}). Everything shown is deleted with the order <em>except</em> InputTaxCredit, ReverseChargeSelfInvoice and IntegrationCallLog — see the conventions above.</p>
        ${mapSvg()}
      </div>

      <figure class="fig">
        <div class="figscroll">${dfd0()}</div>
        <figcaption>DFD level 0 — context. 1BUY sits between every party as Merchant of Record; no two external parties exchange data directly.</figcaption>
      </figure>

      <figure class="fig">
        <div class="figscroll">${dfd1()}</div>
        <figcaption>DFD level 1 — the seven phases as processes, with the six data stores. Every process reads and writes D1 (orders), D3 (evidence) and D6 (audit); only representative flows are drawn, because a diagram with every edge is one nobody reads.</figcaption>
      </figure>
    </section>

    ${groupsHtml}

    <details class="raw" id="raw">
      <summary>Raw schema — prisma/schema.prisma (${(rawSchema.length / 1024).toFixed(0)} KB, the file the application actually runs on)</summary>
      <pre>${esc(rawSchema)}</pre>
    </details>

    <footer>
      Generated from <code>prisma/schema.prisma</code>. Regenerating after a schema change reproduces this file — it is not maintained by hand, so it cannot describe a column the database does not have.
    </footer>
  </main>
</div>

<script>
(function () {
  // Theme: follow the OS, but let the reader override — a schema reference gets
  // read for a long time, and the wrong contrast for an hour is unpleasant.
  var root = document.documentElement;
  var btn = document.getElementById('theme');
  var stored = null;
  try { stored = localStorage.getItem('dbtheme'); } catch (e) {}
  if (stored) root.setAttribute('data-theme', stored);
  else root.removeAttribute('data-theme');
  btn.addEventListener('click', function () {
    var dark = getComputedStyle(root).getPropertyValue('--bg').trim().indexOf('#0') === 0;
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('dbtheme', next); } catch (e) {}
  });

  // Filter across table names, column names and every comment.
  var q = document.getElementById('q');
  var out = document.getElementById('qn');
  var models = [].slice.call(document.querySelectorAll('.model'));
  var groups = [].slice.call(document.querySelectorAll('.group'));

  function run() {
    var term = q.value.trim().toLowerCase();
    if (!term) {
      models.forEach(function (m) { m.classList.remove('hidden'); });
      groups.forEach(function (g) { g.classList.remove('hidden'); });
      out.textContent = '';
      return;
    }
    var shown = 0;
    models.forEach(function (m) {
      var hit = m.getAttribute('data-text').indexOf(term) !== -1;
      m.classList.toggle('hidden', !hit);
      if (hit) shown++;
    });
    groups.forEach(function (g) {
      var any = g.querySelector('.model:not(.hidden)');
      g.classList.toggle('hidden', !any);
    });
    out.textContent = shown + ' of ' + models.length + ' tables match “' + q.value.trim() + '”';
  }
  q.addEventListener('input', run);
})();
</script>
</body>
</html>`;

fs.writeFileSync(process.argv[3], html);
console.log(`wrote ${process.argv[3]} — ${(html.length / 1024).toFixed(0)} KB`);
