import * as XLSX from 'xlsx';
import type { Category, Dataset, ParsedWorkbook, PriceRow, Series } from '../types';

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_PUBLISHED_BYTES = 5 * 1024 * 1024;
const MAX_PRICE = 1_000_000_000_000;
const MAX_MONTHS = 1_200;
const MAX_SERIES = 100;

type SeriesDefinition = Omit<Series, 'sourceColumn'> & { headers: string[] };
type ParsedSeries = Omit<Series, 'sourceColumn'>;

const paired = (
  id: string,
  name: string,
  category: Category,
  currency: 'USD' | 'CNY',
  unit: string,
  sourceName = name,
): SeriesDefinition[] => [
  { id: `${id}_${currency.toLowerCase()}`, name, category, currency, unit, headers: [`${sourceName} (${currency}/${unit})`] },
  { id: `${id}_thb`, name, category, currency: 'THB', unit, headers: [`${sourceName} (Baht/${unit})`] },
];

const baht = (id: string, name: string, category: Category, unit: string, headers = [`${name} (Baht/${unit})`]): SeriesDefinition => ({
  id: `${id}_thb`, name, category, currency: 'THB', unit, headers,
});

// Units and categories are explicit: the workbook's merged category labels group
// some unrelated materials together, so they cannot safely define these fields.
const DEFINITIONS: SeriesDefinition[] = [
  { id: 'usd_thb', name: 'US Dollar', category: 'FX', currency: 'THB', unit: 'USD', headers: ['ค่าเงิน USD'] },
  { id: 'cny_thb', name: 'Chinese Yuan', category: 'FX', currency: 'THB', unit: 'CNY', headers: ['ค่าเงินหยวน Y/ B'] },
  ...paired('copper', 'Copper', 'Metals', 'USD', 'Lbs'),
  ...paired('hot_rolled_steel', 'Hot-Rolled Coil Steel', 'Metals', 'USD', 'T'),
  ...paired('nickel', 'Nickel', 'Metals', 'USD', 'T'),
  ...paired('aluminum', 'Aluminum', 'Metals', 'USD', 'T'),
  ...paired('steel', 'Steel', 'Metals', 'CNY', 'T'),
  ...paired('kraft_pulp', 'Kraft Pulp', 'Other', 'CNY', 'T'),
  ...paired('zinc', 'Zinc', 'Metals', 'USD', 'T'),
  ...paired('silver', 'Silver', 'Metals', 'USD', 't.oz'),
  ...paired('polyethylene', 'Polyethylene', 'Polymers', 'CNY', 'T'),
  ...paired('naphtha', 'Naphtha', 'Energy', 'USD', 'T'),
  ...paired('lithium', 'Lithium', 'Metals', 'CNY', 'T'),
  baht('pvc', 'PVC', 'Polymers', 'Kg'),
  baht('pp', 'PP', 'Polymers', 'Kg'),
  baht('pc', 'PC', 'Polymers', 'Kg'),
  baht('abs', 'ABS', 'Polymers', 'Kg'),
  baht('pa66', 'PA66', 'Polymers', 'Kg'),
  baht('gypsum', 'Gypsum', 'Other', 'T', ['ยิปซั่ม (บาท/เมตริกตัน)', 'Gypsum (Baht/T)']),
  ...paired('crude_oil', 'Crude Oil', 'Energy', 'USD', 'Bbl'),
  ...paired('brent_crude_oil', 'Brent Crude Oil', 'Energy', 'USD', 'Bbl'),
  baht('diesel', 'Diesel', 'Energy', 'L', ['Diesel (บาท/ลิตร)', 'Diesel (Baht/L)']),
  baht('ngv', 'NGV', 'Energy', 'Kg'),
  ...paired('natural_gas', 'Natural Gas', 'Energy', 'USD', 'MMBtu'),
  baht('pool_gas', 'Pool Gas', 'Energy', 'MMBtu'),
];

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\bbath\b/g, 'baht').replace(/\s+/g, '');
}

const HEADER_LOOKUP = new Map(DEFINITIONS.flatMap((definition) => definition.headers.map((header) => [normalizeHeader(header), definition] as const)));

function dynamicSeries(header: string, column: number, usedIds: Set<string>): ParsedSeries | null {
  const readable = header.trim().replace(/\s+/g, ' ');
  const match = /^(.+?)\s*\(\s*(Baht|บาท|[A-Za-z]{3,16})\s*\/\s*([^()\/]+?)\s*\)$/i.exec(readable);
  if (!match) return null;
  const name = match[1].trim();
  const currencyToken = match[2].toUpperCase();
  const currency = currencyToken === 'BAHT' || currencyToken === 'บาท' ? 'THB' : currencyToken;
  const unit = match[3].trim().replace(/\s+/g, ' ');
  if (!name || name.length > 200 || !unit || unit.length > 80) return null;

  const slug = (value: string, fallback: string, length: number) => {
    const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, length);
    return result || fallback;
  };
  const columnLabel = XLSX.utils.encode_col(column).toLowerCase();
  const nameSlug = slug(name, `custom_${columnLabel}`, 40);
  const unitSlug = slug(unit, 'unit', 20);
  const currencySlug = slug(currency, 'currency', 16);
  let id = `${nameSlug}_${currencySlug}_${unitSlug}`;
  if (usedIds.has(id)) id = `${id.slice(0, 75)}_${columnLabel}`;

  return { id, name, category: 'Other', currency, unit };
}

function isEmpty(cell: XLSX.CellObject | undefined): boolean {
  return !cell || (!cell.f && !cell.F && cell.t !== 'e' && (cell.v === undefined || cell.v === null || cell.v === ''));
}

function checkedValue(cell: XLSX.CellObject | undefined, address: string): unknown {
  // SheetJS can represent a formula with an absent cache as a stub with v: 0.
  // That placeholder must never be mistaken for a genuine numeric zero.
  if ((cell?.f || cell?.F) && (cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '')) {
    throw new Error(`${address} has a formula without a saved result. Recalculate and save the workbook in Excel before uploading.`);
  }
  if (cell?.t === 'e') {
    throw new Error(`${address} contains an Excel error. Correct the formula in Excel and save the workbook again.`);
  }
  return cell?.v;
}

function monthKey(year: number, month: number, day: number, address: string): string {
  const actual = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) {
    throw new Error(`${address} needs a valid calendar date between 1900 and 2199.`);
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function parseMonth(cell: XLSX.CellObject | undefined, address: string, date1904: boolean): string {
  const value = checkedValue(cell, address);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return monthKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), address);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
    if (parsed) return monthKey(parsed.y, parsed.m, parsed.d, address);
  }
  if (typeof value === 'string') {
    // Deliberately do not guess whether 01/02/2026 means January or February.
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
    if (match) return monthKey(Number(match[1]), Number(match[2]), Number(match[3] ?? 1), address);
  }
  throw new Error(`${address} needs an Excel date or an unambiguous YYYY-MM / YYYY-MM-DD date.`);
}

function parsePrice(cell: XLSX.CellObject | undefined, address: string): number | null {
  const value = checkedValue(cell, address);
  if (isEmpty(cell)) return null;
  let parsed = typeof value === 'number' ? value : NaN;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Accept explicitly numeric text, including conventional thousands groups.
    // Number(''), Boolean values, and partial numeric strings are never prices.
    if (/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      parsed = Number(trimmed.replace(/,/g, ''));
    }
  }
  if (!Number.isFinite(parsed)) throw new Error(`${address} needs a finite number. Leave unavailable prices blank instead of entering text.`);
  if (Math.abs(parsed) > MAX_PRICE) throw new Error(`${address} must be between -1,000,000,000,000 and 1,000,000,000,000 to publish.`);
  return parsed;
}

function publishedPayloadBytes(dataset: Dataset): number {
  // The server measures jsonb::text, which includes separator spaces and expands
  // scientific notation. Counting only compact JSON would understate its size.
  let extraBytes = 0;
  const json = JSON.stringify(dataset, (_key, value: unknown) => {
    if (Array.isArray(value)) extraBytes += Math.max(0, value.length - 1);
    else if (value !== null && typeof value === 'object') {
      const fields = Object.keys(value).length;
      extraBytes += fields + Math.max(0, fields - 1);
    } else if (typeof value === 'number') {
      const text = String(value);
      const [coefficient, exponent] = text.split('e-');
      // The price bound excludes positive exponents in JS number serialization.
      if (exponent) {
        const digits = coefficient.replace(/[-.]/g, '').length;
        const decimalBytes = 2 + Number(exponent) - 1 + digits + (value < 0 ? 1 : 0);
        extraBytes += decimalBytes - text.length;
      }
    }
    return value;
  });
  return new TextEncoder().encode(json).byteLength + extraBytes;
}

export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  if (!buffer.byteLength) throw new Error('The workbook is empty. Choose a saved Excel workbook.');
  if (buffer.byteLength > MAX_WORKBOOK_BYTES) throw new Error('The workbook is larger than 5 MB. Upload a smaller workbook.');

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'array', cellFormula: true, cellDates: false, cellHTML: false,
      cellText: false, sheetStubs: true, dense: false,
    });
  } catch {
    throw new Error('This file could not be read as an Excel workbook. Save it as .xlsx and try again.');
  }

  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === 'all')
    ?? (workbook.SheetNames.length === 1 ? workbook.SheetNames[0] : undefined);
  if (!sheetName) throw new Error('Choose a workbook with a sheet named “all”, or a workbook containing one data sheet.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.['!ref']) throw new Error('The data sheet is empty.');

  // Visit stored cells instead of iterating !ref, which can span a million
  // formatted rows even when the workbook contains only a few actual records.
  const populatedCells = Object.entries(sheet).filter(([address, cell]) => /^[A-Z]+\d+$/.test(address) && !isEmpty(cell as XLSX.CellObject));
  const headerCell = populatedCells.find(([address, cell]) => {
    const location = XLSX.utils.decode_cell(address);
    return location.r <= 1 && normalizeHeader(checkedValue(cell as XLSX.CellObject, address)) === 'month/year';
  });
  if (!headerCell) throw new Error('The first or second row must contain the “Month/Year” header. Keep the original workbook headers.');
  const headerLocation = XLSX.utils.decode_cell(headerCell[0]);
  const headerRow = headerLocation.r;
  const dateColumn = headerLocation.c;
  const columns: { column: number; series: Series }[] = [];
  const seenSeries = new Set<string>();
  const seenHeaders = new Set<string>();

  for (const [address, cell] of populatedCells) {
    const location = XLSX.utils.decode_cell(address);
    if (location.r !== headerRow) continue;
    const header = checkedValue(cell as XLSX.CellObject, address);
    const normalized = normalizeHeader(header);
    if (seenHeaders.has(normalized)) throw new Error(`${address} repeats the header “${String(header)}”. Every series header must be unique.`);
    seenHeaders.add(normalized);
    if (location.c === dateColumn) continue;
    const definition = HEADER_LOOKUP.get(normalized);
    const metadata = definition
      ? (({ headers: _headers, ...knownMetadata }) => knownMetadata)(definition)
      : dynamicSeries(String(header), location.c, seenSeries);
    if (!metadata) throw new Error(`${address} has an unrecognized header: “${String(header)}”. Add a header such as “New material (Baht/T)” so its currency and unit can be read.`);
    if (seenSeries.has(metadata.id)) throw new Error(`${address} duplicates the ${metadata.name} ${metadata.currency} series.`);
    seenSeries.add(metadata.id);
    columns.push({ column: location.c, series: { ...metadata, sourceColumn: XLSX.utils.encode_col(location.c) } });
  }
  if (!columns.length) throw new Error('The workbook needs at least one material or exchange-rate column.');
  if (columns.length > MAX_SERIES) throw new Error(`The workbook may contain at most ${MAX_SERIES} data series.`);
  columns.sort((a, b) => a.column - b.column);

  const knownColumns = new Set([dateColumn, ...columns.map(({ column }) => column)]);
  const dataRowNumbers = new Set<number>();
  for (const [address] of populatedCells) {
    const { r, c } = XLSX.utils.decode_cell(address);
    if (r <= headerRow) continue;
    if (!knownColumns.has(c)) throw new Error(`${address} has data without a recognized column header.`);
    dataRowNumbers.add(r);
  }
  if (dataRowNumbers.size > MAX_MONTHS) throw new Error(`The workbook may contain at most ${MAX_MONTHS.toLocaleString('en-US')} monthly rows.`);
  if (!dataRowNumbers.size) throw new Error('The workbook does not contain any monthly data rows.');

  const seenMonths = new Set<string>();
  const rows: PriceRow[] = [];
  let missingPrices = 0;
  let formulaCount = 0;
  let numericPrices = 0;
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  for (const rowNumber of [...dataRowNumbers].sort((a, b) => a - b)) {
    const dateAddress = XLSX.utils.encode_cell({ r: rowNumber, c: dateColumn });
    const month = parseMonth(sheet[dateAddress], dateAddress, date1904);
    if (seenMonths.has(month)) throw new Error(`${dateAddress} duplicates ${month.slice(0, 7)}. Use one row per calendar month.`);
    seenMonths.add(month);
    const values: Record<string, number | null> = {};
    for (const { column, series } of columns) {
      const address = XLSX.utils.encode_cell({ r: rowNumber, c: column });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      const value = parsePrice(cell, address);
      values[series.id] = value;
      if (value === null) missingPrices += 1;
      else numericPrices += 1;
      if (cell?.f || cell?.F) formulaCount += 1;
    }
    rows.push({ month, values });
  }
  if (!numericPrices) throw new Error('The workbook needs at least one numeric price or exchange rate.');
  rows.sort((a, b) => a.month.localeCompare(b.month));
  const warnings: string[] = [];
  if (missingPrices) warnings.push(`${missingPrices} blank price ${missingPrices === 1 ? 'cell is' : 'cells are'} kept as missing values, not zero.`);
  if (formulaCount) warnings.push(`${formulaCount} formula results were read from the saved Excel values. Recalculate and save in Excel before each upload.`);
  const dataset: Dataset = { series: columns.map(({ series }) => series), rows };
  if (publishedPayloadBytes(dataset) > MAX_PUBLISHED_BYTES) {
    throw new Error('The normalized dataset is larger than the 5 MB publication limit. Upload fewer months or price series.');
  }
  return { dataset, sheetName, warnings };
}

export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  if (!/\.xlsx?$/i.test(file.name)) throw new Error('Choose an Excel .xlsx or .xls workbook.');
  if (file.size > MAX_WORKBOOK_BYTES) throw new Error('The workbook is larger than 5 MB. Upload a smaller workbook.');
  return parseWorkbook(await file.arrayBuffer());
}
