import { parseWorkbook } from './workbook'

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try { self.postMessage({ ok: true, result: parseWorkbook(event.data) }) }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Unable to read this workbook.' }) }
}
