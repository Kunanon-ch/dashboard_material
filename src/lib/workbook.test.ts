// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MAX_WORKBOOK_BYTES, parseWorkbook, parseWorkbookFile } from './workbook';

function encode(sheet: XLSX.WorkSheet, sheetName = 'all', date1904 = false): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  if (date1904) workbook.Workbook = { WBProps: { date1904: true } };
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function fixture(rows: unknown[][] = [['2026-01', 4, 132], ['2026-02', 5, 170]]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ['Month', 'Material'],
    ['Month/Year', 'Copper (USD/Lbs)', 'Copper (Baht/Lbs)'],
    ...rows,
  ]);
}

describe('Excel material-price import', () => {
  it('reads monthly rows, stable series IDs, currencies and source columns', () => {
    const { dataset, sheetName, warnings } = parseWorkbook(encode(fixture()));
    expect(sheetName).toBe('all');
    expect(warnings).toEqual([]);
    expect(dataset.series).toEqual([
      { id: 'copper_usd', name: 'Copper', category: 'Metals', currency: 'USD', unit: 'Lbs', sourceColumn: 'B' },
      { id: 'copper_thb', name: 'Copper', category: 'Metals', currency: 'THB', unit: 'Lbs', sourceColumn: 'C' },
    ]);
    expect(dataset.rows).toEqual([
      { month: '2026-01-01', values: { copper_usd: 4, copper_thb: 132 } },
      { month: '2026-02-01', values: { copper_usd: 5, copper_thb: 170 } },
    ]);
  });

  it('reads saved formula values without recalculating them', () => {
    const sheet = fixture();
    sheet.C3 = { t: 'n', f: 'B3*33', v: 131.75 };
    const result = parseWorkbook(encode(sheet));
    expect(result.dataset.rows[0].values.copper_thb).toBe(131.75);
    expect(result.warnings.join(' ')).toContain('1 formula results');
  });

  it.each([
    { t: 'n', f: 'B3*33' },
    { t: 'n', f: 'B3*33', v: null },
    { t: 'z', f: 'B3*33' },
  ] as XLSX.CellObject[])('rejects a formula without a cache, including zero-valued stubs: %j', (cell) => {
    const sheet = fixture();
    sheet.C3 = cell;
    expect(() => parseWorkbook(encode(sheet))).toThrow(/C3.*formula without a saved result/);
  });

  it('rejects Excel error cells with their address', () => {
    const sheet = fixture();
    sheet.C3 = { t: 'e', v: 7, f: '1/0' };
    expect(() => parseWorkbook(encode(sheet))).toThrow(/C3.*Excel error/);
  });

  it('preserves zeros and missing values separately', () => {
    const { dataset, warnings } = parseWorkbook(encode(fixture([['2026-01', 0, null]])));
    expect(dataset.rows[0].values).toEqual({ copper_usd: 0, copper_thb: null });
    expect(warnings.join(' ')).toContain('1 blank price cell');
  });

  it('accepts explicit numeric text without silently coercing other values', () => {
    const { dataset } = parseWorkbook(encode(fixture([['2026-01', '1,250.25', '-.5']])));
    expect(dataset.rows[0].values).toEqual({ copper_usd: 1250.25, copper_thb: -0.5 });
  });

  it.each(['N/A', '-', '12abc', '1,25', ' ', '1e999', true])('rejects non-numeric price %j', (value) => {
    expect(() => parseWorkbook(encode(fixture([['2026-01', value, 132]])))).toThrow(/B3.*finite number/);
  });

  it.each([1_000_000_000_001, -1_000_000_000_001, '1,000,000,000,001', '-1.1e12'])('rejects price %j above the database publication bound', (value) => {
    expect(() => parseWorkbook(encode(fixture([['2026-01', value, 132]])))).toThrow(/B3.*between -1,000,000,000,000 and 1,000,000,000,000/);
  });

  it('accepts both inclusive database price limits', () => {
    const { dataset } = parseWorkbook(encode(fixture([['2026-01', -1_000_000_000_000, '1,000,000,000,000']])));
    expect(dataset.rows[0].values).toEqual({ copper_usd: -1_000_000_000_000, copper_thb: 1_000_000_000_000 });
  });

  it('validates saved formula results against the publication bound', () => {
    const sheet = fixture();
    sheet.C3 = { t: 'n', f: 'B3*33', v: 1_000_000_000_001 };
    expect(() => parseWorkbook(encode(sheet))).toThrow(/C3.*between -1,000,000,000,000 and 1,000,000,000,000/);
  });

  it('accepts added monthly rows and sorts by month without changing values', () => {
    const result = parseWorkbook(encode(fixture([
      ['2026-03-31', 6, 204], ['2026-01-31', 4, 132], ['2026-02-28', 5, 170],
    ])));
    expect(result.dataset.rows.map((row) => row.month)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(result.dataset.rows[2].values.copper_usd).toBe(6);
  });

  it('normalizes Excel serial dates to their calendar month', () => {
    const result = parseWorkbook(encode(fixture([[45322, 4, 132]])));
    expect(result.dataset.rows[0].month).toBe('2024-01-01');
  });

  it('respects the workbook 1904 date system', () => {
    const result = parseWorkbook(encode(fixture([[0, 4, 132]]), 'all', true));
    expect(result.dataset.rows[0].month).toBe('1904-01-01');
  });

  it.each(['2026-02-30', '2026-13', '2026-00', '2200-01', '02/01/2026', 'not a date', 60, -1])('rejects invalid or ambiguous dates %j', (value) => {
    expect(() => parseWorkbook(encode(fixture([[value, 4, 132]])))).toThrow(/A3/);
  });

  it('rejects two dates from the same calendar month', () => {
    expect(() => parseWorkbook(encode(fixture([['2026-01-01', 4, 132], ['2026-01-31', 5, 165]])))).toThrow(/duplicates 2026-01/);
  });

  it('rejects a populated row with no date', () => {
    expect(() => parseWorkbook(encode(fixture([[null, 4, 132]])))).toThrow(/A3.*date/);
  });

  it('ignores formatted empty rows, including a very large declared range', () => {
    const sheet = fixture([['2026-01', 4, 132]]);
    sheet.A10000 = { t: 'z' };
    sheet.C10000 = { t: 'z' };
    sheet['!ref'] = 'A1:C10000';
    expect(parseWorkbook(encode(sheet)).dataset.rows).toHaveLength(1);
  });

  it('rejects data in a column with no header', () => {
    const sheet = fixture();
    sheet.D3 = { t: 'n', v: 99 };
    sheet['!ref'] = 'A1:D4';
    expect(() => parseWorkbook(encode(sheet))).toThrow(/D3.*without a recognized column header/);
  });

  it('normalizes source header spacing, the PA66 Bath typo and Thai gypsum units', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Month/Year', 'Nickel  (USD/T)', 'PA66 (Bath/Kg)', 'ยิปซั่ม \r\n(บาท/เมตริกตัน)', 'NGV (Baht / Kg)', 'ค่าเงิน USD', 'ค่าเงินหยวน Y/ B'],
      ['2026-01', 15000, 200, 650, 19, 33, 4.8],
    ]);
    const { dataset } = parseWorkbook(encode(sheet, 'Prices'));
    expect(dataset.series.map(({ id }) => id)).toEqual(['nickel_usd', 'pa66_thb', 'gypsum_thb', 'ngv_thb', 'usd_thb', 'cny_thb']);
    expect(dataset.series[2]).toMatchObject({ name: 'Gypsum', category: 'Other', currency: 'THB', unit: 'T' });
    expect(dataset.series[4]).toMatchObject({ category: 'FX', currency: 'THB', unit: 'USD' });
    expect(dataset.series[5]).toMatchObject({ category: 'FX', currency: 'THB', unit: 'CNY' });
  });

  it('adds new material columns when their header includes currency and unit metadata', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Month/Year', 'Glass (Baht/T)', 'Aluminium Foil (USD/Kg)'],
      ['2026-01', 1200, 2.5],
    ]);
    const { dataset } = parseWorkbook(encode(sheet));
    expect(dataset.series).toEqual([
      { id: 'glass_thb_t', name: 'Glass', category: 'Other', currency: 'THB', unit: 'T', sourceColumn: 'B' },
      { id: 'aluminium_foil_usd_kg', name: 'Aluminium Foil', category: 'Other', currency: 'USD', unit: 'Kg', sourceColumn: 'C' },
    ]);
  });

  it('rejects duplicate normalized series headers', () => {
    const sheet = fixture();
    sheet.C2 = { t: 's', v: ' Copper ( USD / Lbs ) ' };
    expect(() => parseWorkbook(encode(sheet))).toThrow(/repeats the header/);
  });

  it('rejects unknown headers instead of inventing currency or unit metadata', () => {
    const sheet = fixture();
    sheet.C2 = { t: 's', v: 'Mystery price' };
    expect(() => parseWorkbook(encode(sheet))).toThrow(/C2.*unrecognized header/);
  });

  it('requires the Month/Year header', () => {
    const sheet = fixture();
    sheet.A2 = { t: 's', v: 'Date' };
    expect(() => parseWorkbook(encode(sheet))).toThrow(/Month\/Year/);
  });

  it('requires at least one numeric value', () => {
    expect(() => parseWorkbook(encode(fixture([['2026-01', null, null]])))).toThrow(/at least one numeric/);
  });

  it('caps upload size before parsing', () => {
    expect(() => parseWorkbook(new ArrayBuffer(MAX_WORKBOOK_BYTES + 1))).toThrow(/larger than 5 MB/);
  });

  it.each([12, 14])('checks expanded publication size independently of workbook bytes (%i series)', (seriesCount) => {
    const headers = [
      'Copper (USD/Lbs)', 'Copper (Baht/Lbs)',
      'Hot-Rolled Coil Steel (USD/T)', 'Hot-Rolled Coil Steel (Baht/T)',
      'Nickel (USD/T)', 'Nickel (Baht/T)', 'Aluminum (USD/T)', 'Aluminum (Baht/T)',
      'Steel (CNY/T)', 'Steel (Baht/T)', 'Zinc (USD/T)', 'Zinc (Baht/T)',
      'Silver (USD/t.oz)', 'Silver (Baht/t.oz)',
    ].slice(0, seriesCount);
    const rows = Array.from({ length: 1_200 }, (_, index) => [
      `${1900 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`,
      // PostgreSQL stores the JSON number 5e-324 as 0. followed by 323 zeroes and 5.
      ...headers.map(() => Number.MIN_VALUE),
    ]);
    const buffer = encode(XLSX.utils.aoa_to_sheet([['Month/Year', ...headers], ...rows]));
    expect(buffer.byteLength).toBeLessThan(MAX_WORKBOOK_BYTES);
    if (seriesCount === 12) {
      const { dataset } = parseWorkbook(buffer);
      expect(dataset.rows).toHaveLength(1_200);
      expect(dataset.rows[0].values.copper_usd).toBe(Number.MIN_VALUE);
    } else {
      expect(() => parseWorkbook(buffer)).toThrow(/normalized dataset.*5 MB publication limit/);
    }
  });

  it('caps the number of actual monthly rows', () => {
    const rows = Array.from({ length: 1201 }, (_, index) => {
      const year = 1900 + Math.floor(index / 12);
      return [`${year}-${String(index % 12 + 1).padStart(2, '0')}`, 4, 132];
    });
    expect(() => parseWorkbook(encode(fixture(rows)))).toThrow(/at most 1,200 monthly rows/);
  });

  it('reads an uploaded File and rejects other extensions', async () => {
    const buffer = encode(fixture());
    const result = await parseWorkbookFile(new File([buffer], 'materials.xlsx'));
    expect(result.dataset.rows).toHaveLength(2);
    await expect(parseWorkbookFile(new File([buffer], 'materials.csv'))).rejects.toThrow(/Excel .xlsx or .xls/);
  });
});

const sourceWorkbook = '/Users/beam/Downloads/รวมราคาวัสดุของแต่ละเดือน.xlsx';

describe.skipIf(!existsSync(sourceWorkbook))('provided material workbook (local only)', () => {
  it('imports all 39 series and 33 months without publishing the source file', () => {
    const data = readFileSync(sourceWorkbook);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const { dataset, sheetName, warnings } = parseWorkbook(buffer);
    expect(sheetName).toBe('all');
    expect(dataset.series).toHaveLength(39);
    expect(dataset.rows).toHaveLength(33);
    expect(dataset.rows[0].month).toBe('2024-01-01');
    expect(dataset.rows.at(-1)?.month).toBe('2026-09-01');
    expect(dataset.rows[0].values.copper_thb).toBeCloseTo(130.45491, 6);
    expect(dataset.rows.at(-1)?.values).toMatchObject({ copper_usd: 6.5065, usd_thb: 33.31, cny_thb: 4.96, ngv_thb: null, pool_gas_thb: null });
    expect(dataset.series.find(({ id }) => id === 'gypsum_thb')).toMatchObject({ name: 'Gypsum', unit: 'T', category: 'Other' });
    expect(warnings.join(' ')).toContain('saved Excel values');
  });
});
