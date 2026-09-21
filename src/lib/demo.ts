import type { Dataset, Series } from '../types'

// Synthetic prices for the development-only preview. No private workbook is bundled.
export function createDemoDataset(): Dataset {
  const definitions: Array<[string, string, Series['category'], string, string, number]> = [
    ['usd_thb', 'USD / THB', 'FX', 'THB', 'USD', 34.4],
    ['cny_thb', 'CNY / THB', 'FX', 'THB', 'CNY', 4.8],
    ['copper_thb', 'Copper', 'Metals', 'THB', 'Lbs', 148],
    ['copper_usd', 'Copper', 'Metals', 'USD', 'Lbs', 4.3],
    ['aluminum_thb', 'Aluminum', 'Metals', 'THB', 'T', 84500],
    ['hot_rolled_steel_thb', 'Hot-Rolled Coil Steel', 'Metals', 'THB', 'T', 25500],
    ['nickel_thb', 'Nickel', 'Metals', 'THB', 'T', 535000],
    ['zinc_thb', 'Zinc', 'Metals', 'THB', 'T', 95800],
    ['silver_thb', 'Silver', 'Metals', 'THB', 't.oz', 1050],
    ['steel_thb', 'Steel', 'Metals', 'THB', 'T', 16800],
    ['pvc_thb', 'PVC', 'Polymers', 'THB', 'Kg', 82],
    ['pp_thb', 'PP', 'Polymers', 'THB', 'Kg', 45],
    ['pc_thb', 'PC', 'Polymers', 'THB', 'Kg', 162],
    ['abs_thb', 'ABS', 'Polymers', 'THB', 'Kg', 63],
    ['pa66_thb', 'PA66', 'Polymers', 'THB', 'Kg', 215],
    ['polyethylene_thb', 'Polyethylene', 'Polymers', 'THB', 'T', 38000],
    ['crude_oil_thb', 'Crude Oil', 'Energy', 'THB', 'Bbl', 2500],
    ['brent_crude_oil_thb', 'Brent crude oil', 'Energy', 'THB', 'Bbl', 2650],
    ['diesel_thb', 'Diesel', 'Energy', 'THB', 'L', 32],
    ['ngv_thb', 'NGV', 'Energy', 'THB', 'Kg', 18.5],
    ['natural_gas_thb', 'Natural Gas', 'Energy', 'THB', 'MMBtu', 90],
    ['pool_gas_thb', 'Pool Gas', 'Energy', 'THB', 'MMBtu', 298],
    ['gypsum_thb', 'Gypsum', 'Other', 'THB', 'T', 640],
    ['kraft_pulp_thb', 'Kraft Pulp', 'Other', 'THB', 'T', 27500],
    ['lithium_thb', 'Lithium', 'Metals', 'THB', 'T', 365000],
    ['naphtha_thb', 'Naphtha', 'Energy', 'THB', 'T', 22000],
  ]
  return {
    series: definitions.map(([id, name, category, currency, unit], i) => ({ id, name, category, currency, unit, sourceColumn: String.fromCharCode(65 + i) })),
    rows: Array.from({ length: 24 }, (_, i) => ({
      month: `${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
      values: Object.fromEntries(definitions.map(([id, , , , , value], s) => [id, +(value * (1 + Math.sin(i * .63 + s * .7) * .065 + i * (s % 3 - 1) * .004)).toFixed(3)])),
    })),
  }
}
