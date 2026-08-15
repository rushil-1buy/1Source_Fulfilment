/**
 * The writer is tested through the READER this codebase already trusts:
 * write a workbook, hand the bytes to xlsx-lite, and expect the same cells
 * back. If either side drifts from the spec, this round-trip is where it
 * shows up — long before Excel gets a chance to refuse the file.
 */

import { describe, expect, it } from 'vitest';
import { rowsToXlsx } from './xlsx-write';
import { xlsxToDelimitedText } from './xlsx-lite';

const roundTrip = async (rows: Parameters<typeof rowsToXlsx>[0]) => {
  const bytes = rowsToXlsx(rows, 'P&L');
  return xlsxToDelimitedText(bytes.buffer as ArrayBuffer);
};

describe('xlsx writer — round-trips through the reader', () => {
  it('starts with the ZIP magic, so file sniffers accept it', () => {
    const b = rowsToXlsx([['x']]);
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('preserves strings and numbers cell for cell', async () => {
    const text = await roundTrip([
      ['Section', 'Label', 'Amount'],
      ['Revenue', 'Invoiced to customer', 113000],
      ['Cost', 'Freight & carriage', 690.5],
    ]);
    expect(text).toContain('Invoiced to customer');
    expect(text).toContain('113000');
    expect(text).toContain('690.5');
  });

  it('survives the characters a P&L actually contains — ampersands, quotes, rupee notes', async () => {
    const text = await roundTrip([['Duty & cess — "non-creditable" <estimate>', 42]]);
    expect(text).toContain('Duty & cess — "non-creditable" <estimate>');
  });

  it('skips empty cells without shifting their neighbours off column', async () => {
    const text = await roundTrip([
      ['a', null, 'c'],
      ['', 'b', ''],
    ]);
    // The reader renders by cell reference, so c must not collapse into column B.
    expect(text.split('\n')[0]).toMatch(/a\t\tc|a,,"?c/);
  });
});
