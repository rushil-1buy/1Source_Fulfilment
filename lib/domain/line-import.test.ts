import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  importTemplateCsv,
  parseBoolean,
  parseLineImport,
  parseNumber,
  splitDelimited,
} from './line-import';

describe('parseNumber — spreadsheet cells are not clean numbers', () => {
  it('reads plain numbers', () => {
    expect(parseNumber('1200')).toBe(1200);
    expect(parseNumber('98.5')).toBe(98.5);
  });

  it('strips thousands separators', () => {
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber('1,20,000')).toBe(120000);
    expect(parseNumber('1 200')).toBe(1200);
  });

  it('strips currency symbols', () => {
    expect(parseNumber('₹ 1,200.50')).toBe(1200.5);
    expect(parseNumber('$9.15')).toBe(9.15);
  });

  it('reads parenthesised negatives, as exported sheets write them', () => {
    expect(parseNumber('(500)')).toBe(-500);
  });

  it('strips a trailing unit', () => {
    expect(parseNumber('1200 pcs')).toBe(1200);
    expect(parseNumber('30%')).toBe(30);
  });

  it('returns null for anything it cannot read, rather than NaN', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber('TBC')).toBeNull();
    expect(parseNumber('12-34')).toBeNull();
  });
});

describe('splitDelimited — quoted fields', () => {
  it('keeps a comma inside quotes with its field', () => {
    expect(splitDelimited('STM32,1200,"Resistor, 10k, 1%"', ',')).toEqual([
      'STM32',
      '1200',
      'Resistor, 10k, 1%',
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(splitDelimited('A,"say ""hi"""', ',')).toEqual(['A', 'say "hi"']);
  });

  it('handles tabs', () => {
    expect(splitDelimited('A\t1\tB', '\t')).toEqual(['A', '1', 'B']);
  });
});

describe('detectDelimiter', () => {
  it('picks commas, semicolons or tabs by whichever the header uses', () => {
    expect(detectDelimiter('mpn,qty\nA,1')).toBe(',');
    expect(detectDelimiter('mpn;qty\nA;1')).toBe(';');
    expect(detectDelimiter('mpn\tqty\nA\t1')).toBe('\t');
  });

  it('falls back to a comma for a single column', () => {
    expect(detectDelimiter('mpn\nSTM32')).toBe(',');
  });
});

describe('parseBoolean', () => {
  it('accepts the spellings people actually type', () => {
    for (const v of ['y', 'YES', 'true', '1', 'Required', 'x']) expect(parseBoolean(v)).toBe(true);
    for (const v of ['', 'n', 'no', 'false', '0', 'later']) expect(parseBoolean(v)).toBe(false);
  });
});

describe('parseLineImport — headers', () => {
  it('reads the template it hands out', () => {
    const r = parseLineImport(importTemplateCsv());
    expect(r.problems.filter((p) => !p.message.includes('appears'))).toEqual([]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0].mpn).toBe('STM32F407VGT6');
    expect(r.lines[0].quantity).toBe(1200);
    expect(r.lines[0].unitPrice).toBe(985);
    expect(r.lines[0].leadTimeDays).toBe(21);
    expect(r.lines[0].testingRequired).toBe(true);
    expect(r.lines[1].testingRequired).toBe(false);
    expect(r.assumedPositional).toBe(false);
  });

  it('matches header spellings loosely', () => {
    const r = parseLineImport('Part No.,Qty Req,Rate\nSTM32,100,9.15');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].mpn).toBe('STM32');
    expect(r.lines[0].quantity).toBe(100);
    expect(r.lines[0].unitPrice).toBe(9.15);
  });

  it('accepts a two-column paste — only part and quantity are required', () => {
    const r = parseLineImport('MPN,Quantity\nLM358N,5000\nNE555P,2000');
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.mpn, l.quantity])).toEqual([
      ['LM358N', 5000],
      ['NE555P', 2000],
    ]);
    expect(r.lines[0].unitPrice).toBeNull();
  });

  it('falls back to column order when there is no header row', () => {
    const r = parseLineImport('LM358N,5000,0.25\nNE555P,2000,0.11');
    expect(r.assumedPositional).toBe(true);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].unitPrice).toBe(0.25);
  });

  it('does not eat the first data row over a single accidental header match', () => {
    // "QTY" alone is not enough to call this a header row.
    const r = parseLineImport('QTY,9999\nLM358N,5000');
    expect(r.assumedPositional).toBe(true);
    expect(r.lines.map((l) => l.mpn)).toContain('LM358N');
  });

  it('uppercases part numbers so casing never splits one part into two', () => {
    const r = parseLineImport('MPN,Quantity\nlm358n,10');
    expect(r.lines[0].mpn).toBe('LM358N');
  });

  it('ignores blank padding rows without complaining', () => {
    const r = parseLineImport('MPN,Quantity\nLM358N,10\n\n\nNE555P,20\n');
    expect(r.lines).toHaveLength(2);
    expect(r.problems).toEqual([]);
  });
});

describe('parseLineImport — nothing is dropped silently', () => {
  it('reports a row with no part number, naming the row', () => {
    const r = parseLineImport('MPN,Quantity\n,500\nLM358N,10');
    expect(r.lines).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].rowNo).toBe(2);
    expect(r.problems[0].message).toMatch(/No part number/);
  });

  it('reports an unreadable quantity and quotes it back', () => {
    const r = parseLineImport('MPN,Quantity\nLM358N,TBC');
    expect(r.lines).toEqual([]);
    expect(r.problems[0].message).toMatch(/Could not read "TBC" as a quantity/);
  });

  it('reports a missing quantity differently from an unreadable one', () => {
    const r = parseLineImport('MPN,Quantity\nLM358N,');
    expect(r.problems[0].message).toMatch(/No quantity/);
  });

  it('rejects zero and negative quantities', () => {
    const r = parseLineImport('MPN,Quantity\nA,0\nB,(50)');
    expect(r.lines).toEqual([]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0].message).toMatch(/more than zero/);
  });

  it('rejects a fractional quantity — components come in whole pieces', () => {
    const r = parseLineImport('MPN,Quantity\nA,10.5');
    expect(r.lines).toEqual([]);
    expect(r.problems[0].message).toMatch(/not a whole number/);
  });

  it('keeps a repeated part but flags it, because only the operator knows', () => {
    const r = parseLineImport('MPN,Quantity\nLM358N,10\nLM358N,20');
    expect(r.lines).toHaveLength(2);
    const dup = r.problems.find((p) => p.message.includes('appears'));
    expect(dup?.message).toMatch(/LM358N appears 2 times \(rows 2, 3\)/);
    expect(dup?.message).toMatch(/merge them if that was not intended/);
  });

  it('reports an empty file rather than returning nothing', () => {
    const r = parseLineImport('   \n  \n');
    expect(r.problems[0].message).toBe('The file is empty.');
  });

  it('survives a quoted description containing commas', () => {
    const r = parseLineImport(
      'MPN,Quantity,Description\nRC0603,50000,"Thick film resistor, 10k, 1%, 0603"',
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].description).toBe('Thick film resistor, 10k, 1%, 0603');
    expect(r.lines[0].quantity).toBe(50000);
  });
});
