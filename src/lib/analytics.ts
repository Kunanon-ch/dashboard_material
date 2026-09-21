import type { Dataset, PriceRow, Series } from '../types'

export type Period = '6M' | '1Y' | 'All'

export function sortedRows(rows: PriceRow[]): PriceRow[] {
  return [...rows].sort((a, b) => a.month.localeCompare(b.month))
}

export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number)
  const total = year * 12 + number - 1 + offset
  return `${Math.floor(total / 12)}-${String(((total % 12) + 12) % 12 + 1).padStart(2, '0')}-01`
}

export function monthLabel(month: string, short = false): string {
  if (!month) return 'No reporting period'
  return new Intl.DateTimeFormat('en-GB', {
    month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${month}T00:00:00Z`))
}

export function priceAt(rows: PriceRow[], id: string, month: string): number | null {
  const value = rows.find((row) => row.month === month)?.values[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Uses the exact preceding calendar month. Missing observations never become zero. */
export function monthChange(rows: PriceRow[], id: string, month: string): number | null {
  const current = priceAt(rows, id, month)
  const previous = priceAt(rows, id, shiftMonth(month, -1))
  if (current === null || previous === null || previous === 0) return null
  const change = ((current - previous) / previous) * 100
  return Number.isFinite(change) ? change : null
}

export function materialId(series: Series): string {
  return series.category === 'FX' ? series.id : series.id.replace(/_(thb|usd|cny)$/, '')
}

/** Prefer each material's supplied THB quote; do not convert currencies or mix units. */
export function primarySeries(series: Series[]): Series[] {
  const groups = new Map<string, Series>()
  for (const item of series) {
    const key = materialId(item)
    if (!groups.has(key) || item.currency === 'THB') groups.set(key, item)
  }
  return [...groups.values()]
}

export function quoteFor(series: Series[], selected: Series, quote: 'THB' | 'original'): Series {
  const choices = series.filter((item) => materialId(item) === materialId(selected))
  return choices.find((item) => quote === 'THB' ? item.currency === 'THB' : item.currency !== 'THB') ?? selected
}

export function quoteLabel(series: Series): string {
  return `${series.currency} / ${series.unit}`
}

/** Returns a full calendar axis, so an absent whole month is a visible chart gap. */
export function timeline(rows: PriceRow[], end: string, period: Period): string[] {
  const available = sortedRows(rows).filter((row) => row.month <= end)
  if (!available.length || !end) return []
  const start = period === 'All' ? available[0].month : shiftMonth(end, period === '6M' ? -5 : -11)
  const months: string[] = []
  for (let cursor = start; cursor <= end; cursor = shiftMonth(cursor, 1)) months.push(cursor)
  return months
}

export interface Mover { series: Series; change: number; value: number }

export function monthlyMovers(dataset: Dataset, month: string): Mover[] {
  return primarySeries(dataset.series)
    .filter((series) => series.currency === 'THB' && series.category !== 'FX')
    .flatMap((series) => {
      const change = monthChange(dataset.rows, series.id, month)
      const value = priceAt(dataset.rows, series.id, month)
      return change === null || value === null ? [] : [{ series, change, value }]
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.series.name.localeCompare(b.series.name))
}

export interface IndexedComparison {
  baseMonth: string | null
  months: string[]
  series: { series: Series; values: (number | null)[] }[]
}

/** Every series shares one observed, nonzero base month, with missing months left blank. */
export function indexedComparison(dataset: Dataset, ids: string[], end: string, period: Period): IndexedComparison {
  const selected = [...new Set(ids)].flatMap((id) => {
    const series = dataset.series.find((item) => item.id === id)
    return series ? [series] : []
  })
  const axis = timeline(dataset.rows, end, period)
  const baseMonth = selected.length ? axis.find((month) => selected.every((series) => {
    const value = priceAt(dataset.rows, series.id, month)
    return value !== null && value !== 0
  })) ?? null : null
  if (!baseMonth) return { baseMonth: null, months: [], series: [] }
  const months = axis.filter((month) => month >= baseMonth)
  return {
    baseMonth, months,
    series: selected.map((series) => {
      const base = priceAt(dataset.rows, series.id, baseMonth)!
      return { series, values: months.map((month) => {
        const value = priceAt(dataset.rows, series.id, month)
        if (value === null) return null
        const indexed = value / base * 100
        return Number.isFinite(indexed) ? indexed : null
      }) }
    }),
  }
}

export function formatPrice(value: number | null, digits = 2): string {
  return value === null ? '—' : new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

export function formatChange(value: number | null): string {
  if (value === null) return 'No comparison'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** Quoting protects delimiters; an apostrophe prevents spreadsheet formula evaluation. */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  const safe = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
