/**
 * Reading a simple .xlsx sheet with no dependencies.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY
 *
 * The obvious choice is SheetJS, but the npm build carries four unfixed
 * high-severity advisories — prototype pollution and ReDoS — and the fixed
 * versions are only distributed from the vendor's own CDN. This code parses files
 * an operator uploaded, which is precisely the threat model those advisories
 * describe, so pulling it in to save an afternoon would be a poor trade.
 *
 * WHAT AN .xlsx ACTUALLY IS
 *
 * A ZIP archive of XML. For reading a flat sheet, only two entries matter:
 *   xl/worksheets/sheet1.xml   the cells, with references like C4
 *   xl/sharedStrings.xml       the string table cells point into
 *
 * ZIP stores entries with raw DEFLATE, which the platform inflates natively via
 * DecompressionStream('deflate-raw'). So the whole job is: find those two entries
 * in the archive, inflate them, walk the XML.
 *
 * SCOPE, HONESTLY
 *
 * This reads values from the first worksheet. It does not evaluate formulas — it
 * takes the cached value Excel stored alongside them, which is what the operator
 * saw on screen. It does not handle charts, merged-cell semantics, or dates as
 * anything other than their underlying serial number, because a parts list does
 * not need any of that. Anything it cannot read comes back as an error rather
 * than as silently missing rows.
 */

/** One entry located in the ZIP central directory. */
interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Walks the central directory backwards from the end-of-central-directory record.
 *
 * Reading the directory rather than scanning for local headers matters: a local
 * header can lie about sizes when the entry was written as a stream, and the
 * directory is the authoritative copy.
 */
function readZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // The EOCD sits in the last 64KB, after a comment of unknown length.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive — no end-of-central-directory record found.');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== SIG_CENTRAL) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflates one entry to text. Method 0 is stored, 8 is deflate. */
async function readEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // The local header's variable-length fields have to be skipped to find the data.
  const nameLen = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLen = view.getUint16(entry.localHeaderOffset + 28, true);
  const start = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) return new TextDecoder().decode(raw);
  if (entry.compressionMethod !== 8) {
    throw new Error(`Unsupported compression in the workbook (method ${entry.compressionMethod}).`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot inflate the workbook. Save the sheet as CSV instead.');
  }
  const stream = new Blob([raw as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** `C12` → column index 2, row index 11. Both zero-based. */
function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/** Collapses the XML entity escapes that appear in sheet text. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * The shared string table.
 *
 * Strings in a sheet are usually indices into this table rather than inline text.
 * A single string can be split across several `<t>` runs when part of it is
 * formatted differently, so the runs of one `<si>` are concatenated.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    let text = '';
    for (const t of si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []) {
      text += unescapeXml(t.replace(/<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, ''));
    }
    out.push(text);
  }
  return out;
}

/**
 * Turns the first worksheet into a grid of strings.
 *
 * Missing cells become empty strings so every row has the same width — a sparse
 * sheet where row 5 skips column C must not shift its remaining values left.
 */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let maxCol = 0;

  for (const rowXml of xml.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
    const rowRef = /\br="(\d+)"/.exec(rowXml);
    const rowIdx = rowRef ? Number(rowRef[1]) - 1 : rows.length;
    const cells: string[] = [];

    for (const cellXml of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const refM = /\br="([A-Z]+\d+)"/.exec(cellXml);
      const pos = refM ? parseRef(refM[1]) : null;
      const colIdx = pos ? pos.col : cells.length;
      const type = /\bt="([^"]+)"/.exec(cellXml)?.[1] ?? 'n';

      let value = '';
      if (type === 'inlineStr') {
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cellXml);
        value = t ? unescapeXml(t[1]) : '';
      } else {
        // `v` holds the value; for a formula cell it is the cached result, which
        // is what the operator saw when they saved the file.
        const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
        const raw = v ? unescapeXml(v[1]) : '';
        if (type === 's') {
          const idx = Number(raw);
          value = Number.isInteger(idx) && shared[idx] != null ? shared[idx] : '';
        } else {
          value = raw;
        }
      }
      cells[colIdx] = value;
      if (colIdx + 1 > maxCol) maxCol = colIdx + 1;
    }
    rows[rowIdx] = cells;
  }

  // Fill the holes so the grid is rectangular.
  return rows.map((r) => {
    const filled = r ?? [];
    for (let i = 0; i < maxCol; i++) if (filled[i] == null) filled[i] = '';
    return filled.slice(0, maxCol);
  });
}

/**
 * Reads the first worksheet of an .xlsx and returns it as delimited text, so the
 * existing CSV parser handles both formats with one code path.
 *
 * Tab-delimited rather than comma: a description containing a comma is normal,
 * a description containing a tab is not, so tabs need no quoting rules.
 */
export async function xlsxToDelimitedText(file: ArrayBuffer): Promise<string> {
  const entries = readZipEntries(file);

  const sheetEntry =
    entries.find((e) => e.name === 'xl/worksheets/sheet1.xml') ??
    entries.find((e) => /^xl\/worksheets\/.*\.xml$/.test(e.name));
  if (!sheetEntry) {
    throw new Error('No worksheet found inside the workbook.');
  }

  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(await readEntry(file, sharedEntry)) : [];
  const grid = parseSheet(await readEntry(file, sheetEntry), shared);

  return grid
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => r.map((c) => c.replace(/\t/g, ' ')).join('\t'))
    .join('\n');
}

export function isXlsx(name: string): boolean {
  return /\.xlsx$/i.test(name);
}

/** .xls is the old binary format — a different problem, and worth saying so. */
export function isLegacyXls(name: string): boolean {
  return /\.xls$/i.test(name);
}
