export type Category = 'Metals' | 'Polymers' | 'Energy' | 'Other' | 'FX'
export interface Series { id: string; name: string; category: Category; currency: string; unit: string; sourceColumn: string }
export interface PriceRow { month: string; values: Record<string, number | null> }
export interface Dataset { series: Series[]; rows: PriceRow[] }
export interface ParsedWorkbook { dataset: Dataset; sheetName: string; warnings: string[] }
export interface DatasetVersion {
  id: string; filename: string; sheet_name: string; created_at: string;
  created_by: string | null; created_by_name: string | null;
  row_count: number; series_count: number;
}

export interface Member {
  user_id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  created_at: string;
  is_admin: boolean;
  is_owner: boolean;
}
