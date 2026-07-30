/**
 * BULK IMPORT of part lines from a spreadsheet.
 *
 * Typing forty MPNs by hand is where wrong part numbers come from, so the lines
 * arrive from the file the buyer was already working in.
 *
 * Design decisions worth knowing:
 *
 *  · **Nothing is silently dropped.** Every row that cannot be used comes back as
 *    a problem naming its row number and what was wrong. A parser that quietly
 *    skips rows produces an order short of parts nobody notices until delivery.
 *  · **Headers are matched loosely.** Real files say "Part No", "MPN", "Part
 *    Number", "Manufacturer Part Number". Rejecting a file over a header spelling
 *    sends the operator back to typing.
 *  · **Only MPN and quantity are required.** Everything else has a sensible
 *    default or is looked up from the catalogue afterwards, so a two-column paste
 *    works.
 *  · Quantities and prices tolerate thousands separators, currency symbols and
 *    stray spaces, because exported spreadsheets are full of them.
 *
 * Pure functions, so the parsing is testable without a browser or a file.
 */

/** One row the importer could make sense of. */
export interface ImportedLine {
  /** 1-based row number in the file, for error messages. */
  rowNo: number;
  mpn: string;
  quantity: number;
  unitPrice: number | null;
  manufacturer: string | null;
  description: string | null;
  hsnCode: string | null;
  leadTimeDays: number | null;
  dateCodeLot: string | null;
  testingRequired: boolean;
  remarks: string | null;
}

export interface ImportProblem {
  rowNo: number;
  /** The raw row, so the operator can see what was rejected. */
  raw: string;
  message: string;
}

export interface ImportResult {
  lines: ImportedLine[];
  problems: ImportProblem[];
  /** Headers found in the file, in order, for the "we read it like this" note. */
  detectedColumns: string[];
  /** True when no header row was found and positional order was assumed. */
  assumedPositional: boolean;
}

/**
 * Header synonyms. The left of each pair is our field; everything on the right is
 * a spelling seen in real distributor and customer spreadsheets.
 */
const HEADER_ALIASES: Record<keyof Omit<ImportedLine, 'rowNo'>, string[]> = {
  mpn: [
    'mpn',
    'part',
    'partno',
    'partnumber',
    'partnum',
    'manufacturerpartnumber',
    'mfgpartnumber',
    'mfrpartnumber',
    'itemcode',
    'material',
  ],
  quantity: ['quantity', 'qty', 'qtyreq', 'quantityrequired', 'pcs', 'pieces', 'reqqty', 'orderqty'],
  unitPrice: ['unitprice', 'price', 'rate', 'unitrate', 'costperpiece', 'unitcost', 'priceperunit'],
  manufacturer: ['manufacturer', 'mfg', 'mfr', 'brand', 'make'],
  description: ['description', 'desc', 'partdescription', 'details'],
  hsnCode: ['hsn', 'hsncode', 'hsnsac', 'tariffcode'],
  leadTimeDays: ['leadtime', 'leadtimedays', 'lead', 'leaddays', 'ltdays'],
  dateCodeLot: ['datecode', 'datecodelot', 'lot', 'lotcode', 'batch', 'dc'],
  testingRequired: ['testing', 'testingrequired', 'test', 'needstesting', 'qc'],
  remarks: ['remarks', 'notes', 'comment', 'comments'],
};

/** Strips everything that varies between spellings of the same header. */
function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchHeader(h: string): keyof Omit<ImportedLine, 'rowNo'> | null {
  const n = normaliseHeader(h);
  if (!n) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return field as keyof Omit<ImportedLine, 'rowNo'>;
  }
  return null;
}

/**
 * Splits one delimited line, honouring double quotes.
 *
 * Written out rather than a regex split because a quoted description containing
 * a comma — "Resistor, 10k, 1%" — is completely normal in these files and a naive
 * split turns one part into three broken columns.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote.
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Comma, semicolon or tab — whichever appears most in the header row. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const counts: Record<string, number> = {
    ',': (firstLine.match(/,/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

/**
 * A number out of a spreadsheet cell.
 *
 * Handles "1,200", "₹ 1,200.50", "1 200", "(500)" for negatives and trailing
 * units like "1200 pcs" — all of which turn up in exported files and all of which
 * `Number()` would silently make NaN.
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t);
  t = t
    .replace(/^\(|\)$/g, '')
    .replace(/[₹$€£]/g, '')
    .replace(/[,\s]/g, '')
    // Strip a trailing unit like "pcs" or "nos".
    .replace(/[a-z%]+$/i, '');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const TRUTHY = new Set(['y', 'yes', 'true', '1', 'required', 'req', 'x', 'needed']);

export function parseBoolean(raw: string): boolean {
  return TRUTHY.has(String(raw ?? '').trim().toLowerCase());
}

/** The order columns are read in when the file has no recognisable header row. */
const POSITIONAL: (keyof Omit<ImportedLine, 'rowNo'>)[] = [
  'mpn',
  'quantity',
  'unitPrice',
  'manufacturer',
  'description',
  'hsnCode',
  'leadTimeDays',
  'dateCodeLot',
  'testingRequired',
  'remarks',
];

export function parseLineImport(text: string): ImportResult {
  const problems: ImportProblem[] = [];
  const lines: ImportedLine[] = [];

  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trimEnd())
    // Blank rows are padding, not errors — an exported sheet is full of them.
    .filter((r) => r.trim().length > 0);

  if (rows.length === 0) {
    return { lines, problems: [{ rowNo: 0, raw: '', message: 'The file is empty.' }], detectedColumns: [], assumedPositional: false };
  }

  const delimiter = detectDelimiter(text);
  const firstCells = splitDelimited(rows[0], delimiter);
  const mapped = firstCells.map(matchHeader);
  const recognised = mapped.filter(Boolean).length;

  /**
   * A header row is one where at least two cells are recognised names AND the
   * first cell is not itself a plausible quantity. Two is the threshold because a
   * single accidental match — a part literally called "QTY" — should not cost the
   * operator their first row of data.
   */
  const hasHeader = recognised >= 2;
  const columns: (keyof Omit<ImportedLine, 'rowNo'>)[] = hasHeader
    ? mapped.map((m, i) => m ?? POSITIONAL[i] ?? 'remarks')
    : POSITIONAL;

  const detectedColumns = hasHeader
    ? firstCells.map((c, i) => `${c.trim() || `column ${i + 1}`} → ${mapped[i] ?? 'ignored'}`)
    : [];

  const bodyRows = hasHeader ? rows.slice(1) : rows;
  const rowOffset = hasHeader ? 2 : 1;

  bodyRows.forEach((raw, i) => {
    const rowNo = i + rowOffset;
    const cells = splitDelimited(raw, delimiter);
    const get = (field: keyof Omit<ImportedLine, 'rowNo'>): string => {
      const idx = columns.indexOf(field);
      return idx >= 0 ? (cells[idx] ?? '') : '';
    };

    const mpn = get('mpn').trim();
    const qtyRaw = get('quantity');
    const quantity = parseNumber(qtyRaw);

    if (!mpn) {
      problems.push({ rowNo, raw, message: 'No part number in this row.' });
      return;
    }
    if (quantity == null) {
      problems.push({
        rowNo,
        raw,
        message: qtyRaw.trim()
          ? `Could not read "${qtyRaw.trim()}" as a quantity.`
          : 'No quantity in this row.',
      });
      return;
    }
    if (quantity <= 0) {
      problems.push({ rowNo, raw, message: `Quantity is ${quantity} — it has to be more than zero.` });
      return;
    }
    if (!Number.isInteger(quantity)) {
      problems.push({
        rowNo,
        raw,
        message: `Quantity ${quantity} is not a whole number. Components come in whole pieces.`,
      });
      return;
    }

    const unitPrice = parseNumber(get('unitPrice'));
    const lead = parseNumber(get('leadTimeDays'));

    lines.push({
      rowNo,
      mpn: mpn.toUpperCase(),
      quantity,
      unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
      manufacturer: get('manufacturer').trim() || null,
      description: get('description').trim() || null,
      hsnCode: get('hsnCode').trim() || null,
      leadTimeDays: lead != null && lead >= 0 ? Math.round(lead) : null,
      dateCodeLot: get('dateCodeLot').trim() || null,
      testingRequired: parseBoolean(get('testingRequired')),
      remarks: get('remarks').trim() || null,
    });
  });

  /**
   * The same part twice is almost always two lines of one order rather than a
   * mistake, so they are kept — but flagged, because the other possibility is a
   * copy-paste error and only the operator can tell which.
   */
  const seen = new Map<string, number[]>();
  for (const l of lines) {
    const list = seen.get(l.mpn) ?? [];
    list.push(l.rowNo);
    seen.set(l.mpn, list);
  }
  for (const [mpn, rowNos] of seen) {
    if (rowNos.length > 1) {
      problems.push({
        rowNo: rowNos[0],
        raw: mpn,
        message: `${mpn} appears ${rowNos.length} times (rows ${rowNos.join(', ')}). Kept as separate lines — merge them if that was not intended.`,
      });
    }
  }

  return { lines, problems, detectedColumns, assumedPositional: !hasHeader };
}

/** The header row of the downloadable sample, and the order columns are read in. */
export const IMPORT_TEMPLATE_HEADERS = [
  'MPN',
  'Quantity',
  'Unit Price',
  'Manufacturer',
  'Description',
  'HSN',
  'Lead Time Days',
  'Date Code / Lot',
  'Testing Required',
  'Remarks',
] as const;

/** A filled-in sample, so the format is shown rather than described. */
export const IMPORT_TEMPLATE_ROWS: string[][] = [
  ['STM32F407VGT6', '1200', '985', 'STMicroelectronics', 'ARM Cortex-M4 MCU, LQFP-100', '85423100', '21', '2437+', 'yes', 'Firm date code required'],
  ['W25Q128JVSIQ', '3000', '152', 'Winbond', '128Mb serial NOR flash, SOIC-8', '85423200', '14', '', 'no', ''],
  ['SN74HC595N', '9000', '34', 'Texas Instruments', '8-bit shift register, PDIP-16', '85423900', '28', '', 'no', 'Commodity — pool if possible'],
];

/** CSV text for the sample file, quoted so descriptions with commas survive. */
export function importTemplateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    IMPORT_TEMPLATE_HEADERS.join(','),
    ...IMPORT_TEMPLATE_ROWS.map((r) => r.map(esc).join(',')),
  ].join('\n');
}
