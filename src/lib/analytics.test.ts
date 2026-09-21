import { describe, expect, it } from 'vitest'
import type { Dataset, Series } from '../types'
import { csvCell, indexedComparison, monthChange, monthlyMovers, priceAt, primarySeries, shiftMonth, timeline } from './analytics'

const copper: Series = { id: 'copper_thb', name: 'Copper', category: 'Metals', currency: 'THB', unit: 'Lbs', sourceColumn: 'D' }
const aluminum: Series = { ...copper, id: 'aluminum_thb', name: 'Aluminum', unit: 'T' }

describe('calendar-correct monthly analytics', () => {
  it('does not treat the prior available observation as the preceding month', () => {
    const rows = [{ month: '2025-01-01', values: { copper_thb: 100 } }, { month: '2025-03-01', values: { copper_thb: 120 } }]
    expect(monthChange(rows, copper.id, '2025-03-01')).toBeNull()
    expect(timeline(rows, '2025-03-01', 'All')).toEqual(['2025-01-01', '2025-02-01', '2025-03-01'])
  })

  it('compares across a year boundary and preserves a measured zero', () => {
    const rows = [{ month: '2025-12-01', values: { copper_thb: 100 } }, { month: '2026-01-01', values: { copper_thb: 0 } }]
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
    expect(priceAt(rows, copper.id, '2026-01-01')).toBe(0)
    expect(monthChange(rows, copper.id, '2026-01-01')).toBe(-100)
  })

  it('does not manufacture comparisons from nulls or zero denominators', () => {
    const rows = [{ month: '2026-01-01', values: { copper_thb: 0, aluminum_thb: null } }, { month: '2026-02-01', values: { copper_thb: 10, aluminum_thb: 20 } }]
    expect(monthChange(rows, copper.id, '2026-02-01')).toBeNull()
    expect(monthChange(rows, aluminum.id, '2026-02-01')).toBeNull()
  })

  it('ranks distinct THB material changes, excluding FX and duplicate currency quotes', () => {
    const dollar: Series = { ...copper, id: 'copper_usd', currency: 'USD' }
    const fx: Series = { ...copper, id: 'usd_thb', name: 'US Dollar', category: 'FX', unit: 'USD' }
    const dataset: Dataset = { series: [dollar, copper, aluminum, fx], rows: [
      { month: '2026-01-01', values: { copper_thb: 100, copper_usd: 3, aluminum_thb: 200, usd_thb: 30 } },
      { month: '2026-02-01', values: { copper_thb: 110, copper_usd: 4, aluminum_thb: 160, usd_thb: 40 } },
    ] }
    expect(primarySeries(dataset.series).map((series) => series.id)).toEqual(['copper_thb', 'aluminum_thb', 'usd_thb'])
    expect(monthlyMovers(dataset, '2026-02-01').map((mover) => [mover.series.id, mover.change])).toEqual([['aluminum_thb', -20], ['copper_thb', 10]])
  })

  it('uses one common nonzero base and retains missing months during normalization', () => {
    const dataset: Dataset = { series: [copper, aluminum], rows: [
      { month: '2026-01-01', values: { copper_thb: 0, aluminum_thb: 10 } },
      { month: '2026-02-01', values: { copper_thb: 20, aluminum_thb: null } },
      { month: '2026-03-01', values: { copper_thb: 40, aluminum_thb: 50 } },
      { month: '2026-05-01', values: { copper_thb: 60, aluminum_thb: 40 } },
    ] }
    const result = indexedComparison(dataset, [copper.id, aluminum.id], '2026-05-01', 'All')
    expect(result.baseMonth).toBe('2026-03-01')
    expect(result.months).toEqual(['2026-03-01', '2026-04-01', '2026-05-01'])
    expect(result.series.map((series) => series.values)).toEqual([[100, null, 150], [100, null, 80]])
  })

  it('returns an explicit empty comparison if the series never overlap', () => {
    const dataset: Dataset = { series: [copper, aluminum], rows: [{ month: '2026-01-01', values: { copper_thb: 10, aluminum_thb: null } }] }
    expect(indexedComparison(dataset, [copper.id, aluminum.id], '2026-01-01', 'All')).toEqual({ baseMonth: null, months: [], series: [] })
  })

  it('limits periods by calendar months, not by the number of uploaded rows', () => {
    const rows = [{ month: '2020-01-01', values: {} }, { month: '2026-08-01', values: {} }]
    const months = timeline(rows, '2026-08-01', '6M')
    expect(months).toHaveLength(6)
    expect(months[0]).toBe('2026-03-01')
  })

  it('quotes CSV delimiters and neutralizes formulas without changing negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('Copper, metal')).toBe('"Copper, metal"')
    expect(csvCell(-2)).toBe('"-2"')
    expect(csvCell(null)).toBe('')
  })
})
