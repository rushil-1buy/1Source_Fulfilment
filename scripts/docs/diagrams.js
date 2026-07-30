/**
 * SVG generators for the ERD and DFD.
 *
 * Hand-rolled rather than pulled from a diagramming library because the output
 * has to be self-contained — this file is read from a share or an attachment,
 * often with no network, so a CDN script tag would render a blank box.
 *
 * READABILITY IS THE CONSTRAINT. Sixty-three entities on one canvas is a hairball
 * nobody reads, so the ERD is drawn per domain, each with its own crow's-foot
 * relationships, plus one spine diagram showing how an order actually threads
 * through the core tables.
 *
 * CROW'S FOOT NOTATION used throughout:
 *   ─┼─   exactly one          (mandatory, one)
 *   ─o─   zero or one          (optional, one)
 *   ─<    one or many          (mandatory, many)
 *   ─o<   zero or many         (optional, many)
 * The bar/circle sits at the entity end it qualifies, which is the convention
 * most readers of an IE diagram expect.
 */

const ROW_H = 15;
const HEAD_H = 22;
const PAD = 7;

/** Rough text width at a given px size for the monospace-ish label font. */
const tw = (s, size) => String(s).length * size * 0.56;

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ═══════════════════════════════════════════════════════════════════════════
// Crow's-foot markers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Draws the cardinality glyph at (x,y) pointing along `dir` (1 = the entity is
 * to the right of the glyph, -1 = to the left).
 *
 * `many` draws the three-prong foot; `optional` draws the circle; otherwise a
 * bar. The glyph is drawn OUTSIDE the entity edge, reading into it.
 */
function foot(x, y, dir, { many, optional }) {
  const L = 11; // glyph length along the connector
  const S = 6;  // half-height of the foot
  const g = [];
  const tip = x + dir * L;

  if (many) {
    // Three prongs converging on the entity edge.
    g.push(`<path d="M${x},${y} L${tip},${y - S} M${x},${y} L${tip},${y} M${x},${y} L${tip},${y + S}" class="cf"/>`);
  }
  // The one/optional qualifier sits just beyond the foot.
  const qx = many ? tip + dir * 4 : x + dir * 5;
  if (optional) {
    g.push(`<circle cx="${qx + dir * 3.5}" cy="${y}" r="3.5" class="cf-o"/>`);
  } else {
    g.push(`<path d="M${qx},${y - S} L${qx},${y + S}" class="cf"/>`);
  }
  return g.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// ERD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One entity box. Shows the primary key, every foreign key, and up to `extra`
 * further columns — enough to recognise the table without reproducing the field
 * tables that already sit below the diagram.
 */
function entity(m, x, y, w, rows) {
  const h = HEAD_H + rows.length * ROW_H + PAD;
  const body = rows
    .map((r, i) => {
      const ty = y + HEAD_H + 11 + i * ROW_H;
      const key = r.pk ? 'PK' : r.fk ? 'FK' : '';
      return `<text x="${x + 7}" y="${ty}" class="ek">${key}</text><text x="${x + 26}" y="${ty}" class="ef${r.pk || r.fk ? ' key' : ''}">${esc(r.name)}</text><text x="${x + w - 7}" y="${ty}" class="et" text-anchor="end">${esc(r.type)}</text>`;
    })
    .join('');
  return {
    svg: `<g class="ent"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/><rect x="${x}" y="${y}" width="${w}" height="${HEAD_H}" rx="5" class="ehead"/><rect x="${x}" y="${y + HEAD_H - 5}" width="${w}" height="5" class="ehead"/><text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" class="en">${esc(m)}</text>${body}</g>`,
    h,
  };
}

/**
 * Lays out one domain as columns by dependency depth, then routes each foreign
 * key as an orthogonal connector with crow's-foot ends.
 */
function erd(groupModels, allModels, relations, opts = {}) {
  const byName = new Map(allModels.map((m) => [m.name, m]));
  const set = new Set(groupModels);
  // Only relations wholly inside this domain — a connector to an entity that is
  // not drawn is a line to nowhere.
  const rels = relations.filter((r) => set.has(r.from) && set.has(r.to) && r.from !== r.to);

  // Depth = longest chain of FKs from a table that depends on nothing in-domain.
  const depth = new Map(groupModels.map((n) => [n, 0]));
  for (let pass = 0; pass < groupModels.length; pass++) {
    let moved = false;
    for (const r of rels) {
      const d = Math.max(depth.get(r.from), depth.get(r.to) + 1);
      if (d !== depth.get(r.from)) {
        depth.set(r.from, d);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const cols = new Map();
  for (const n of groupModels) {
    const d = depth.get(n) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);

  const W = opts.entityWidth ?? 210;
  const GAP_X = 96;
  const GAP_Y = 26;
  const M = 16;

  // Place.
  const pos = new Map();
  let maxH = 0;
  colKeys.forEach((k, ci) => {
    let y = M;
    for (const n of cols.get(k)) {
      const m = byName.get(n);
      const fks = m.fields.filter((f) => f.fk);
      const rows = [
        ...(m.id ? [{ name: m.id, type: 'String', pk: true }] : []),
        ...fks.map((f) => ({ name: f.fk, type: byName.has(f.type) ? `→ ${f.type}` : 'String', fk: true })),
        ...m.fields
          .filter((f) => f.scalar && !f.isId && !fks.some((k2) => k2.fk === f.name))
          .slice(0, opts.extraRows ?? 3)
          .map((f) => ({ name: f.name, type: f.type + (f.optional ? '?' : '') })),
      ];
      const h = HEAD_H + rows.length * ROW_H + PAD;
      pos.set(n, { x: M + ci * (W + GAP_X), y, w: W, h, rows });
      y += h + GAP_Y;
      maxH = Math.max(maxH, y);
    }
  });

  const width = M * 2 + colKeys.length * W + (colKeys.length - 1) * GAP_X;
  const height = maxH + M;

  const boxes = groupModels
    .map((n) => {
      const p = pos.get(n);
      return entity(n, p.x, p.y, p.w, p.rows).svg;
    })
    .join('');

  // Route: child (many) on the right of parent, or wherever it landed.
  const lines = rels
    .map((r) => {
      const a = pos.get(r.to);   // parent — the "one" side
      const b = pos.get(r.from); // child  — the "many" side
      if (!a || !b) return '';
      const rightward = b.x > a.x;
      const ax = rightward ? a.x + a.w : a.x;
      const bx = rightward ? b.x : b.x + b.w;
      const ay = a.y + a.h / 2;
      const by = b.y + b.h / 2;
      const mid = rightward ? (ax + bx) / 2 : (ax + bx) / 2;
      const dirA = rightward ? 1 : -1;
      const dirB = rightward ? -1 : 1;
      const gap = 16;
      const path = `M${ax + dirA * gap},${ay} H${mid} V${by} H${bx + dirB * gap}`;
      return `<g class="rel"><path d="${path}" class="rl"/>${foot(ax, ay, dirA, { many: false, optional: false })}${foot(bx, by, dirB, { many: true, optional: r.optional })}<title>${esc(r.to)} 1 → ${esc(r.from)} many (${esc(r.fk)}${r.onDelete && r.onDelete !== 'None' ? `, on delete ${esc(r.onDelete)}` : ''})</title></g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="erd" role="img" aria-label="Entity relationship diagram">${lines}${boxes}</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DFD
// ═══════════════════════════════════════════════════════════════════════════

const ext = (x, y, w, h, label) =>
  `<g class="dfd-ext"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${esc(label)}</text></g>`;

const proc = (x, y, w, h, num, label, sub) =>
  `<g class="dfd-proc"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/><text x="${x + w / 2}" y="${y + (sub ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle" class="pn">${esc(num)}  ${esc(label)}</text>${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" class="ps">${esc(sub)}</text>` : ''}</g>`;

const store = (x, y, w, h, id, label) =>
  `<g class="dfd-store"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x + 30}" y1="${y}" x2="${x + 30}" y2="${y + h}"/><text x="${x + 15}" y="${y + h / 2 + 4}" text-anchor="middle" class="sid">${esc(id)}</text><text x="${x + 38}" y="${y + h / 2 + 4}">${esc(label)}</text></g>`;

const flow = (d, label, o = {}) =>
  `<g class="dfd-flow"><path d="${d}" marker-end="url(#arrow)"${o.dashed ? ' class="dash"' : ''}/>${label ? `<text x="${o.lx}" y="${o.ly}" text-anchor="${o.anchor ?? 'middle'}" class="fl">${esc(label)}</text>` : ''}</g>`;

/** Level 0 — the context diagram. One process, every external party. */
function dfd0() {
  const W = 1040;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;

  const parties = [
    { n: 'Customer', x: 40, y: 60, in: 'Purchase order, acceptance', out: 'Quote, invoice, POD' },
    { n: 'Supplier', x: 40, y: 220, in: 'Proforma, shipment, docs', out: 'Our PO, payment' },
    { n: 'Escrow Provider', x: 40, y: 380, in: 'Funding + release confirmations', out: 'Open, fund, release' },
    { n: 'Testing Laboratory', x: 820, y: 60, in: 'Test report, verdict', out: 'Sample, scope, standard' },
    { n: 'Logistics Partner', x: 820, y: 220, in: 'Tracking, POD', out: 'Booking, consignment' },
    { n: 'Customs (ICEGATE)', x: 820, y: 380, in: 'Assessment, Out of Charge', out: 'Bill of Entry, duty' },
  ];

  const boxes = parties.map((p) => ext(p.x, p.y, 180, 56, p.n)).join('');
  const flows = parties
    .map((p) => {
      const left = p.x < cx;
      const px = left ? p.x + 180 : p.x;
      const py = p.y + 28;
      const tx = left ? cx - 120 : cx + 120;
      const dir = left ? 1 : -1;
      return (
        flow(`M${px + dir * 6},${py - 7} H${tx - dir * 6}`, p.out, { lx: (px + tx) / 2, ly: py - 12 }) +
        flow(`M${tx - dir * 6},${py + 9} H${px + dir * 6}`, p.in, { lx: (px + tx) / 2, ly: py + 24, })
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="dfd" role="img" aria-label="Level 0 context data flow diagram">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    ${flows}${boxes}
    ${proc(cx - 120, cy - 42, 240, 84, '0', '1BUY Fulfilment', 'Merchant of Record')}
  </svg>`;
}

/** Level 1 — the seven phases as processes, with the stores each reads and writes. */
function dfd1() {
  const W = 1180;
  const H = 620;
  const PW = 150;
  const PH = 54;
  const y1 = 40;
  const procs = [
    ['1.0', 'Capture demand', 'Phase A'],
    ['2.0', 'Source & commit', 'Phase B'],
    ['3.0', 'Arm funds', 'Phase C'],
    ['4.0', 'Verify quality', 'Phase D'],
    ['5.0', 'Move & clear', 'Phase E'],
    ['6.0', 'Inspect & settle', 'Phase F'],
    ['7.0', 'Deliver & close', 'Phase G'],
  ];
  // Two rows so the labels stay legible rather than being crushed onto one line.
  const perRow = 4;
  const placed = procs.map((p, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowN = row === 0 ? perRow : procs.length - perRow;
    const spanW = rowN * PW + (rowN - 1) * 60;
    const x0 = (1120 - spanW) / 2;
    return { p, x: x0 + col * (PW + 60), y: y1 + row * 130 };
  });

  const procSvg = placed.map((q) => proc(q.x, q.y, PW, PH, q.p[0], q.p[1], q.p[2])).join('');

  // Chain the processes.
  const chain = placed
    .map((q, i) => {
      const n = placed[i + 1];
      if (!n) return '';
      if (n.y === q.y) return flow(`M${q.x + PW + 4},${q.y + PH / 2} H${n.x - 6}`, '', {});
      // Wrap to the next row.
      return flow(`M${q.x + PW / 2},${q.y + PH + 4} V${q.y + PH + 30} H${n.x + PW / 2} V${n.y - 6}`, '', {});
    })
    .join('');

  const stores = [
    ['D1', 'Orders & work orders', 40, 320],
    ['D2', 'Master data & AVL', 40, 372],
    ['D3', 'Evidence & documents', 40, 424],
    ['D4', 'Escrow ledger', 620, 320],
    ['D5', 'Tax registers', 620, 372],
    ['D6', 'Audit log', 620, 424],
  ];
  const storeSvg = stores.map(([id, l, x, y]) => store(x, y, 300, 40, id, l)).join('');

  /**
   * Representative store flows, routed around the store boxes rather than across
   * them, with label positions chosen so no two can overlap. Deliberately few:
   * a DFD with every edge drawn is one nobody reads, and the caption says so.
   *
   * Geometry this depends on — stores are 300 wide, 40 high:
   *   D1 x40-340 y320   D2 x40-340 y372   D3 x40-340 y424
   *   D4 x620-920 y320  D5 x620-920 y372  D6 x620-920 y424
   */
  const p1 = placed[0], p3 = placed[2], p6 = placed[5], p7 = placed[6];
  const edges = [
    // 1.0 Capture demand ⇄ D1 Orders. Straight down the left of row 2.
    flow(`M${p1.x + 40},${p1.y + PH + 4} V316`, 'order, lines, stage', { lx: p1.x + 47, ly: 300, anchor: 'start' }),
    // 3.0 Arm funds → D4 Escrow ledger. Clear of the row-2 process to its right.
    flow(`M${p3.x + 40},${p3.y + PH + 4} V316`, 'escrow movements', { lx: p3.x + 47, ly: 300, anchor: 'start' }),
    // 6.0 Inspect & settle → D3 Evidence. Down then left into the store's edge.
    flow(`M${p6.x + PW / 2},${p6.y + PH + 4} V444 H344`, 'evidence, uploads', { lx: p6.x + PW / 2 - 8, ly: 400, anchor: 'end' }),
    // 7.0 Deliver & close → D5 Tax registers. Around the right so it crosses nothing.
    flow(`M${p7.x + PW + 4},${p7.y + 18} H1010 V392 H924`, 'invoice, ITC, RCM', { lx: 1016, ly: 300, anchor: 'start' }),
    // Every process writes D6; one dashed edge stands for all of them.
    flow(`M${p7.x + PW + 4},${p7.y + 38} H1052 V444 H924`, 'audit rows', { lx: 1058, ly: 360, anchor: 'start', dashed: true }),
  ].join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="dfd" role="img" aria-label="Level 1 data flow diagram">
    <defs><marker id="arrow1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    <g class="dfd-edges">${chain}${edges}</g>
    ${procSvg}${storeSvg}
    <text x="${W / 2}" y="${H - 14}" text-anchor="middle" class="dnote">Processes run left to right, wrapping. Only representative store flows are drawn — every process reads and writes D1, D3 and D6.</text>
  </svg>`;
}

module.exports = { erd, dfd0, dfd1 };
