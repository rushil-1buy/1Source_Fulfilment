/**
 * Builds the 1BUY Fulfilment Platform document from the platform's own domain
 * data, rather than from prose written alongside it.
 *
 * Everything factual here — every stage, field, document, sub-task, standard and
 * Incoterm — is read out of data.json, which is extracted straight from the
 * source of truth in lib/domain. A hand-written manual drifts from the software
 * within a release; a generated one cannot.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

// ── Page geometry (A4, DXA: 1440 = 1 inch) ──────────────────────────────────
const PAGE_W = 11906;
const MARGIN = 1080;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9746

const INK = '1A1A2E';
const MUTED = '5A5A72';
const ACCENT = '4338CA';
const RULE = 'D8D8E3';
const BAND = 'F1F1F7';
const WARN = '9A5B00';

const stakeholder = (k) => (DATA.stakeholders[k] ? DATA.stakeholders[k].label : k);

// ── Small builders ──────────────────────────────────────────────────────────
const p = (text, o = {}) =>
  new Paragraph({
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 276 },
    alignment: o.align,
    indent: o.indent,
    border: o.border,
    children: [
      new TextRun({
        text,
        size: o.size ?? 20,
        bold: o.bold,
        italics: o.italics,
        color: o.color ?? INK,
        font: o.font,
      }),
    ],
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, size: 32, bold: true, color: INK })],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, size: 26, bold: true, color: INK })],
  });

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, size: 22, bold: true, color: ACCENT })],
  });

const bullet = (text, level = 0) =>
  new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 60, line: 264 },
    children: [new TextRun({ text, size: 20, color: INK })],
  });

const numbered = (text) =>
  new Paragraph({
    numbering: { reference: 'steps', level: 0 },
    spacing: { after: 80, line: 264 },
    children: [new TextRun({ text, size: 20, color: INK })],
  });

/** A labelled inline pair: "Owner — 1BUY". */
const kv = (label, value, o = {}) =>
  new Paragraph({
    spacing: { after: o.after ?? 60, line: 264 },
    children: [
      new TextRun({ text: `${label}  `, size: 18, bold: true, color: MUTED }),
      new TextRun({ text: value, size: 20, color: INK }),
    ],
  });

const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: Array.isArray(children) ? children : [children],
  });

const tcell = (text, width, o = {}) =>
  cell(
    new Paragraph({
      spacing: { after: 0, line: 250 },
      alignment: o.align,
      children: [
        new TextRun({ text: String(text ?? ''), size: o.size ?? 17, bold: o.bold, color: o.color ?? INK }),
      ],
    }),
    width,
    o,
  );

const table = (widths, headers, rows) =>
  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: RULE },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((hd, i) => tcell(hd, widths[i], { bold: true, shade: BAND, size: 16, color: MUTED })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) =>
              typeof c === 'object' && c !== null && 'text' in c
                ? tcell(c.text, widths[i], c)
                : tcell(c, widths[i]),
            ),
          }),
      ),
    ],
  });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const rule = () =>
  new Paragraph({
    spacing: { before: 60, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
    children: [new TextRun({ text: '', size: 2 })],
  });

// ═══════════════════════════════════════════════════════════════════════════
// Content
// ═══════════════════════════════════════════════════════════════════════════

const body = [];

// ── Title page ──────────────────────────────────────────────────────────────
body.push(
  new Paragraph({ spacing: { before: 2400, after: 0 }, children: [new TextRun({ text: '1BUY', size: 72, bold: true, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: 'Fulfilment Platform', size: 56, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Problem statement, objectives, methodology and user guide', size: 26, color: MUTED })] }),
  rule(),
  kv('Scope', 'Procurement to fulfilment, with 1BUY as Merchant of Record between customer and supplier'),
  kv('Covers', `${DATA.phases.length} phases · ${DATA.stages.length} stages · ${DATA.stages.reduce((a, s) => a + s.fields.length, 0)} recorded fields · ${DATA.stages.reduce((a, s) => a + s.documents.length, 0)} document slots · ${DATA.nav.reduce((a, g) => a + g.items.length, 0)} screens`),
  kv('Jurisdiction', 'India — GST, customs and e-invoicing rules apply throughout'),
  new Paragraph({
    spacing: { before: 320 },
    children: [new TextRun({ text: 'Every stage, field, document, sub-task and standard in this document is generated directly from the platform’s own configuration. It cannot describe a screen the software does not have.', size: 18, italics: true, color: MUTED })],
  }),
  pageBreak(),
);

// ── Contents ────────────────────────────────────────────────────────────────
body.push(
  h1('Contents'),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
  new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'Right-click and choose “Update field” to populate page numbers.', size: 16, italics: true, color: MUTED })] }),
  pageBreak(),
);

// ── 1. Problem statement ────────────────────────────────────────────────────
body.push(
  h1('1. Problem statement'),
  p('1BUY buys electronic components from suppliers and sells them to customers as Merchant of Record. It is not a broker passing an order along: it takes title, carries the risk, imports the goods, pays the duty, and invoices the customer under its own GSTIN. That position is what creates the problem this platform exists to solve.'),

  h2('1.1 One order, seven parties, no single record'),
  p('A single order touches the customer, the supplier, an escrow provider, an independent testing laboratory, a freight carrier, a customs house agent and 1BUY’s own warehouse and finance teams. Each holds part of the truth. Before this platform, the order lived across email threads, spreadsheets, a courier portal, ICEGATE, the lab’s report inbox and an accounting package, and nobody could answer “where is this order and what is it waiting for” without asking three people.'),

  h2('1.2 The specific failures that cost money'),
  bullet('Counterfeit parts. Components bought outside franchised distribution can be remarked, resurfaced or empty. Discovering that after the goods have cleared customs means duty has already been paid on worthless parts, and returning them is a re-export.'),
  bullet('Payment exposure. Paying a supplier in advance for goods that have not been verified puts the money beyond recovery. Paying only on delivery means suppliers will not start. Neither position is workable without a neutral third party.'),
  bullet('Customs valuation. Indian customs assesses on CIF, not invoice value. Getting the notional freight and insurance additions wrong, or the HSN classification wrong, produces a duty figure that is disputed after payment — when disputing it is far harder.'),
  bullet('Non-creditable tax booked as cost. Basic Customs Duty and Social Welfare Surcharge are real cost. Import IGST is recoverable. Treating them alike silently misstates margin on every imported order.'),
  bullet('Evidence that arrives after the decision. The signed inspection report, the Bill of Entry, the proof of delivery — each is the thing that justifies the step before it. Collected afterwards, they document a decision nobody could have made properly at the time.'),

  h2('1.3 What the platform has to be'),
  p('A single record of one order, from the customer’s purchase order to the closed job, that knows what stage it is at, what that stage requires, who owes the next action, and what evidence exists to show each step was genuinely done — with the money, the tax and the paperwork correct at every point.'),
  pageBreak(),
);

// ── 2. Objectives ───────────────────────────────────────────────────────────
body.push(
  h1('2. Objectives'),
  p('Each objective below is testable against the software, not aspirational.'),
);

const objectives = [
  ['One order, one record', 'Every order is a work order named from the four documents that define it — the customer’s purchase order, our proforma invoice, our purchase order to the supplier, and the supplier’s proforma invoice. The name locks once all four exist.'],
  ['A stage ladder that cannot be bypassed', `${DATA.stages.filter((s) => !s.isExceptionBranch).length} stages across ${DATA.phases.length} phases, declared once and used by the flow rail, the transition rules, SLA ageing, the next-action prompt and the audit trail — so no two parts of the product can disagree about where an order is.`],
  ['Evidence before advancement', `Each stage declares what must be recorded and attached before the order may leave it — ${DATA.stages.reduce((a, s) => a + s.fields.length, 0)} fields and ${DATA.stages.reduce((a, s) => a + s.documents.length, 0)} document slots in total. Advancing without them is possible only with a written reason, which is logged.`],
  ['Money held by a neutral party', 'Escrow between customer and supplier, with release conditions agreed up front, a part-release to fund testing, and a final release that requires a passed inspection and two different Finance approvers.'],
  ['Independent verification before the lot ships', 'A sample is tested by an independent laboratory against a named standard before the full quantity moves, so a bad lot costs a courier rather than a container.'],
  ['Tax and duty computed, never typed', 'Customs valuation on CIF with the statutory notional additions; Basic Customs Duty and Social Welfare Surcharge treated as cost; import IGST treated as recoverable and excluded from landed cost; GST computed by place of supply.'],
  ['An audit trail that answers "why", not just "what"', 'Every change writes one row per changed field, carrying the reason where a reason was required. A closed order is a defensible record.'],
  ['Degrade rather than block', 'Where an external system is unavailable, the step falls back to manual capture with its provenance recorded. A connector failure never stops an order.'],
];

body.push(
  table(
    [2600, 7146],
    ['Objective', 'What it means in the software'],
    objectives.map(([a, b]) => [{ text: a, bold: true }, b]),
  ),
  pageBreak(),
);

// ── 3. Methodology ──────────────────────────────────────────────────────────
body.push(
  h1('3. Methodology'),

  h2('3.1 Declarative domain, generated surfaces'),
  p('The stage ladder, the evidence schema and the sub-task checklists are declared as data in one place each. The flow rail, the forms, the gates, the audit entries and this document are all generated from those declarations. Adding a stage or a required field is a change to one file; every surface follows. This is what stops the interface and the rules drifting apart.'),

  h2('3.2 Evidence as a gate, with an escape hatch that is recorded'),
  p('A stage is not finished because somebody pressed a button; it is finished when there is something on file showing it happened. The gate checks the stage being left, not the one being entered. Because a real operator sometimes has a legitimate reason to move on without complete evidence, the gate can be passed with a written reason of at least eight characters — and that reason is written to the audit log against the specific stage, naming exactly what was missing.'),

  h2('3.3 Derived state, never self-reported'),
  p('Checklist ticks are computed from what is actually recorded: a document row is complete when that document is attached; a capture row when its required fields are filled; an action row from the evidence field that records the action happening. Nothing is a to-do list maintained by hand, because such a list drifts from reality within a week and is then worse than nothing, since it looks authoritative.'),

  h2('3.4 Integer money, explicit rounding'),
  p('All monetary values are stored as integers in minor units — paise for INR, cents for USD — so rounding is explicit and testable rather than an artefact of floating point. Unit prices are the one exception, carrying up to four decimals, and are converted to integer minor units at line level immediately so error cannot accumulate.'),

  h2('3.5 Provenance on everything external'),
  p('Any record that an external system could have produced carries how it arrived: automatically from a live connector, from a mock, or entered by hand — with who entered it and when. An operator reading a tracking event or a customs status can always tell whether the platform was told it or assumed it.'),

  h2('3.6 Three connector modes'),
  p('Each integration — testing laboratory, logistics, customs, escrow, GST — runs in one of three modes: mock, manual or live. The house rule is that a real adapter failure degrades to manual capture rather than blocking the order, and the degradation is itself logged.'),

  h2('3.7 Separation of duties'),
  bullet('The final escrow release requires two different Finance approvers and a passed inbound inspection.'),
  bullet('A step added to an order’s flow is a request; somebody other than the requester must approve it, and both the request and the decision are logged.'),
  bullet('An order’s flow may be re-planned only forwards — phases already completed or in progress cannot be moved or removed.'),
  pageBreak(),
);

// ── 4. Platform overview ────────────────────────────────────────────────────
body.push(
  h1('4. Platform overview'),

  h2('4.1 Who is involved'),
  table(
    [2200, 7546],
    ['Party', 'Role in an order'],
    Object.entries(DATA.stakeholders).map(([, v]) => [{ text: v.label, bold: true }, v.plainLabel]),
  ),

  h2('4.2 Screens'),
  p('The platform has the following screens. Each is described as it is described in the product itself.'),
);

for (const group of DATA.nav) {
  body.push(h3(group.label ?? 'Main'));
  body.push(
    table(
      [2600, 7146],
      ['Screen', 'What it is for'],
      group.items.map((i) => [{ text: i.label, bold: true }, i.hint]),
    ),
  );
  for (const i of group.items) {
    if (i.children && i.children.length) {
      body.push(p(`${i.label} has sub-modes: ${i.children.map((c) => c.label).join('; ')}.`, { size: 18, color: MUTED }));
    }
  }
}

body.push(
  h2('4.3 Commercial settings that change the flow'),
  p('Three choices on a work order change which stages apply to it:'),
  table(
    [2200, 7546],
    ['Setting', 'Effect'],
    [
      [{ text: 'Payment method', bold: true }, `${Object.values(DATA.paymentMethods).map((m) => m.label).join(', ')}. Escrow adds the escrow account, funding and release stages; advance and credit replace them with their own single stage.`],
      [{ text: 'Testing required', bold: true }, `When no line requires testing, the whole quality assurance phase is shown struck through with the reason, rather than hidden.`],
      [{ text: 'Test scope', bold: true }, Object.values(DATA.testScopes).map((s) => `${s.label} — ${s.plainLabel ?? ''}`.trim()).join('; ') + '.'],
    ],
  ),
  pageBreak(),
);

// ── 5. The flow ─────────────────────────────────────────────────────────────
body.push(
  h1('5. The flow, stage by stage'),
  p(`The ladder runs ${DATA.phases.map((f) => f.id).join(' → ')}. Every stage below lists what it is, what must be true to leave it, who owns it, the sub-tasks it breaks into, the documents it expects and every field recorded against it. Document uploads lead each stage’s checklist because paperwork comes from somebody else and is therefore the item most likely to be missing.`),
  p('An order may deviate from this sequence. Phases C, D, E and F can be reordered or removed for a single order, with a reason, and phases A, B and G cannot — A and B are how the order comes into existence, and G raises the tax invoice and closes it.', { color: MUTED, size: 18 }),
);

for (const phase of DATA.phases) {
  const stages = DATA.stages.filter((s) => s.phase === phase.id);
  body.push(
    pageBreak(),
    h2(`Phase ${phase.id} — ${phase.label}`),
    kv('In plain English', phase.plainLabel),
    kv('Owner', phase.owner),
    p(phase.description, { after: 160 }),
  );

  for (const s of stages) {
    body.push(h3(`${s.code} · ${s.label}${s.isExceptionBranch ? '  (exception branch)' : ''}${s.isTerminal ? '  (final stage)' : ''}`));
    body.push(p(s.description));
    body.push(
      table(
        [2000, 7746],
        ['', ''],
        [
          [{ text: 'Plain English', bold: true }, s.plainLabel],
          [{ text: 'Owner', bold: true }, stakeholder(s.owner)],
          [{ text: 'To leave this stage', bold: true }, s.exitCriteria],
          [{ text: 'Next action', bold: true }, `${s.nextAction} (${stakeholder(s.nextActionOwner)})`],
          [{ text: 'Expected time', bold: true }, `${s.expectedHours} hours — past this the order is flagged at risk; past twice this, breached`],
          [{ text: 'Produces', bold: true }, s.artifacts.length ? s.artifacts.join(', ') : 'No artefact of its own'],
          ...(s.conditional ? [[{ text: 'Applies when', bold: true }, 'Conditional — depends on the order’s payment method or testing requirement']] : []),
          ...(s.attestation ? [[{ text: 'You are attesting', bold: true }, s.attestation]] : []),
        ],
      ),
    );

    if (s.subTasks.length) {
      body.push(p('Sub-tasks', { bold: true, size: 18, before: 140, after: 60, color: MUTED }));
      body.push(
        table(
          [560, 5100, 1700, 2386],
          ['#', 'Sub-task', 'Owner', 'Standard / note'],
          s.subTasks.map((t, i) => [
            { text: String(i + 1), align: AlignmentType.CENTER, color: MUTED },
            { text: `${t.label}${t.required ? '  (required)' : ''}`, bold: t.required },
            stakeholder(t.owner),
            t.standard ?? (t.kind === 'DOCUMENT' ? 'Upload' : t.kind === 'CAPTURE' ? 'Form' : ''),
          ]),
        ),
      );
    }

    if (s.documents.length) {
      body.push(p('Documents', { bold: true, size: 18, before: 140, after: 60, color: MUTED }));
      body.push(
        table(
          [2600, 1200, 5946],
          ['Document', 'Required', 'Why it is asked for'],
          s.documents.map((d) => [
            { text: d.label, bold: true },
            { text: d.required ? 'Yes' : 'Optional', color: d.required ? WARN : MUTED },
            d.help,
          ]),
        ),
      );
    }

    if (s.fields.length) {
      body.push(p('Fields recorded', { bold: true, size: 18, before: 140, after: 60, color: MUTED }));
      body.push(
        table(
          [2500, 1000, 1000, 5246],
          ['Field', 'Type', 'Required', 'What to enter'],
          s.fields.map((f) => [
            { text: f.label, bold: true },
            f.type + (f.unit ? ` (${f.unit})` : ''),
            { text: f.required ? 'Yes' : 'If known', color: f.required ? WARN : MUTED },
            f.options && f.options.length ? `${f.help}  Options: ${f.options.join(', ')}.` : f.help,
          ]),
        ),
      );
    }
  }
}

// ── 6. Reference ────────────────────────────────────────────────────────────
body.push(
  pageBreak(),
  h1('6. Reference'),

  h2('6.1 Testing and authentication standards'),
  p('These are not interchangeable. The authentication standard states what a result must show; the ASTM practices state how the underlying measurement is made. A test report citing neither proves nothing.'),
  table(
    [2400, 7346],
    ['Standard', 'What it governs'],
    [
      [{ text: DATA.standards.authentication, bold: true }, 'The authentication standard for suspect and counterfeit electrical, electronic and electromechanical parts. Risk-based, with a slash sheet per method: /3 XRF, /4 destructive physical analysis, /5 X-ray, /6 acoustic microscopy, /7 electrical, /8 Raman, /9 FTIR. Since AS6081 Rev A removed its own criteria and now points here, this is the standard that governs the verdict.'],
      [{ text: DATA.standards.distributor, bold: true }, 'The distributor-facing obligation — what a broker buying on the open market must do. Cites AS6171 for the test criteria.'],
      [{ text: DATA.standards.visual, bold: true }, 'Visual inspection protocol: remarking, resurfacing, repackaging, marking permanency, lead condition.'],
      [{ text: DATA.standards.astmEds, bold: true }, 'Quantitative analysis by energy-dispersive spectroscopy. Used for elemental and material composition of leads and body.'],
      [{ text: DATA.standards.astmXrf, bold: true }, 'Coating thickness by X-ray spectrometry. Used for plating and lead-finish thickness — catches a finish that does not match the marking.'],
      [{ text: DATA.standards.astmXray, bold: true }, 'Radiographic examination practice. Used to compare die and bond wires against a known-good reference.'],
      [{ text: DATA.standards.astmPackaging, bold: true }, 'Commercial packaging practice. Used for the return leg after testing.'],
      [{ text: DATA.standards.moisture, bold: true }, 'Handling, packing and shipping of moisture and reflow sensitive devices. Applies to anything MSL-rated.'],
      [{ text: DATA.standards.solderability, bold: true }, 'Solderability of leads and terminations.'],
    ],
  ),

  h2('6.2 Delivery terms'),
  p('The delivery term decides who arranges carriage, who bears risk at each point, who clears export and import, and therefore what 1BUY should expect to pay for and what is already inside the price.'),
  table(
    [700, 2200, 3400, 3446],
    ['Code', 'Name', 'Delivery and risk', 'Watch out for'],
    DATA.incoterms.map((i) => [
      { text: i.code, bold: true },
      i.name,
      `${i.deliveryPoint} Risk passes: ${i.riskTransfersAt}`,
      i.watchOut ?? '',
    ]),
  ),
  pageBreak(),
);

// ── 7. User guide ───────────────────────────────────────────────────────────
body.push(
  h1('7. User guide'),
  p('This section describes how to do the jobs the platform exists for, in the order a new user meets them.'),

  h2('7.1 Finding your way around'),
  numbered('Press ⌘K (Ctrl+K on Windows) anywhere to search or to jump to a screen. With nothing typed it lists every screen; typing searches work orders, customer and supplier purchase orders, proforma invoices, part numbers, manufacturers, HSN codes, customers, suppliers and document titles.'),
  numbered('A part number or any purchase order number resolves to the order it belongs to, and the result says why it matched — for example “matched on a line item”.'),
  numbered('The bell shows only things that need doing: blocked orders, stages that have overrun, overdue tasks and unread messages. No badge means nothing needs attention.'),
  numbered('The Help button explains the screen you are on, lists the keyboard shortcuts, and can turn on Plain English mode, which swaps trade jargon for everyday words across the whole product.'),

  h2('7.2 Raising a customer order'),
  numbered('Go to Create Purchase Order and choose the customer mode.'),
  numbered('Pick the customer. The deliver-to and invoice-to addresses fill from the customer record and can be edited for this order only — a one-off delivery address must not rewrite the master.'),
  numbered('Add the line items. For more than a handful, use the bulk import: paste from a spreadsheet or upload a CSV, TSV or XLSX file. The expected format is shown on screen and a template can be downloaded. Loose column headings are matched, thousands separators and currency symbols are handled, and every rejected row is listed with its row number and the reason — nothing is dropped silently.'),
  numbered('The delivery date is derived from the purchase order date plus the longest lead time on any line, and can be overridden.'),
  numbered('Save. The order appears under Created Purchase Orders, ready to be linked to a supplier order.'),

  h2('7.3 Linking supply to demand'),
  numbered('Open the customer order\u2019s sourcing view from Created Purchase Orders. It shows each line ordered against covered against short, naming the supplier order that covers each part.'),
  numbered('Link a supplier purchase order to the customer order from there. Lines are matched by part number and the quantity taken is the lesser of what the customer wants and what was bought.'),
  numbered('That link is what creates the work order. Where a line is only partly covered, the order says so \u2014 the shortfall is shown on the order itself rather than left to be discovered at delivery.'),

  h2('7.4 Working an order'),
  numbered('Open the order. The progress rail shows the seven phases and, inside the open phase, its stages. The stage the order is on is marked.'),
  numbered('The Next action panel lists the current stage’s sub-tasks as a checklist, documents first. Click a document row to upload straight from there; click any other row to open the evidence form.'),
  numbered('Click any stage on the rail to preview what it will need. A stage the order has not reached is read-only — you can see every sub-task and document, but nothing can be recorded against it, because evidence filed against a stage the order never entered would satisfy that stage’s gate later without anyone noticing.'),
  numbered('The Flow tab opens every stage out into its sub-tasks and the documents actually filed against it, so “what happens at customs, and what paper comes out of it” is answerable in one place.'),
  numbered('When the stage is complete, use Advance. If evidence is outstanding the form opens first. If you must proceed without it, give a reason of at least eight characters — it is recorded against the order and names exactly what was missing.'),

  h2('7.5 Money and escrow'),
  numbered('Open the escrow account with the provider and place the escrow order, agreeing the release conditions up front. The conditions are what make it escrow rather than a holding account.'),
  numbered('Give the supplier the reference — they will not start work against an arrangement they cannot see.'),
  numbered('Fund the account. Who funds it is negotiated per order and recorded on the work order.'),
  numbered('Release only the testing portion to pay the laboratory. The balance stays held.'),
  numbered('After the inbound inspection passes, authorise the final release. Two different Finance approvers are required and the inspection must have passed — the platform enforces both. Every movement asks for proof and a reason, and the account bar shows funded, released and in-flight amounts separately so the same money cannot be committed twice.'),

  h2('7.6 Testing'),
  numbered('Book the sample dispatch to the laboratory before the full lot moves. Dry-pack anything MSL-rated.'),
  numbered('Agree the test scope and the standard it is performed to. A report with no standard on it proves nothing.'),
  numbered('The scope should include material and lead-finish analysis, radiographic examination and electrical parameter testing, each against the practice named in section 6.1.'),
  numbered('Hold the full lot until the verdict. Shipping before the result is what makes a failed test expensive.'),
  numbered('On a pass, read the report rather than only the verdict — a pass with observations is still a pass, but the observations are what the customer will ask about. On a fail, the order moves to the exception branch and the available routes are offered.'),

  h2('7.7 Shipping, customs and duty'),
  numbered('Check the shipping documents before the goods leave: commercial invoice, packing list, certificate of origin. A wrong HSN code here becomes a customs query later.'),
  numbered('Engage the customs agent on arrival. Demurrage accrues from arrival, not from when the agent is instructed.'),
  numbered('File the Bill of Entry with the CIF value. Customs assesses on CIF, and where freight or insurance is not separately evidenced the statutory notional additions apply.'),
  numbered('Check the assessed duty against the estimate before paying. A large variance usually means a classification dispute, and disputing it after payment is much harder.'),
  numbered('Basic Customs Duty and Social Welfare Surcharge are cost. Import IGST is recoverable and is excluded from landed cost — the margin figure shown is the real one.'),

  h2('7.8 Inspection, delivery and closing'),
  numbered('Inspect what arrived against the order and the test report. This is the gate that releases the final payment, so it carries more weight than any other stage.'),
  numbered('Rebrand and repack to the customer’s specification, preserving moisture-barrier packaging where it applies.'),
  numbered('Raise the tax invoice with the correct place of supply — it decides CGST and SGST versus IGST, and a wrong one means a credit note and a reissue. Generate the e-way bill where the value requires it.'),
  numbered('Issue the proof of delivery, collect payment, and close the order. Closing reconciles the final margin against the quote, which is the number that improves the next one.'),

  h2('7.9 Changing an order’s flow'),
  numbered('On the progress panel choose Adjust flow. Drag a phase to move it, or remove one. Phases A, B and G are fixed, as are any phase already completed or in progress.'),
  numbered('The review dialog names every change as a sentence, lists exactly which stages disappear if a phase is removed, and states the consequences — for example that removing cross-border movement means no Bill of Entry to claim import IGST against.'),
  numbered('A reason of at least twelve characters is required. One audit row is written per changed phase, plus one for the sequence as a whole.'),

  h2('7.10 Adding a step to one order'),
  numbered('Use Request a step in the phase header. Choose where it goes — the picker lists the order’s whole flow and shows where the order currently is; stages already passed cannot be chosen.'),
  numbered('Name the step, say why this order needs it, set the owner and whether it blocks progress.'),
  numbered('Send it for approval. It appears on the flow as requested and gates nothing until approved. Somebody other than the requester must decide it; a rejection requires a reason. Both the request and the decision are logged.'),

  h2('7.11 When something goes wrong'),
  bullet('An order with an open exception is blocked and shows the reason. Each exception type offers named routes out, and choosing one is recorded.'),
  bullet('If a page has been open a long time and the order has moved, the platform says so and reloads rather than reporting a transition error.'),
  bullet('If an external system is unavailable, the step falls back to manual capture. The order is never blocked by a connector.'),
  pageBreak(),
);

// ── 8. Glossary of every field ──────────────────────────────────────────────
body.push(
  h1('8. Every field the platform records'),
  p(`The complete list of ${DATA.stages.reduce((a, s) => a + s.fields.length, 0)} fields captured as stage evidence, in ladder order, with the stage that asks for each. This is the definitive answer to “what does the platform ingest”.`),
);

const allFields = [];
for (const s of DATA.stages) {
  for (const f of s.fields) {
    allFields.push([
      { text: s.code, bold: true },
      f.label,
      f.type,
      { text: f.required ? 'Yes' : '—', color: f.required ? WARN : MUTED },
      f.help,
    ]);
  }
}
body.push(table([700, 2400, 900, 800, 4946], ['Stage', 'Field', 'Type', 'Req.', 'What to enter'], allFields));

body.push(
  h2('8.1 Every document slot'),
  p(`${DATA.stages.reduce((a, s) => a + s.documents.length, 0)} document slots across the ladder.`),
);
const allDocs = [];
for (const s of DATA.stages) {
  for (const d of s.documents) {
    allDocs.push([
      { text: s.code, bold: true },
      d.label,
      { text: d.required ? 'Yes' : '—', color: d.required ? WARN : MUTED },
      d.help,
    ]);
  }
}
body.push(table([700, 2800, 800, 5446], ['Stage', 'Document', 'Req.', 'Why it is asked for'], allDocs));

// ═══════════════════════════════════════════════════════════════════════════
const doc = new Document({
  creator: '1BUY',
  title: '1BUY Fulfilment Platform',
  description: 'Problem statement, objectives, methodology and user guide',
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 200 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 760, hanging: 200 } } } },
        ],
      },
      {
        reference: 'steps',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 240 } } } },
        ],
      },
    ],
  },
  styles: {
    default: { document: { run: { font: 'Calibri', size: 20, color: INK } } },
  },
  sections: [
    {
      properties: {
        page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 120 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } },
              children: [new TextRun({ text: '1BUY Fulfilment Platform', size: 16, color: MUTED })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED })],
            }),
          ],
        }),
      },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2];
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} — ${(buf.length / 1024).toFixed(0)} KB`);
});
